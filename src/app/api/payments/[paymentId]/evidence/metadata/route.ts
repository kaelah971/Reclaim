// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/evidence/metadata
//
// Persist cryptographically verified evidence metadata after a successful
// on-chain evidence submission.  The server independently verifies the
// manifest hash against the current on-chain evidenceReference (read via
// the canonical full escrow ABI).
//
// Chain-verified: only a caller who knows the exact manifest that was
// hashed and submitted on-chain can persist matching metadata.
//
// Body (JSON):
//   { title, description, type, relatedClaim, date, externalRef, pastedText, fileHash }
//
// Responses:
//   201 — metadata persisted
//   200 — idempotent (same evidence ref already stored)
//   400 — hash mismatch or invalid body
//   409 — reviewer review has begun; evidence is immutable
//   500 — internal error / chain read failure
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  persistVerifiedEvidenceMetadata,
  type EvidenceMetadataChainReader,
} from "@/lib/evidence/persistEvidenceMetadata";
import type { EvidenceFormData } from "@/lib/evidence/manifest";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "@/lib/resolution-agent/api/escrow-reader";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";

const chainReader: EvidenceMetadataChainReader = createPublicClient({
  chain: celoSepolia,
  transport: http("https://rpc.ankr.com/celo_sepolia", { timeout: 10000 }),
});

function isValidEvidenceFormData(body: unknown): body is EvidenceFormData {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.title === "string" &&
    typeof b.description === "string" &&
    typeof b.type === "string" &&
    typeof b.date === "string"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { paymentId } = await params;

    // Parse body
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Malformed JSON body.", code: "INVALID_JSON" }, { status: 400 });
    }

    if (!isValidEvidenceFormData(body)) {
      return NextResponse.json({ error: "Invalid evidence form data.", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const result = await persistVerifiedEvidenceMetadata({
      chainReader,
      store: getSupabaseClient(),
      escrowAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
      escrowChainId: String(CELO_CHAIN_ID),
      paymentId,
      data: body,
    });

    switch (result.status) {
      case "already_existed":
        return NextResponse.json({
          id: result.rowId,
          evidenceReference: result.evidenceReference,
          alreadyExisted: true,
        }, { status: 200 });

      case "persisted":
        return NextResponse.json({
          id: result.rowId,
          paymentId,
          evidenceReference: result.evidenceReference,
          persisted: true,
        }, { status: 201 });

      case "review_locked":
        return NextResponse.json({
          error: result.detail ?? "Reviewer review has begun; evidence metadata is immutable.",
          code: "EVIDENCE_REVIEW_LOCKED",
        }, { status: 409 });

      case "hash_mismatch":
        return NextResponse.json({
          error: "Evidence manifest hash does not match the current on-chain evidence reference.",
          code: "HASH_MISMATCH",
          details: { computed: result.detail, onChain: result.evidenceReference },
        }, { status: 400 });

      case "insert_failed":
        return NextResponse.json({
          error: result.detail ?? "Failed to persist verified evidence metadata.",
          code: "PERSISTENCE_FAILED",
        }, { status: 500 });

      default:
        return NextResponse.json({
          error: result.detail ?? "Failed to read the current on-chain evidence reference.",
          code: "CHAIN_READ_FAILED",
        }, { status: 500 });
    }

  } catch (err) {
    console.error(`[evidence-metadata][${correlationId}]`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    }, { status: 500 });
  }
}
