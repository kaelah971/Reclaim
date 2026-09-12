// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/resume
//
// Resume a paused Resolution Agent, allowing autonomous work to continue.
//
// The caller MUST be the original funder.  The signed message must contain
// the agent ID and "resume_resolution_agent" action to prevent replay.
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the canonical resume message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Responses:
//   200 — resumed, returns ResolutionAgentPublicView
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";
import { resumeResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import {
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
    const agent = await store.getAgentById(agentId);
    if (!agent) {
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
        action: "resume_resolution_agent",
        agentId: agent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: agent.identity.escrowPaymentId,
        bodyHash: EMPTY_BODY_HASH,
        signerAddress: agent.policy.funderAddress,
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

    const now = Date.now();

    const publicView = await resumeResolutionAgent({
      agentId,
      authenticatedCaller: walletAddress,
      now,
      store,
    });

    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
