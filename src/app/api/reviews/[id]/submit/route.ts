// ---------------------------------------------------------------------------
// I6A: POST /api/reviews/[id]/submit — submit reviewer decision
//
// Validates against live on-chain state before accepting submission.
// Marks decision as ready_for_execution. Does NOT execute settlement.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import {
  getDecisionsForPayment,
  getReviewerBindingMismatches,
  normalizeEscrowPaymentId,
  submitDecision,
  supersedeDecision,
  type ReviewerOnchainBinding,
} from "@/lib/reviewer/store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { createPublicClient, http } from "viem";
import { CELO_MAINNET_CHAIN_ID, CELO_SEPOLIA_CHAIN_ID } from "@/lib/web3/chains";
import { getEscrowChain, getEscrowContractAddress } from "@/lib/contracts/config";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";
import { z } from "zod";

const submitSchema = z.object({
  decisionId: z.string().uuid(),
  supersedePrevious: z.boolean().optional(),
});

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

async function readLiveEscrowBinding(
  escrowPaymentId: string,
  chainId: number,
): Promise<ReviewerOnchainBinding> {
  const contractAddress = getEscrowContractAddress(chainId);
  const client = createPublicClient({
    chain: getEscrowChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
  const raw = await client.readContract({
    address: contractAddress,
    abi: protectedPaymentEscrowABI,
    functionName: "getPayment",
    args: [BigInt(escrowPaymentId)],
  });
  const pd = parsePaymentData(raw as Parameters<typeof parsePaymentData>[0]);

  // getPayment is called with the canonical numeric ID, but verify the
  // returned ID as well so an RPC/provider response can never be rebound.
  if (pd.id.toString() !== escrowPaymentId) {
    throw new Error("Live escrow payment ID differs from the stored escrow_payment_id.");
  }

  return {
    chainId,
    contractAddress,
    escrowPaymentId: pd.id.toString(),
    client: pd.client,
    worker: pd.worker,
    amount: pd.amount.toString(),
    token: pd.token,
    state: pd.state,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let reviewerAddress: string;
  try {
    reviewerAddress = await requireReviewer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: paymentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parseResult = submitSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "validation failed", details: parseResult.error.issues }, { status: 400 });
  }

  const { decisionId, supersedePrevious } = parseResult.data;

  try {
    // Verify the decision exists and belongs to this reviewer
    const decisions = await getDecisionsForPayment(paymentId);
    const targetDecision = decisions.find(
      (d) => d.id === decisionId && d.reviewer_address.toLowerCase() === reviewerAddress.toLowerCase(),
    );

    if (!targetDecision) {
      return NextResponse.json({ error: "Decision not found or not yours." }, { status: 404 });
    }

    if (targetDecision.decision_status !== "draft") {
      return NextResponse.json({ error: "Only draft decisions can be submitted." }, { status: 409 });
    }

    // Validate decision content
    if (!targetDecision.rationale || targetDecision.rationale.length < 20) {
      return NextResponse.json({ error: "Rationale must be at least 20 characters." }, { status: 400 });
    }

    if (targetDecision.decision === "partial_resolution") {
      if (!targetDecision.client_amount || !targetDecision.worker_amount) {
        return NextResponse.json({ error: "Partial resolution requires both client and worker amounts." }, { status: 400 });
      }
    }

    // Read live on-chain state
    const sb = getSupabaseClient();
    const { data: payment } = await sb
      .from("x402_payments")
      .select("escrow_payment_id, chain_id")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (!payment) {
      return NextResponse.json({ error: "Payment record not found." }, { status: 404 });
    }

    const escrowPaymentId = normalizeEscrowPaymentId(payment.escrow_payment_id);
    if (escrowPaymentId === null) {
      return NextResponse.json({
        error: "Stored escrow_payment_id is missing or not a numeric on-chain payment ID.",
      }, { status: 409 });
    }

    const chainId = typeof payment.chain_id === "number" ? payment.chain_id : Number(payment.chain_id);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "Stored escrow chain ID is invalid." }, { status: 409 });
    }

    // Verify on-chain state and derive all escrow identity fields from the
    // live contract. x402 service amount/payTo values are deliberately not
    // treated as the escrow amount or worker.
    try {
      const binding = await readLiveEscrowBinding(escrowPaymentId, chainId);

      if (binding.state !== "Disputed") {
        return NextResponse.json({
          error: `On-chain payment state is "${binding.state}". Only Disputed payments can receive final reviewer decisions.`,
        }, { status: 409 });
      }

      // A draft may be completely unbound. Any pre-existing binding, however,
      // must match the live escrow exactly; this catches stale or tampered
      // client, worker, amount, token, chain, contract, and ID values.
      const bindingMismatches = getReviewerBindingMismatches(targetDecision, binding);
      if (bindingMismatches.length > 0) {
        return NextResponse.json({
          error: "Persisted reviewer escrow binding does not match live on-chain data.",
          fields: bindingMismatches,
        }, { status: 409 });
      }

      // --- Race safety: check for existing ready_for_execution decisions ---
      // The migration also backs this up with a partial unique index.
      const { data: existingReady } = await sb
        .from("reviewer_decisions")
        .select("id, reviewer_address")
        .eq("payment_identifier", paymentId)
        .eq("decision_status", "ready_for_execution")
        .maybeSingle();

      if (existingReady && existingReady.id !== decisionId) {
        return NextResponse.json({
          error: "Another reviewer has already submitted a final decision for this payment.",
          existingDecisionId: existingReady.id,
        }, { status: 409 });
      }

      // Supersede previous decisions only after all live identity checks pass.
      if (supersedePrevious) {
        for (const d of decisions) {
          if (d.id !== decisionId && (d.decision_status === "submitted" || d.decision_status === "ready_for_execution")) {
            const newDraftInput = {
              payment_identifier: paymentId,
              reviewer_address: d.reviewer_address,
              decision: d.decision as "release_to_worker" | "refund_to_client" | "partial_resolution" | "needs_more_evidence",
              rationale: d.rationale,
              evidence_notes: d.evidence_notes ?? undefined,
              conditions: d.conditions ?? undefined,
              client_amount: d.client_amount ?? undefined,
              worker_amount: d.worker_amount ?? undefined,
            };
            await supersedeDecision(d.id, reviewerAddress, newDraftInput);
          }
        }
      }

      // Persist the binding and ready status in one conditional update. No
      // transaction construction occurs anywhere in the submit path.
      const submitted = await submitDecision(decisionId, reviewerAddress, binding);

      if (!submitted) {
        return NextResponse.json({ error: "Failed to submit decision." }, { status: 409 });
      }

      console.log(`[reviewer] Decision ${decisionId} submitted by ${reviewerAddress} for payment ${paymentId}`);

      return NextResponse.json({
        success: true,
        decision: submitted,
        message: "Decision submitted. It is now ready_for_execution. No funds have been moved.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("PaymentNotFound")) {
        return NextResponse.json({ error: "On-chain payment not found." }, { status: 404 });
      }
      if (/payment ID differs/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      if (message.includes("not deployed")) {
        return NextResponse.json({ error: `Escrow configuration rejected: ${message}` }, { status: 503 });
      }
      return NextResponse.json({ error: `On-chain validation failed: ${message}` }, { status: 502 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
