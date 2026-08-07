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
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { resumeResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
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
        { error: `Resume message must contain the agent ID "${agentId}".`, code: "MESSAGE_AGENT_ID_MISMATCH" },
        { status: 400 },
      );
    }

    if (!signedMessage.includes("resume_resolution_agent")) {
      return NextResponse.json(
        { error: "Signed message must bind to the resume action.", code: "MESSAGE_ACTION_MISMATCH" },
        { status: 400 },
      );
    }

    const store = createStore();
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
