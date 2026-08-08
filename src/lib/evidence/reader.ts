// ---------------------------------------------------------------------------
// Production implementation of CaseEvidenceReader using Supabase
// evidence_metadata table.  Reads the current verified evidence for a
// payment case, cross-checking against the on-chain evidenceReference.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase/client";
import type { CaseEvidenceReader } from "@/lib/resolution-agent/observation/types";

export class SupabaseEvidenceReader implements CaseEvidenceReader {
  async getEvidenceMetadata(escrowPaymentId: string) {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("evidence_metadata")
      .select(
        "evidence_reference, title, description, evidence_type, file_hash, file_count, submitted_at",
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
      };
    }

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
    };
  }
}
