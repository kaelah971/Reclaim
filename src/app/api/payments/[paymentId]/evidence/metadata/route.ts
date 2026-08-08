// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/evidence/metadata
//
// Persist cryptographically verified evidence metadata after a successful
// on-chain evidence submission.  The server independently verifies the
// manifest hash against the current on-chain evidenceReference.
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
//   404 — payment not found on-chain
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { keccak256, stringToHex, createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildEvidenceManifest, type EvidenceFormData } from "@/lib/evidence/manifest";
import { CeloSepoliaEscrowCaseReader, CANONICAL_ESCROW_CONTRACT_ADDRESS } from "@/lib/resolution-agent/api/escrow-reader";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";

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

    const data = body as EvidenceFormData;

    // Build canonical manifest and compute hash (server-side)
    const manifest = buildEvidenceManifest(data);
    const computedHash = keccak256(stringToHex(manifest));

    // Read current on-chain evidenceReference
    const viemClient = createPublicClient({
      chain: celoSepolia,
      transport: http("https://rpc.ankr.com/celo_sepolia", { timeout: 10000 }),
    });

    const payment = await viemClient.readContract({
      address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
      abi: [{
        inputs: [{ name: "paymentId", type: "uint256" }],
        name: "getPayment",
        outputs: [{ type: "tuple", components: [{ name: "evidenceReference", type: "bytes32" }] }],
        stateMutability: "view",
        type: "function",
      }],
      functionName: "getPayment",
      args: [BigInt(paymentId)],
    }) as unknown as { evidenceReference: string };

    const onChainReference = payment.evidenceReference;

    // Verify hash match
    if (computedHash.toLowerCase() !== onChainReference.toLowerCase()) {
      return NextResponse.json({
        error: "Evidence manifest hash does not match the current on-chain evidence reference.",
        code: "HASH_MISMATCH",
        details: { computed: computedHash, onChain: onChainReference },
      }, { status: 400 });
    }

    // Idempotency check
    const supabase = getSupabaseClient();
    const { data: existing } = await supabase
      .from("evidence_metadata")
      .select("id")
      .eq("escrow_payment_id", paymentId)
      .eq("escrow_chain_id", String(CELO_CHAIN_ID))
      .eq("escrow_contract_address", CANONICAL_ESCROW_CONTRACT_ADDRESS.toLowerCase())
      .eq("evidence_reference", onChainReference.toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        id: existing.id,
        evidenceReference: onChainReference,
        alreadyExisted: true,
      }, { status: 200 });
    }

    // Persist
    const fileCount = data.fileHash ? 1 : 0;
    const { data: inserted, error: insertErr } = await supabase
      .from("evidence_metadata")
      .insert({
        escrow_chain_id: String(CELO_CHAIN_ID),
        escrow_contract_address: CANONICAL_ESCROW_CONTRACT_ADDRESS.toLowerCase(),
        escrow_payment_id: paymentId,
        evidence_reference: onChainReference.toLowerCase(),
        manifest,
        title: data.title,
        description: data.description,
        evidence_type: data.type,
        file_hash: data.fileHash || null,
        file_count: fileCount,
        submitter_address: "chain_verified",
        is_current: true,
      })
      .select("id")
      .single();

    if (insertErr) {
      throw new Error(`Failed to persist evidence metadata: ${insertErr.message}`);
    }

    // Mark all other versions as not current
    await supabase
      .from("evidence_metadata")
      .update({ is_current: false })
      .eq("escrow_payment_id", paymentId)
      .neq("id", inserted.id);

    return NextResponse.json({
      id: inserted.id,
      paymentId,
      evidenceReference: onChainReference,
      persisted: true,
    }, { status: 201 });

  } catch (err) {
    console.error(`[evidence-metadata][${correlationId}]`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    }, { status: 500 });
  }
}
