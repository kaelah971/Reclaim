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
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { amendBudgetResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { amendBudgetRequestSchema } from "@/lib/resolution-agent/api/types";

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
        { error: `Amend-budget message must contain the agent ID "${agentId}".`, code: "MESSAGE_AGENT_ID_MISMATCH" },
        { status: 400 },
      );
    }

    if (!signedMessage.includes("amend_budget_resolution_agent")) {
      return NextResponse.json(
        { error: "Signed message must bind to the amend_budget action.", code: "MESSAGE_ACTION_MISMATCH" },
        { status: 400 },
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
    const now = Date.now();
    const newBudgetAtomic = BigInt(parseResult.data.budgetAtomic);

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
