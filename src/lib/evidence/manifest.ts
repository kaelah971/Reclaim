// ---------------------------------------------------------------------------
// Evidence Manifest — canonical serialization shared between client & server
//
// MUST be identical to the EvidenceForm logic.  Both the client (browser)
// and server (API endpoint) use this module to produce the same deterministic
// manifest string from EvidenceFormData.
//
// DO NOT create a second incompatible encoding — this is the SINGLE source
// of truth for evidence manifest construction.
// ---------------------------------------------------------------------------

export interface EvidenceFormData {
  title: string;
  description: string;
  type: string;
  relatedClaim: string;
  date: string;
  externalRef: string;
  pastedText: string;
  fileHash: string;
}

/**
 * Builds the canonical deterministic evidence manifest string.
 *
 * Format: `title:T | type:T | claim:T | date:T | ref:T | text:T | file-sha256:T`
 * Null/empty fields are omitted.  Fields are joined with " | ".
 *
 * This format is hashed with keccak256 and submitted as the on-chain
 * evidenceReference.  Changing this format breaks chain verification.
 */
export function buildEvidenceManifest(data: EvidenceFormData): string {
  const parts: (string | null)[] = [
    `title:${data.title.trim()}`,
    data.type ? `type:${data.type}` : null,
    data.relatedClaim.trim() ? `claim:${data.relatedClaim.trim()}` : null,
    data.date ? `date:${data.date}` : null,
    data.externalRef.trim() ? `ref:${data.externalRef.trim()}` : null,
    data.pastedText.trim() ? `text:${data.pastedText.trim()}` : null,
    data.fileHash ? `file-sha256:${data.fileHash}` : null,
  ];
  return parts.filter((p): p is string => p !== null).join(" | ");
}

/**
 * Compute the evidence reference (keccak256 hash of the canonical manifest).
 * Used by both client and server to derive the on-chain hash from form data.
 */
export { keccak256, stringToHex } from "viem";
