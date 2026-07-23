// ---------------------------------------------------------------------------
// I6A: POST /api/reviews/[id]/submit — submit reviewer decision
//
// Validates against live on-chain state before accepting submission.
// Marks decision as ready_for_execution. Does NOT execute settlement.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { getDecisionsForPayment, submitDecision, supersedeDecision } from "@/lib/reviewer/store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { getEscrowAddress as getEscrowContractAddress } from "@/lib/contracts/addresses";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";
import { z } from "zod";

const submitSchema = z.object({
  decisionId: z.string().uuid(),
  supersedePrevious: z.boolean().optional(),
});

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
      .select("escrow_payment_id, amount_atomic, payer_address, pay_to_address")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (!payment) {
      return NextResponse.json({ error: "Payment record not found." }, { status: 404 });
    }

    // Verify on-chain state
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";
      const client = createPublicClient({ chain: celoSepolia, transport: http(rpcUrl) });
      const escrow = getEscrowContractAddress(11142220);

      if (escrow && payment.escrow_payment_id) {
        const raw = await client.readContract({
          address: escrow,
          abi: protectedPaymentEscrowABI,
          functionName: "getPayment",
          args: [BigInt(payment.escrow_payment_id)],
        });
        const pd = parsePaymentData(raw as Parameters<typeof parsePaymentData>[0]);

        // Validate payment still exists and is in a disputable state
        const disputableStates = ["Funded", "Accepted", "DeliverySubmitted", "ReleaseRequested", "Disputed"];
        if (!disputableStates.includes(pd.state)) {
          return NextResponse.json({
            error: `On-chain payment state is "${pd.state}", which is not currently disputable.`,
          }, { status: 409 });
        }

        // Validate amount matches
        if (pd.amount.toString() !== payment.amount_atomic) {
          return NextResponse.json({
            error: "On-chain amount differs from stored case data. Review cannot proceed.",
          }, { status: 409 });
        }

        // Take on-chain snapshot
        const snapshot = {
          id: pd.id.toString(),
          client: pd.client,
          worker: pd.worker,
          amount: pd.amount.toString(),
          token: pd.token,
          state: pd.state,
          verifiedAt: new Date().toISOString(),
        };

        // Supersede previous decisions if requested
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

        // --- Race safety: check for existing ready_for_execution decisions ---
        // Only one non-superseded ready_for_execution decision per payment
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

        // --- Race safety: verify on-chain state still disputed ---
        // State 6 = Disputed. Only disputed payments should receive final decisions.
        if (pd.state !== "Disputed") {
          return NextResponse.json({
            error: `On-chain payment state is "${pd.state}". Only Disputed payments can receive final reviewer decisions.`,
          }, { status: 409 });
        }

        // --- Race safety: verify client and worker match stored data ---
        if (pd.client.toLowerCase() !== (payment.payer_address as string).toLowerCase()) {
          return NextResponse.json({
            error: "On-chain client address differs from stored case data.",
          }, { status: 409 });
        }

        // Save onchain snapshot to the decision
        await sb.from("reviewer_decisions")
          .update({ onchain_snapshot: snapshot })
          .eq("id", decisionId);

        // Submit the decision
        const submitted = await submitDecision(decisionId, reviewerAddress);

        if (!submitted) {
          return NextResponse.json({ error: "Failed to submit decision." }, { status: 500 });
        }

        console.log(`[reviewer] Decision ${decisionId} submitted by ${reviewerAddress} for payment ${paymentId}`);

        return NextResponse.json({
          success: true,
          decision: submitted,
          message: "Decision submitted. It is now ready_for_execution. No funds have been moved.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("PaymentNotFound")) {
        return NextResponse.json({ error: "On-chain payment not found." }, { status: 404 });
      }
      return NextResponse.json({ error: `On-chain validation failed: ${message}` }, { status: 502 });
    }

    return NextResponse.json({ error: "Could not verify on-chain state." }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
