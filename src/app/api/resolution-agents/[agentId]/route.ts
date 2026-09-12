// ---------------------------------------------------------------------------
// GET /api/resolution-agents/[agentId]
//
// Retrieve a Resolution Agent's public view.  Access is granted to the
// stored funder OR the on-chain client OR the on-chain worker (verified
// against the canonical escrow contract).
//
// Headers:
//   x-wallet-address   — caller's EVM address
//   x-wallet-message   — signed authentication message
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Responses:
//   200 — ResolutionAgentPublicView
//   401 — missing or invalid wallet authentication
//   403 — caller is not authorized (not funder, client, or worker)
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";
import { getResolutionAgentPublicView, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    // -----------------------------------------------------------------
    // Step 1: Extract and verify wallet auth headers
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
        action: "get_resolution_agent",
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
    // Step 2: Load agent and verify authorization
    //         (authorisation is enforced inside the service function —
    //         it checks the stored funder AND the on-chain case parties)
    // -----------------------------------------------------------------
    const escrowReader = new CeloSepoliaEscrowCaseReader();

    const publicView = await getResolutionAgentPublicView({
      agentId,
      authenticatedCaller: walletAddress,
      store,
      escrowReader,
    });

    // -----------------------------------------------------------------
    // Step 3: Return public view
    // -----------------------------------------------------------------
    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
