// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/run
//
// Request-triggered execution of AT MOST ONE resolution-agent worker
// iteration for the EXISTING agent identified in the URL.
//
// Safety:
//   - Exactly one worker iteration, targeted at the requested agent
//     (targetAgentId). There is NO loop, NO cron, and NO automatic or
//     recurring execution — this route is the only manual trigger.
//   - The worker enforces all policy, budget, lease, idempotency, and x402
//     protections internally. This route does NOT duplicate them.
//   - The service gates execution: agent must exist (404), the caller must
//     be the funder, the on-chain client, or the on-chain worker, the agent
//     must be bound to the canonical escrow case, and the escrow case must
//     exist on-chain and not be in a terminal state (released/cancelled/
//     resolved).
//
// Headers (wallet auth — same transport as every resolution-agent route):
//   x-wallet-address   — caller's EVM address
//   x-wallet-message   — the canonical run-agent message that was signed
//                        (b64url-encoded via encodeWalletAuthMessage)
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Body: NONE (no JSON body is read or accepted).
//
// Responses:
//   200 — { result: ResolutionAgentWorkerResult, agent: ResolutionAgentPublicView }
//         Both payloads are public-safe (no secrets, keys, or ciphertext).
//   400 — signed message does not bind to this agent / the run action
//   401 — missing or invalid wallet authentication
//   404 — agent not found
//   500 — internal server error (incl. authorization/terminal-case denials)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";

// Serverless execution budget: one worker iteration may run up to
// DEFAULT_MAX_ITERATION_MS (45s) plus store/observer overhead. 60s keeps a
// single request-triggered iteration inside the function budget without any
// background work — there is no cron, no loop, and no scheduled execution.
export const maxDuration = 60;
import {
  createStore,
  runResolutionAgentIteration,
} from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(request.headers);

    if (!walletAddress || !signedMessage || !walletSignature) {
      return NextResponse.json(
        { error: "Wallet authentication required.", code: "MISSING_WALLET_HEADERS" },
        { status: 401 },
      );
    }

    if (await requestHasUnexpectedBody(request)) {
      return NextResponse.json(
        { error: "This route does not accept a request body.", code: "BODY_NOT_ALLOWED" },
        { status: 400 },
      );
    }

    const store = createStore();
    const storedAgent = await store.getAgentById(agentId);
    if (!storedAgent) {
      return NextResponse.json(
        { error: "Resolution agent not found.", code: "AGENT_NOT_FOUND" },
        { status: 404 },
      );
    }

    const authResult = await authorizeWalletRequest({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
      expected: {
        action: "run_resolution_agent",
        agentId: storedAgent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: storedAgent.identity.escrowPaymentId,
        bodyHash: EMPTY_BODY_HASH,
        signerAddress: walletAddress,
      },
      nonceStore: store,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        { error: `Wallet authorization failed: ${authResult.error}`, code: authResult.code },
        {
          status:
            authResult.code.startsWith("MESSAGE_") &&
            authResult.code !== "MESSAGE_SIGNER_MISMATCH"
              ? 400
              : authResult.code === "MESSAGE_SIGNER_MISMATCH"
                ? 403
                : 401,
        },
      );
    }

    // No body parsing — this route accepts no JSON body.

    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const now = Date.now();

    const { result, agent } = await runResolutionAgentIteration({
      agentId,
      authenticatedCaller: walletAddress,
      store,
      escrowReader,
      now,
    });

    return NextResponse.json({ result, agent }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
