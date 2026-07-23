// ---------------------------------------------------------------------------
// I6A.1: GET /api/reviews — list reviewable disputes
//
// Only returns payments with actual active disputes (verified on-chain).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { getDecisionsForPayment } from "@/lib/reviewer/store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { getEscrowAddress as getEscrowContractAddress } from "@/lib/contracts/addresses";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";

function getRpcClient() {
  const rpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";
  return createPublicClient({ chain: celoSepolia, transport: http(rpcUrl) });
}

async function isPaymentDisputed(escrowPaymentId: string): Promise<boolean> {
  if (!escrowPaymentId) return false;
  const escrow = getEscrowContractAddress(11142220);
  if (!escrow) return false;

  try {
    const client = getRpcClient();
    const raw = await client.readContract({
      address: escrow,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [BigInt(escrowPaymentId)],
    });
    const pd = parsePaymentData(raw as Parameters<typeof parsePaymentData>[0]);
    return pd.state === "Disputed";
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  let reviewerAddress: string;
  try {
    reviewerAddress = await requireReviewer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized. Authenticate as a reviewer first." }, { status: 401 });
  }

  try {
    const sb = getSupabaseClient();

    // Get payments that have briefs AND are in reviewable states
    const { data: payments, error } = await sb
      .from("x402_payments")
      .select("payment_identifier, payer_address, pay_to_address, amount_display, state, brief, created_at, generation_mode, ai_provider, ai_model, escrow_payment_id")
      .in("state", ["paid_pending_brief", "settled"])
      .not("brief", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !payments) {
      return NextResponse.json({ cases: [], reviewerAddress });
    }

    const cases = [];
    for (const payment of payments as Array<Record<string, unknown>>) {
      const escrowPaymentId = (payment.escrow_payment_id as string) || "";

      // Exclude non-disputed payments: verify on-chain dispute state
      const disputed = await isPaymentDisputed(escrowPaymentId);
      if (!disputed) continue;

      const pid = payment.payment_identifier as string;
      const decisions = await getDecisionsForPayment(pid);
      const latestDecision = decisions.find((d) =>
        d.decision_status === "ready_for_execution" || d.decision_status === "submitted"
      );

      const brief = payment.brief as Record<string, unknown> | null;
      cases.push({
        paymentId: pid,
        agreementTitle: brief?.caseTitle || brief?.neutralCaseTitle || `Payment #${pid}`,
        protectedAmount: brief?.protectedAmount || (payment.amount_display as string),
        client: payment.payer_address as string,
        worker: payment.pay_to_address as string,
        state: payment.state as string,
        generationMode: payment.generation_mode as string,
        provider: payment.ai_provider as string,
        model: payment.ai_model as string,
        createdAt: payment.created_at as string,
        escrowPaymentId,
        evidenceCount: Array.isArray(brief?.evidenceInventory) ? (brief as Record<string, unknown[]>).evidenceInventory!.length : 0,
        missingEvidenceCount: Array.isArray(brief?.missingEvidence) ? (brief as Record<string, unknown[]>).missingEvidence!.length : 0,
        reviewStatus: latestDecision ? latestDecision.decision_status : "awaiting_review",
        latestDecision: latestDecision
          ? { id: latestDecision.id, decision: latestDecision.decision, status: latestDecision.decision_status, submittedAt: latestDecision.submitted_at }
          : null,
      });
    }

    cases.sort((a, b) => {
      if (a.reviewStatus === "awaiting_review" && b.reviewStatus !== "awaiting_review") return -1;
      if (a.reviewStatus !== "awaiting_review" && b.reviewStatus === "awaiting_review") return 1;
      return 0;
    });

    return NextResponse.json({ cases, reviewerAddress });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
