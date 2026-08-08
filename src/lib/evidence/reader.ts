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

export class SupabaseEvidenceReader implements CaseEvidenceReader {
  async getEvidenceMetadata(escrowPaymentId: string) {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("evidence_metadata")
      .select(
        "evidence_reference, title, description, evidence_type, file_hash, file_count, submitted_at, manifest",
      )
      .eq("escrow_payment_id", escrowPaymentId)
      .eq("is_current", true)
      .maybeSingle();

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
      };
    }

    const substantive = isManifestSubstantive(data.manifest ?? null);

    return {
      evidenceReference: data.evidence_reference,
      title: data.title,
      evidenceType: data.evidence_type,
      description: data.description,
      relatedDeliverable: null,
      externalReference: data.evidence_reference,
      fileCount: data.file_count,
      latestUpdateTimestamp: data.submitted_at
        ? new Date(data.submitted_at).getTime()
        : null,
      substantiveEvidence: substantive,
    };
  }
}
