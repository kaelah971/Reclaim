// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/delivery-evaluation
//
// Agent-assisted delivery review (P6.2, party-scoped, READ-ONLY).
// Body: { challengeId, signature, chainId, wallet } — the SAME P4.3D
// wallet-challenge flow as .../evidence/plaintext (no second auth model).
//
// - Anonymous (no challenge/signature) → 401 CHALLENGE_REQUIRED.
// - Unrelated wallets → 403 via live on-chain party check.
// - Only DeliverySubmitted/ReleaseRequested evaluate; other states return
//   { available:false } (never fabricated).
// - Response carries requirement statuses + prose ONLY. Delivery plaintext is
//   NEVER included.
// - No signing, no mutation, no transaction broadcast, no autopilot.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  consumeEvidenceChallenge,
  hashEvidenceChallenge,
  verifyEvidenceChallenge,
} from "@/lib/evidence/partyAuth";
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import { CeloEscrowCaseReader } from "@/lib/resolution-agent/api/escrow-reader";
import { parsePaymentData } from "@/lib/contracts/types";
import type { PaymentData } from "@/lib/contracts/types";
import { evaluateDeliveryRequest } from "@/lib/review/evaluationService";
import { completeEvaluationWithAI } from "@/lib/review/aiEvaluation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
    let body: Record<string, unknown> = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") body = raw as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const correlationId =
      request.headers.get("x-correlation-id") ?? randomUUID();

    const result = await evaluateDeliveryRequest(
      {
        verifyChallenge: (input) => verifyEvidenceChallenge(input),
        consumeChallenge: (challengeHash) =>
          consumeEvidenceChallenge({ challengeHash }),
        hashChallenge: (challengeId) => hashEvidenceChallenge(challengeId),
        readPayment: async (id, chainId): Promise<PaymentData | null> => {
          try {
            const reader = new CeloEscrowCaseReader(
              chainId,
              chainId === 42220
                ? process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL
                : process.env.CELO_SEPOLIA_RPC_URL,
            );
            const full = await reader.getFullPayment(id);
            if (!full || (full as { exists?: boolean }).exists === false) {
              return null;
            }
            return parsePaymentData(
              full as Parameters<typeof parsePaymentData>[0],
            );
          } catch {
            return null;
          }
        },
        readEvidence: async (id, chain) => {
          const reader = new SupabaseEvidenceReader();
          return reader.getEvidenceMetadata(id, chain);
        },
        gradeWithAI: (context) =>
          completeEvaluationWithAI(context, correlationId),
      },
      {
        paymentId,
        chainId:
          body.chainId ??
          body.escrowChainId ??
          body.chain_id ??
          body.escrow_chain_id ??
          null,
        wallet:
          typeof body.wallet === "string"
            ? body.wallet
            : typeof body.walletAddress === "string"
              ? body.walletAddress
              : typeof body.signerAddress === "string"
                ? body.signerAddress
                : "",
        challengeId:
          typeof body.challengeId === "string" ? body.challengeId : "",
        signature:
          typeof body.signature === "string"
            ? body.signature
            : typeof body.walletSignature === "string"
              ? body.walletSignature
              : "",
      },
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[delivery-evaluation]", err);
    return NextResponse.json(
      { error: "Failed to review the delivery.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
