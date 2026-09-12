// ---------------------------------------------------------------------------
// I6A.1: GET /api/reviews/[id] — get review case detail
//
// Validates that the payment is associated with an active on-chain dispute
// before serving case data.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { requireReviewer } from "@/lib/reviewer/auth";
import { getDecisionsForPayment, normalizeEscrowPaymentId } from "@/lib/reviewer/store";
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

export async function GET(
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

  try {
    const sb = getSupabaseClient();
    const { data: payment } = await sb
      .from("x402_payments")
      .select("*")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (!payment) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const escrowPaymentId = normalizeEscrowPaymentId(payment.escrow_payment_id);
    const chainId = typeof payment.chain_id === "number" ? payment.chain_id : Number(payment.chain_id);
    if (
      escrowPaymentId === null ||
      !Number.isSafeInteger(chainId) ||
      chainId <= 0
    ) {
      return NextResponse.json({
        error: "This reviewer case has no valid numeric escrow_payment_id and cannot be reviewed.",
      }, { status: 422 });
    }

    const brief = payment.brief as Record<string, unknown> | null;
    const decisions = await getDecisionsForPayment(paymentId);

    // Read live on-chain state
    let onchainData = null;
    let isDisputed = false;
    try {
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
      if (pd.id.toString() !== escrowPaymentId) {
        throw new Error("Live escrow payment ID differs from escrow_payment_id.");
      }
      onchainData = {
        id: pd.id.toString(),
        chainId,
        contractAddress: escrow,
        client: pd.client,
        worker: pd.worker,
        amount: pd.amount.toString(),
        token: pd.token,
        state: pd.state,
        evidenceReference: pd.evidenceReference || null,
        disputeReference: pd.disputeReference || null,
      };
      isDisputed = pd.state === "Disputed";
    } catch (err) {
      if (err instanceof Error && /not deployed on chain/i.test(err.message)) {
        return NextResponse.json({
          error: `Escrow configuration rejected: ${err.message}`,
        }, { status: 503 });
      }
      if (err instanceof Error && /payment ID differs/i.test(err.message)) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      // On-chain read failed — use stored data
    }

    // Reject if payment is not in a disputed state on-chain and has no prior decisions
    if (!isDisputed && decisions.length === 0) {
      return NextResponse.json({
        error: "This payment is not currently in a disputed state and has no prior review decisions.",
        onchainState: onchainData?.state || "unknown",
      }, { status: 422 });
    }

    return NextResponse.json({
      paymentId,
      brief,
      onchainData,
      isDisputed,
      decisions: decisions.map((d) => ({
        id: d.id,
        decision: d.decision,
        rationale: d.rationale,
        clientAmount: d.client_amount,
        workerAmount: d.worker_amount,
        status: d.decision_status,
        reviewer: d.reviewer_address,
        createdAt: d.created_at,
        submittedAt: d.submitted_at,
      })),
      stored: {
        payer_address: payment.payer_address,
        pay_to_address: payment.pay_to_address,
        amount_display: payment.amount_display,
        amount_atomic: payment.amount_atomic,
        state: payment.state,
        transaction_hash: payment.transaction_hash,
        escrow_payment_id: escrowPaymentId,
        generation_mode: payment.generation_mode,
        ai_provider: payment.ai_provider,
        ai_model: payment.ai_model,
        created_at: payment.created_at,
      },
      reviewerAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
