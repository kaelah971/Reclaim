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
//     refunded).
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
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import {
  createStore,
  runResolutionAgentIteration,
} from "@/lib/resolution-agent/api/service";
import { CeloSepoliaEscrowCaseReader } from "@/lib/resolution-agent/api/escrow-reader";
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

    const authResult = await verifyAuth({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        { error: `Wallet signature verification failed: ${authResult.error}`, code: "SIGNATURE_INVALID" },
        { status: 401 },
      );
    }

    if (!signedMessage.includes(agentId)) {
      return NextResponse.json(
        { error: `Run-agent message must contain the agent ID "${agentId}".`, code: "MESSAGE_AGENT_ID_MISMATCH" },
        { status: 400 },
      );
    }

    if (!signedMessage.includes("run_resolution_agent")) {
      return NextResponse.json(
        { error: "Signed message must bind to the run_resolution_agent action.", code: "MESSAGE_ACTION_MISMATCH" },
        { status: 400 },
      );
    }

    // No body parsing — this route accepts no JSON body.

    const store = createStore();
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
