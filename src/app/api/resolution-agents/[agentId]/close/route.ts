// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/close
//
// Permanently close a Resolution Agent and reclaim unused USDC from the
// case wallet to the original funder.
//
// The caller MUST be the original funder.  The signed message must bind to
// the close action and include the funder address as the refund destination.
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the canonical close message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Responses:
//   200 — closed, returns ResolutionAgentPublicView
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder
//   404 — agent not found
//   422 — agent cannot be closed (in-flight execution, running_tool, etc.)
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { closeResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import { CeloMainnetFundingReader } from "@/lib/resolution-agent/api/funding";
import { CeloReclaimTransferClient } from "@/lib/resolution-agent/server/reclaim-transfer";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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
        { error: `Close message must contain the agent ID "${agentId}".`, code: "MESSAGE_AGENT_ID_MISMATCH" },
        { status: 400 },
      );
    }

    if (!signedMessage.includes("close_resolution_agent")) {
      return NextResponse.json(
        { error: "Signed message must bind to the close action.", code: "MESSAGE_ACTION_MISMATCH" },
        { status: 400 },
      );
    }

    const store = createStore();
    const now = Date.now();
    const fundingReader = new CeloMainnetFundingReader();
    const transferClient = new CeloReclaimTransferClient();

    const publicView = await closeResolutionAgent({
      agentId,
      authenticatedCaller: walletAddress,
      now,
      store,
      fundingReader,
      transferClient,
    });

    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
