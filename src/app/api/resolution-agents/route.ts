// ---------------------------------------------------------------------------
// POST /api/resolution-agents
// GET  /api/resolution-agents?paymentId=... — lookup by payment ID
//
// Create a new Resolution Agent for a specific escrow payment case,
// or look up an existing agent by payment ID.
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
import {
  authorizeWalletRequest,
  hashCanonicalJson,
} from "@/lib/resolution-agent/api/auth";
import { createResolutionAgentForCase, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
  CANONICAL_ESCROW_CHAIN_ID,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";
import { toResolutionAgentPublicView } from "@/lib/resolution-agent/public-view";

// ---------------------------------------------------------------------------
// GET /api/resolution-agents?paymentId=...
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("paymentId");

    if (!paymentId) {
      return NextResponse.json(
        { error: "Missing paymentId query parameter.", code: "MISSING_PARAM" },
        { status: 400 },
      );
    }

    if (!/^\d+$/.test(paymentId)) {
      return NextResponse.json(
        { error: "paymentId must be a numeric escrow identifier.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    // Look up the agent by case identity (canonical chain + contract)
    const store = new SupabaseResolutionAgentStore();
    const agent = await store.getAgentByCaseIdentity(
      String(CANONICAL_ESCROW_CHAIN_ID),
      CANONICAL_ESCROW_CONTRACT_ADDRESS,
      paymentId,
    );

    if (!agent) {
      return NextResponse.json(
        { found: false, agentId: null },
        { status: 200 },
      );
    }

    return NextResponse.json({
      found: true,
      agentId: agent.id,
      publicView: toResolutionAgentPublicView(agent),
    });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}

// ---------------------------------------------------------------------------
// POST /api/resolution-agents
// ---------------------------------------------------------------------------

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

    const store = createStore();
    const budgetAtomic = BigInt(requestData.budgetAtomic);
    const authResult = await authorizeWalletRequest({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
      expected: {
        action: "create_resolution_agent",
        agentId: "none",
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: requestData.escrowPaymentId,
        bodyHash: hashCanonicalJson(requestData),
        signerAddress: walletAddress,
        fields: {
          "Approved Budget (atomic USDC)": requestData.budgetAtomic,
          "Funder Address": walletAddress,
          "Policy Version": "v1",
        },
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
    // Step 4: Instantiate escrow reader, store, and call the service
    //         escrowContractAddress is server-owned (canonical) —
    //         the client must NOT supply it.
    // -----------------------------------------------------------------
    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const now = Date.now();

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
