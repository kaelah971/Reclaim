// ---------------------------------------------------------------------------
// I6A.1: GET /api/reviews — list reviewable disputes
//
// Only returns payments with actual active disputes (verified on-chain).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import {
  getDecisionsForPayment,
  normalizeEscrowPaymentId,
  type ReviewerOnchainBinding,
} from "@/lib/reviewer/store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { createPublicClient, http } from "viem";
import { CELO_MAINNET_CHAIN_ID, CELO_SEPOLIA_CHAIN_ID } from "@/lib/web3/chains";
import { getEscrowChain, getEscrowContractAddress } from "@/lib/contracts/config";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";

function getRpcUrl(chainId: number): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL || "https://forno.celo.org";
  }
  if (chainId === CELO_SEPOLIA_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL ||
      process.env.NEXT_PUBLIC_CELO_RPC_URL ||
      "https://forno.celo-sepolia.celo-testnet.org";
  }
  throw new Error(`Unsupported escrow chain ${chainId}.`);
}

async function getLiveDisputedEscrow(
  escrowPaymentIdValue: unknown,
  chainIdValue: unknown,
): Promise<ReviewerOnchainBinding | null> {
  const escrowPaymentId = normalizeEscrowPaymentId(escrowPaymentIdValue);
  const chainId = typeof chainIdValue === "number" ? chainIdValue : Number(chainIdValue);
  if (escrowPaymentId === null || !Number.isSafeInteger(chainId) || chainId <= 0) return null;

  try {
    // The address lookup intentionally throws when a chain has no deployed
    // escrow. A missing mainnet deployment must not fall back to Sepolia.
    const escrow = getEscrowContractAddress(chainId);
    const client = createPublicClient({
      chain: getEscrowChain(chainId),
      transport: http(getRpcUrl(chainId)),
    });
    const raw = await client.readContract({
      address: escrow,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [BigInt(escrowPaymentId)],
    });
    const pd = parsePaymentData(raw as Parameters<typeof parsePaymentData>[0]);
    if (pd.id.toString() !== escrowPaymentId || pd.state !== "Disputed") return null;
    return {
      chainId,
      contractAddress: escrow,
      escrowPaymentId: pd.id.toString(),
      client: pd.client,
      worker: pd.worker,
      amount: pd.amount.toString(),
      token: pd.token,
      state: pd.state,
    };
  } catch {
    return null;
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
      .select("payment_identifier, state, brief, created_at, generation_mode, ai_provider, ai_model, escrow_payment_id, chain_id")
      .in("state", ["paid_pending_brief", "settled"])
      .not("brief", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !payments) {
      return NextResponse.json({ cases: [], reviewerAddress });
    }

    const cases = [];
    for (const payment of payments as Array<Record<string, unknown>>) {
      const escrowPaymentId = normalizeEscrowPaymentId(payment.escrow_payment_id);
      if (escrowPaymentId === null) continue;

      // Exclude non-disputed payments: verify on-chain dispute state
      const onchainBinding = await getLiveDisputedEscrow(escrowPaymentId, payment.chain_id);
      if (!onchainBinding) continue;

      const pid = payment.payment_identifier as string;
      const decisions = await getDecisionsForPayment(pid);
      const latestDecision = decisions.find((d) =>
        d.decision_status === "ready_for_execution" || d.decision_status === "submitted"
      );

      const brief = payment.brief as Record<string, unknown> | null;
      cases.push({
        paymentId: pid,
        agreementTitle: brief?.caseTitle || brief?.neutralCaseTitle || `Payment #${pid}`,
        protectedAmount: onchainBinding.amount,
        client: onchainBinding.client,
        worker: onchainBinding.worker,
        token: onchainBinding.token,
        chainId: onchainBinding.chainId,
        escrowContractAddress: onchainBinding.contractAddress,
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
