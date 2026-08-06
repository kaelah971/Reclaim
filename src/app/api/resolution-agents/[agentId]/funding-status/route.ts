// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/funding-status
//
// Refresh the funding status of a Resolution Agent's case wallet by
// querying its on-chain USDC balance.  If the balance meets the approved
// budget, the agent is advanced through the funding pipeline:
//   awaiting_funding → funded → awaiting_activation
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — signed authentication message
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Responses:
//   200 — FundingStatusResponse { agent, walletBalanceAtomic, isSufficientlyFunded }
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { refreshFundingStatus, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloMainnetFundingReader,
} from "@/lib/resolution-agent/api/funding";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    // -----------------------------------------------------------------
    // Step 1: Authenticate caller via wallet auth headers
    // -----------------------------------------------------------------
    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(request.headers);

    if (!walletAddress || !signedMessage || !walletSignature) {
      return NextResponse.json(
        {
          error:
            "Wallet authentication required. Provide x-wallet-address, x-wallet-message, and x-wallet-signature headers.",
          code: "MISSING_WALLET_HEADERS",
        },
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
        {
          error: `Wallet signature verification failed: ${authResult.error}`,
          code: "SIGNATURE_INVALID",
        },
        { status: 401 },
      );
    }

    // -----------------------------------------------------------------
    // Step 2: Refresh funding status
    //         (the service enforces funder-only access and performs the
    //         on-chain balance check with state transitions)
    // -----------------------------------------------------------------
    const store = createStore();
    const now = Date.now();
    const fundingReader = new CeloMainnetFundingReader();

    const status = await refreshFundingStatus({
      agentId,
      authenticatedCaller: walletAddress,
      now,
      store,
      fundingReader,
    });

    // -----------------------------------------------------------------
    // Step 3: Return funding status response
    //         { agent, walletBalanceAtomic, isSufficientlyFunded }
    // -----------------------------------------------------------------
    return NextResponse.json(status, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
