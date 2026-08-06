// ---------------------------------------------------------------------------
// POST /api/resolution-agents
//
// Create a new Resolution Agent for a specific escrow payment case.
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the plaintext message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Body (JSON):
//   escrowChainId   — must be "eip155:11142220" (Celo Sepolia CAIP-2)
//   escrowPaymentId — on-chain payment identifier (alphanumeric + hyphens)
//   budgetAtomic    — approved budget in atomic USDC (string)
//                     must be one of: "30000", "40000", "50000"
//
//   NOTE: escrowContractAddress is NOT accepted from the client.  The server
//   uses the canonical deployed escrow contract address.
//
// Responses:
//   201 — agent created, returns ResolutionAgentPublicView
//   400 — invalid request body
//   401 — missing or invalid wallet authentication
//   403 — caller is not a valid case party (client or worker)
//   409 — agent already exists for this case with a different funder
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createAgentRequestSchema } from "@/lib/resolution-agent/api/types";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { createResolutionAgentForCase, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

export async function POST(request: NextRequest): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    // -----------------------------------------------------------------
    // Step 1: Extract wallet authentication from headers
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

    // -----------------------------------------------------------------
    // Step 2: Parse and validate request body with Zod
    // -----------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const parseResult = createAgentRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Request body validation failed.",
          code: "VALIDATION_ERROR",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const requestData = parseResult.data;

    // -----------------------------------------------------------------
    // Step 3: Verify wallet signature cryptographically
    // -----------------------------------------------------------------
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
    // Step 4: Instantiate escrow reader, store, and call the service
    //         escrowContractAddress is server-owned (canonical) —
    //         the client must NOT supply it.
    // -----------------------------------------------------------------
    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const store = createStore();
    const now = Date.now();
    const budgetAtomic = BigInt(requestData.budgetAtomic);

    const publicView = await createResolutionAgentForCase({
      authenticatedCaller: walletAddress,
      caseIdentity: {
        escrowChainId: "eip155:11142220",
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: requestData.escrowPaymentId,
      },
      approvedBudgetAtomic: budgetAtomic,
      now,
      store,
      escrowReader,
    });

    // -----------------------------------------------------------------
    // Step 5: Return public view with 201 Created
    // -----------------------------------------------------------------
    return NextResponse.json(publicView, { status: 201 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
