// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/funding-status
//
// Refresh the funding status of a Resolution Agent's case wallet by
// querying its on-chain USDC balance.  If the balance meets the approved
// budget, the agent is advanced through the funding pipeline:
//   awaiting_funding → funded → awaiting_activation
//
// Access is granted to the stored funder OR the on-chain client OR the
// on-chain worker.
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — signed authentication message
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Responses:
//   200 — FundingStatusResponse { agent, walletBalanceAtomic, isSufficientlyFunded }
//   401 — missing or invalid wallet authentication
//   403 — caller is not authorized
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";
import { refreshFundingStatus, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloMainnetFundingReader,
} from "@/lib/resolution-agent/api/funding";
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
        action: "funding_status_resolution_agent",
        agentId: agent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: agent.identity.escrowPaymentId,
        bodyHash: EMPTY_BODY_HASH,
        signerAddress: walletAddress,
      },
      nonceStore: store,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        {
          error: `Wallet authorization failed: ${authResult.error}`,
          code: authResult.code,
        },
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

    // -----------------------------------------------------------------
    // Step 2: Refresh funding status
    //         (the service enforces authorization — funder, client, or
    //         worker — and performs the on-chain balance check with
    //         state transitions)
    // -----------------------------------------------------------------
    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const now = Date.now();
    const fundingReader = new CeloMainnetFundingReader();

    const status = await refreshFundingStatus({
      agentId,
      authenticatedCaller: walletAddress,
      now,
      store,
      fundingReader,
      escrowReader,
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
