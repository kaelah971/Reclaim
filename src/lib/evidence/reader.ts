// ---------------------------------------------------------------------------
// Production implementation of CaseEvidenceReader using Supabase
// evidence_metadata table.  Reads the current verified evidence for a
// payment case and determines whether the manifest contains substantive
// agent-readable content usable by Evidence Quality Check.
//
// A manifest is "substantive" when it contains text that QC can consume:
//   - non-empty description (pasted text, claim, or description field)
//   - external reference URL
// A file hash without readable text does NOT make evidence usable.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase/client";
import type { CaseEvidenceReader } from "@/lib/resolution-agent/observation/types";

/**
 * Determines whether the canonical evidence manifest contains sufficient
 * agent-readable content for Evidence Quality Check to consume.
 *
 * A manifest is substantive if it contains at least one of:
 *   - pasted text (`text:` field)
 *   - description / claim (`claim:` field) with non-empty content
 *   - external reference URL (`ref:` field)
 *
 * A file hash (`file-sha256:`) alone does NOT qualify — the agent cannot
 * read file contents without actual file storage/retrieval.
 */
function isManifestSubstantive(manifest: string | null): boolean {
  if (!manifest || manifest.trim().length === 0) return false;

  // Check for substantive content fields in the canonical format:
  //   text:... | claim:... | ref:... | file-sha256:...
  const textMatch = manifest.match(/\btext:(\S.*?)(?:\s*\||$)/);
  const claimMatch = manifest.match(/\bclaim:(\S.*?)(?:\s*\||$)/);
  const refMatch = manifest.match(/\bref:(\S.*?)(?:\s*\||$)/);

  if (textMatch && textMatch[1].trim().length > 0) return true;
  if (claimMatch && claimMatch[1].trim().length > 0) return true;
  if (refMatch && refMatch[1].trim().length > 0) return true;

  return false;
}

// Exported for direct unit testing
export { isManifestSubstantive };

export interface DurableEvidenceMetadata {
  evidenceReference: string | null;
  title: string | null;
  evidenceType: string | null;
  description: string | null;
  relatedDeliverable: string | null;
  externalReference: string | null;
  fileCount: number;
  latestUpdateTimestamp: number | null;
  substantiveEvidence: boolean;
  /** Verified on-chain submitter label (e.g. "chain_verified"). */
  submitterAddress: string | null;
  /** Manifest-derived fields (RA1R.8D) — parsed from the canonical manifest
   *  so substantive facts like pasted text, claim, and date survive into QC
   *  inputs and review packets. */
  relatedClaim: string | null;
  pastedText: string | null;
  evidenceDate: string | null;
  externalRef: string | null;
  fileHash: string | null;
}

/** Extract a single manifest field value (`key:value` up to ` | ` or EOL). */
export function extractManifestField(manifest: string, key: string): string | null {
  const match = manifest.match(new RegExp(`\\b${key}:(.*?)(?:\\s*\\||$)`));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

export class SupabaseEvidenceReader implements CaseEvidenceReader {
  /**
   * Read the current verified evidence for a payment case.
   *
   * @param escrowPaymentId — numeric escrow payment identifier (string).
   * @param escrowChainId — optional chain scope (e.g. "11142220" / 42220).
   *   When omitted, the legacy behavior is preserved (no chain filter) so
   *   existing Sepolia/test callers are unaffected. When provided, the read
   *   is scoped to that chain so Mainnet and Sepolia rows never conflate.
   */
  async getEvidenceMetadata(
    escrowPaymentId: string,
    escrowChainId?: string | number | null,
  ): Promise<DurableEvidenceMetadata> {
    const client = getSupabaseClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = client
      .from("evidence_metadata")
      .select(
        "evidence_reference, title, description, evidence_type, file_hash, file_count, submitted_at, submitter_address, manifest",
      )
      .eq("escrow_payment_id", escrowPaymentId)
      .eq("is_current", true);

    const normalizedChain =
      escrowChainId === null ||
      escrowChainId === undefined ||
      String(escrowChainId).trim() === ""
        ? null
        : String(escrowChainId).trim();
    if (normalizedChain !== null) {
      query = query.eq("escrow_chain_id", normalizedChain);
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      return {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        substantiveEvidence: false,
        submitterAddress: null,
        relatedClaim: null,
        pastedText: null,
        evidenceDate: null,
        externalRef: null,
        fileHash: null,
      };
    }

    const manifest = (data.manifest as string | null) ?? "";
    const substantive = isManifestSubstantive(manifest);

    return {
      evidenceReference: data.evidence_reference,
      title: data.title,
      evidenceType: data.evidence_type,
      description: data.description,
      relatedDeliverable: extractManifestField(manifest, "claim"),
      externalReference: data.evidence_reference,
      fileCount: data.file_count,
      latestUpdateTimestamp: data.submitted_at
        ? new Date(data.submitted_at).getTime()
        : null,
      substantiveEvidence: substantive,
      submitterAddress: (data.submitter_address as string | null) ?? null,
      relatedClaim: extractManifestField(manifest, "claim"),
      pastedText: extractManifestField(manifest, "text"),
      evidenceDate: extractManifestField(manifest, "date"),
      externalRef: extractManifestField(manifest, "ref"),
      fileHash: (data.file_hash as string | null) ?? null,
    };
  }
}
