// ---------------------------------------------------------------------------
// Verified evidence metadata persistence (server-side)
//
// Single source of truth for the evidence metadata write path:
//   1. Reconstruct the canonical manifest and compute its keccak256 hash.
//   2. Read the CURRENT on-chain evidenceReference via getPayment using the
//      CANONICAL full escrow ABI (the Payment struct — never a partial
//      output ABI, which would mis-decode paymentId as the reference).
//   3. Require an exact hash match before persisting anything.
//   4. Persist a versioned row and mark all other versions as not current
//      (previous versions are preserved, never deleted).
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { buildEvidenceManifest, type EvidenceFormData } from "@/lib/evidence/manifest";

export type EvidenceMetadataPersistStatus =
  | "persisted"
  | "already_existed"
  | "review_locked"
  | "hash_mismatch"
  | "chain_read_failed"
  | "insert_failed";

export interface EvidenceMetadataPersistResult {
  status: EvidenceMetadataPersistStatus;
  evidenceReference: string | null;
  rowId: string | null;
  detail?: string;
}

export interface EvidenceMetadataChainReader {
  readContract(args: {
    address: `0x${string}`;
    abi: typeof protectedPaymentEscrowABI;
    functionName: "getPayment";
    args: [bigint];
  }): Promise<{ evidenceReference: `0x${string}` }>;
}

export async function persistVerifiedEvidenceMetadata(params: {
  chainReader: EvidenceMetadataChainReader;
  store: SupabaseClient;
  escrowAddress: `0x${string}`;
  escrowChainId: string;
  paymentId: string;
  data: EvidenceFormData;
}): Promise<EvidenceMetadataPersistResult> {
  const { chainReader, store, escrowAddress, escrowChainId, paymentId, data } = params;

  // 1. Reconstruct manifest + hash server-side
  const manifest = buildEvidenceManifest(data);
  const computedHash = keccak256(stringToHex(manifest)).toLowerCase();

  // 2. Read the real current on-chain reference (canonical full ABI)
  let onChainReference: `0x${string}`;
  try {
    const payment = await chainReader.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [BigInt(paymentId)],
    });
    onChainReference = payment.evidenceReference;
  } catch {
    return {
      status: "chain_read_failed",
      evidenceReference: null,
      rowId: null,
      detail: "getPayment failed — payment may not exist on the escrow contract.",
    };
  }

  const normalizedReference = onChainReference.toLowerCase();

  // 3. Exact hash match required before persisting anything
  if (computedHash !== normalizedReference) {
    return {
      status: "hash_mismatch",
      evidenceReference: normalizedReference,
      rowId: null,
      detail: computedHash,
    };
  }

  // 4. Idempotency: the same case + reference is stored only once
  const { data: existing } = await store
    .from("evidence_metadata")
    .select("id")
    .eq("escrow_payment_id", paymentId)
    .eq("escrow_chain_id", escrowChainId)
    .eq("escrow_contract_address", escrowAddress.toLowerCase())
    .eq("evidence_reference", normalizedReference)
    .maybeSingle();

  if (existing) {
    return {
      status: "already_existed",
      evidenceReference: normalizedReference,
      rowId: existing.id,
    };
  }

  // Fast-path the database trigger below. The trigger remains the authority
  // because this read can race a reviewer draft under concurrent requests.
  const { data: reviewLock, error: reviewLockError } = await store
    .from("evidence_review_locks")
    .select("locked_at")
    .eq("escrow_chain_id", escrowChainId)
    .eq("escrow_payment_id", paymentId)
    .maybeSingle();

  if (reviewLockError) {
    return {
      status: "insert_failed",
      evidenceReference: normalizedReference,
      rowId: null,
      detail: reviewLockError.message,
    };
  }

  if (reviewLock) {
    return {
      status: "review_locked",
      evidenceReference: normalizedReference,
      rowId: null,
      detail: "Reviewer review has begun; evidence metadata is immutable.",
    };
  }

  // 5. Persist the new version
  const fileCount = data.fileHash ? 1 : 0;
  const { data: inserted, error: insertErr } = await store
    .from("evidence_metadata")
    .insert({
      escrow_chain_id: escrowChainId,
      escrow_contract_address: escrowAddress.toLowerCase(),
      escrow_payment_id: paymentId,
      evidence_reference: normalizedReference,
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

  if (insertErr || !inserted) {
    const detail = insertErr?.message ?? "insert returned no row";
    if (detail.includes("immutable after reviewer review begins")) {
      return {
        status: "review_locked",
        evidenceReference: normalizedReference,
        rowId: null,
        detail,
      };
    }
    return {
      status: "insert_failed",
      evidenceReference: normalizedReference,
      rowId: null,
      detail,
    };
  }

  // 6. Mark all OTHER versions as not current (previous versions preserved)
  await store
    .from("evidence_metadata")
    .update({ is_current: false })
    .eq("escrow_payment_id", paymentId)
    .eq("escrow_chain_id", escrowChainId)
    .eq("escrow_contract_address", escrowAddress.toLowerCase())
    .neq("id", inserted.id);

  return {
    status: "persisted",
    evidenceReference: normalizedReference,
    rowId: inserted.id,
  };
}
