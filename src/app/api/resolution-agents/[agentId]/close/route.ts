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
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";
import { closeResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import { CeloMainnetFundingReader } from "@/lib/resolution-agent/api/funding";
import {
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "@/lib/resolution-agent/api/escrow-reader";
import { CeloReclaimTransferClient } from "@/lib/resolution-agent/server/reclaim-transfer";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

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
        action: "close_resolution_agent",
        agentId: agent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: agent.identity.escrowPaymentId,
        bodyHash: EMPTY_BODY_HASH,
        signerAddress: agent.policy.funderAddress,
        fields: { "Refund Destination": agent.policy.funderAddress },
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
