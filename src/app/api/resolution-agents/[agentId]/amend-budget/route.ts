// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/amend-budget
//
// Amend the approved budget of a Resolution Agent that has NOT yet been
// activated.  Only the original funder may amend, and the new budget
// must be one of the canonical values (30000, 40000, 50000 atomic USDC)
// and strictly greater than the current budget.
//
// Eligible states: awaiting_funding, awaiting_activation
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the canonical amend-budget message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Body (JSON):
//   budgetAtomic — new approved budget in atomic USDC (string)
//
// Responses:
//   200 — budget amended, returns ResolutionAgentPublicView
//   400 — invalid body or budget not strictly greater
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  authorizeWalletRequest,
  hashCanonicalJson,
} from "@/lib/resolution-agent/api/auth";
import { amendBudgetResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { amendBudgetRequestSchema } from "@/lib/resolution-agent/api/types";
import {
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "@/lib/resolution-agent/api/escrow-reader";

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const parseResult = amendBudgetRequestSchema.safeParse(body);
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

    const store = createStore();
    const agent = await store.getAgentById(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: "Resolution agent not found.", code: "AGENT_NOT_FOUND" },
        { status: 404 },
      );
    }
    const now = Date.now();
    const newBudgetAtomic = BigInt(parseResult.data.budgetAtomic);
    const authResult = await authorizeWalletRequest({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
      expected: {
        action: "amend_budget_resolution_agent",
        agentId: agent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: agent.identity.escrowPaymentId,
        bodyHash: hashCanonicalJson(parseResult.data),
        signerAddress: agent.policy.funderAddress,
        fields: {
          "Old Approved Budget (atomic USDC)": agent.policy.approvedBudgetAtomic.toString(),
          "New Approved Budget (atomic USDC)": parseResult.data.budgetAtomic,
          "Funder Address": agent.policy.funderAddress,
        },
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

    const publicView = await amendBudgetResolutionAgent({
      agentId,
      authenticatedCaller: walletAddress,
      newBudgetAtomic,
      now,
      store,
    });

    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
