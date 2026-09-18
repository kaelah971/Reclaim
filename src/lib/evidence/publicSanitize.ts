// ---------------------------------------------------------------------------
// P4.3D: Public-safe sanitization — receipt + review-packet redaction.
//
// Anonymous/public may see payment state + evidence hash ONLY. ALL plaintext
// delivery evidence is redacted from public routes:
//
//   Redacted (→ null / []):
//     - title, description, relatedClaim/claim, pastedText/text, evidenceDate,
//       externalRef/ref (worker-supplied free text / links)
//     - QC reviewerQuestions, ambiguities, missingEvidence,
//       recommendedImprovements, inconsistencies (may quote worker text —
//       conservative: when in doubt, redact)
//   Kept (safe public fields):
//     - evidence hash (evidenceReference / evidenceVersionHash / fileHash),
//       submitted-at, availability flags, counts (fileCount),
//       substantiveEvidence boolean, evidenceType category
//     - safe receipt data (amounts, parties, states, tx refs)
//     - safe QC provenance (toolId, price, network, facilitator, request hash,
//       readiness enum, settlement/payment/result refs)
//
// Pure functions — no I/O, safe to unit-test without mocks.
// ---------------------------------------------------------------------------

/** Plaintext-bearing evidence keys that must never reach public responses. */
export const REDACTED_EVIDENCE_KEYS = [
  "title",
  "description",
  "relatedClaim",
  "claim",
  "relatedDeliverable",
  "pastedText",
  "text",
  "evidenceDate",
  "date",
  "externalRef",
  "externalReference",
] as const;

/** QC text arrays that may quote worker text — redacted conservatively. */
export const REDACTED_QC_ARRAY_KEYS = [
  "reviewerQuestions",
  "ambiguities",
  "missingEvidence",
  "recommendedImprovements",
  "inconsistencies",
  "qcInconsistency",
] as const;

// ---------------------------------------------------------------------------
// Receipt-level sanitizers (match ReceiptEvidence / ReceiptQualityCheck shape)
// ---------------------------------------------------------------------------

export interface PublicReceiptEvidenceView {
  title: null;
  claim: null;
  date: null;
  pastedText: null;
  evidenceReference: string | null;
  availability: string | null;
  evidenceType: string | null;
  submittedAt: string | null;
  submitter: string | null;
  submissionTxHash: string | null;
}

/**
 * Build the public-safe receipt evidence block. Plaintext inputs are accepted
 * so callers can pass durable facts directly — they are ALWAYS dropped.
 */
export function sanitizeReceiptEvidenceForPublic(input: {
  evidenceReference?: string | null;
  availability?: string | null;
  evidenceType?: string | null;
  submittedAt?: string | null;
  submitter?: string | null;
  submissionTxHash?: string | null;
}): PublicReceiptEvidenceView {
  return {
    title: null,
    claim: null,
    date: null,
    pastedText: null,
    evidenceReference: input.evidenceReference ?? null,
    availability: input.availability ?? null,
    evidenceType: input.evidenceType ?? null,
    submittedAt: input.submittedAt ?? null,
    submitter: input.submitter ?? null,
    submissionTxHash: input.submissionTxHash ?? null,
  };
}

export interface PublicReceiptQualityCheckView {
  toolId: string;
  priceHuman: string | null;
  network: string | null;
  facilitatorUrl: string | null;
  executionRequestHash: string | null;
  readiness: string | null;
  reviewerQuestions: string[];
  ambiguities: string[];
  recommendedImprovements: string[];
  settlementTxHash: string | null;
  paymentReference: string | null;
  resultReference: string | null;
  inconsistencies: string[];
}

/** Public-safe QC block: provenance kept, free-text arrays emptied. */
export function sanitizeReceiptQualityCheckForPublic(input: {
  toolId: string;
  priceHuman?: string | null;
  network?: string | null;
  facilitatorUrl?: string | null;
  executionRequestHash?: string | null;
  readiness?: string | null;
  settlementTxHash?: string | null;
  paymentReference?: string | null;
  resultReference?: string | null;
}): PublicReceiptQualityCheckView {
  return {
    toolId: input.toolId,
    priceHuman: input.priceHuman ?? null,
    network: input.network ?? null,
    facilitatorUrl: input.facilitatorUrl ?? null,
    executionRequestHash: input.executionRequestHash ?? null,
    readiness: input.readiness ?? null,
    reviewerQuestions: [],
    ambiguities: [],
    recommendedImprovements: [],
    settlementTxHash: input.settlementTxHash ?? null,
    paymentReference: input.paymentReference ?? null,
    resultReference: input.resultReference ?? null,
    inconsistencies: [],
  };
}

// ---------------------------------------------------------------------------
// Review-packet sanitizer (durable packet metadata → public-safe view)
// ---------------------------------------------------------------------------

/**
 * Sanitize a durable review packet for public responses. Returns a new object
 * (never mutates the input). Evidence plaintext → null, QC free-text arrays
 * → [], hashes/flags/counts/provenance preserved.
 */
export function sanitizeReviewPacketForPublic(
  packet: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!packet || typeof packet !== "object") return packet;
  const clone = JSON.parse(JSON.stringify(packet)) as Record<string, unknown>;

  const evidence = (clone.evidence ?? {}) as Record<string, unknown>;
  evidence.title = null;
  evidence.description = null;
  evidence.relatedClaim = null;
  evidence.pastedText = null;
  evidence.evidenceDate = null;
  evidence.externalRef = null;
  // Keep: evidenceReference, evidenceType, fileHash, fileCount, availability,
  // substantiveEvidence, caseVersionHash, evidenceVersionHash.
  clone.evidence = evidence;

  const qc = (clone.qualityCheck ?? {}) as Record<string, unknown>;
  qc.reviewerQuestions = [];
  qc.ambiguities = [];
  qc.missingEvidence = [];
  qc.recommendedImprovements = [];
  // Keep: toolId, executionRequestHash, readiness, settlementTxHash,
  // paymentReference, resultReference.
  clone.qualityCheck = qc;

  clone.qcInconsistency = [];

  return clone;
}
