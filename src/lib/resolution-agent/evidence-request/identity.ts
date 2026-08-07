// ---------------------------------------------------------------------------
// Evidence Request Identity — deduplication identity computation and
// evidence item / reason normalization.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { EvidenceRequestDedupIdentity } from "./types";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const MAX_EVIDENCE_ITEM_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

/**
 * Normalize an evidence item string for deduplication comparison.
 *
 * Rules:
 *  - Trim leading and trailing whitespace
 *  - Collapse multiple consecutive whitespace characters into a single space
 *  - Enforce a maximum length (MAX_EVIDENCE_ITEM_LENGTH)
 *  - Reject empty strings
 *
 * @throws If the trimmed value is empty.
 */
export function normalizeEvidenceItem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Evidence item must not be empty");
  }
  // Collapse all whitespace (including tabs, newlines) into single spaces
  const collapsed = trimmed.replace(/\s+/g, " ");
  // Enforce max length
  if (collapsed.length > MAX_EVIDENCE_ITEM_LENGTH) {
    return collapsed.slice(0, MAX_EVIDENCE_ITEM_LENGTH);
  }
  return collapsed;
}

/**
 * Normalize a reason string.
 *
 * Rules:
 *  - Trim leading and trailing whitespace
 *  - Collapse multiple consecutive whitespace characters into a single space
 *  - Enforce a maximum length (MAX_REASON_LENGTH)
 *
 * Unlike evidenceItem, an empty reason is NOT rejected (it just becomes
 * an empty string).
 */
export function normalizeReason(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const collapsed = trimmed.replace(/\s+/g, " ");
  if (collapsed.length > MAX_REASON_LENGTH) {
    return collapsed.slice(0, MAX_REASON_LENGTH);
  }
  return collapsed;
}

// ---------------------------------------------------------------------------
// Deduplication identity computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic deduplication identity for an evidence request.
 *
 * Two `create_evidence_request` actions with the same dedup identity MUST
 * result in the same evidence request row.  The identity captures the
 * agent, the responsible party, the normalized evidence item, and the
 * version hashes of the case and evidence at creation time.
 *
 * The timestamp is explicitly NOT included in the identity — two requests
 * issued at different times with the same logical content are duplicates.
 */
export function computeEvidenceRequestDedupIdentity(params: {
  agentId: string;
  responsibleParty: "client" | "worker";
  evidenceItem: string;
  caseVersionHash: string;
  evidenceVersionHash: string;
}): EvidenceRequestDedupIdentity {
  return {
    agentId: params.agentId,
    responsibleParty: params.responsibleParty,
    evidenceItem: normalizeEvidenceItem(params.evidenceItem),
    caseVersionHash: params.caseVersionHash,
    evidenceVersionHash: params.evidenceVersionHash,
  };
}
