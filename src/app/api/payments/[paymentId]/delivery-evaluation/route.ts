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
  pickEscrowParam,
  resolveRouteEscrow,
} from "@/lib/contracts/escrowIdentity";
import { isSupportedChain } from "@/lib/web3/chains";
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

    // P7.2: optional explicit escrow (body escrow/escrowAddress — mirrors
    // this route's body-only chain scoping). Absent → canonical default
    // (behavior unchanged). Present → allowlist-validated here (fail closed
    // UNKNOWN_ESCROW), then closed over by the injected readers below.
    // An unparseable chain is left for the service's own chain validation.
    let validatedEscrow: `0x${string}` | undefined;
    {
      const rawChainForEscrow =
        body.chainId ??
        body.escrowChainId ??
        body.chain_id ??
        body.escrow_chain_id ??
        null;
      const parsedChainForEscrow =
        typeof rawChainForEscrow === "number"
          ? rawChainForEscrow
          : typeof rawChainForEscrow === "string" && rawChainForEscrow.trim() !== ""
            ? Number(rawChainForEscrow.trim())
            : null;
      const pickedEscrow = pickEscrowParam(
        body.escrow ?? body.escrowAddress ?? body.escrowContractAddress ?? body.escrow_contract_address ?? null,
      );
      if (
        pickedEscrow !== undefined &&
        parsedChainForEscrow !== null &&
        Number.isSafeInteger(parsedChainForEscrow) &&
        isSupportedChain(parsedChainForEscrow)
      ) {
        try {
          validatedEscrow = resolveRouteEscrow(parsedChainForEscrow, pickedEscrow).address;
        } catch {
          return NextResponse.json(
            { error: "Unknown escrow contract for this chain.", code: "UNKNOWN_ESCROW" },
            { status: 400 },
          );
        }
      }
    }

    const result = await evaluateDeliveryRequest(
      {
        verifyChallenge: (input) => verifyEvidenceChallenge({ ...input, escrowAddress: validatedEscrow ?? undefined }),
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
              validatedEscrow ?? undefined,
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
