// ---------------------------------------------------------------------------
// Human-review packet builder (RA1R.8D)
//
// Builds the review packet from PERSISTED data only (no payment): the agent,
// the durable evidence facts (including manifest-derived pasted text / claim /
// date), and the settled QC execution (result + provenance). Verified
// evidence facts are authoritative; contradictory QC statements are marked as
// inconsistencies rather than presented as fact. The historical QC result and
// provenance are never rewritten.
// ---------------------------------------------------------------------------

export interface ReviewPacketEvidenceFacts {
  evidenceReference: string | null;
  title: string | null;
  evidenceType: string | null;
  description: string | null;
  relatedClaim: string | null;
  pastedText: string | null;
  evidenceDate: string | null;
  externalRef: string | null;
  fileHash: string | null;
  fileCount: number;
  availability: string;
  substantiveEvidence: boolean;
  caseVersionHash: string | null;
  evidenceVersionHash: string | null;
}

export interface ReviewPacketQc {
  toolId: string;
  executionRequestHash: string | null;
  readiness: string | null;
  missingEvidence: string[];
  ambiguities: string[];
  reviewerQuestions: string[];
  recommendedImprovements: string[];
  settlementTxHash: string | null;
  paymentReference: string | null;
  resultReference: string | null;
}

/**
 * Detect QC statements that contradict VERIFIED evidence facts. The QC tool
 * may have run on an input that lacked durable facts (RA1R.8D); such stale
 * findings must never be presented as authoritative.
 */
export function detectQcInconsistencies(
  evidence: ReviewPacketEvidenceFacts,
  qc: ReviewPacketQc,
): string[] {
  const inconsistencies: string[] = [];
  const questions = qc.reviewerQuestions.join(" ").toLowerCase();

  if (evidence.pastedText && questions.includes("no pasted text content")) {
    inconsistencies.push(
      "QC states there is no pasted text, but verified evidence contains pasted text.",
    );
  }
  if (evidence.evidenceDate && questions.includes("no date specified")) {
    inconsistencies.push(
      "QC states no date was specified, but verified evidence has a date.",
    );
  }
  if (evidence.relatedClaim && questions.includes("no claim")) {
    inconsistencies.push(
      "QC states no claim was provided, but verified evidence has a claim.",
    );
  }
  return inconsistencies;
}

export interface ReviewPacketInput {
  schemaVersion?: string;
  agentId: string;
  agentObjective?: string;
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  escrowState: string;
  client: string;
  worker: string;
  amountAtomic: string;
  evidence: ReviewPacketEvidenceFacts;
  qualityCheck: ReviewPacketQc;
}

export function buildReviewPacket(input: ReviewPacketInput): Record<string, unknown> {
  const inconsistencies = detectQcInconsistencies(input.evidence, input.qualityCheck);

  return {
    schemaVersion: input.schemaVersion ?? "reclaim-review-packet-v1",
    preparedBy: {
      agentId: input.agentId,
      objective: input.agentObjective ?? "Prepare this payment case for fair human review.",
    },
    disclaimer:
      "The agent prepares the case; people make the final decision. The contract protects the payment.",
    case: {
      escrowChainId: input.escrowChainId,
      escrowContractAddress: input.escrowContractAddress,
      escrowPaymentId: input.escrowPaymentId,
      state: input.escrowState,
      client: input.client,
      worker: input.worker,
      amountAtomic: input.amountAtomic,
    },
    evidence: {
      evidenceReference: input.evidence.evidenceReference,
      title: input.evidence.title,
      evidenceType: input.evidence.evidenceType,
      description: input.evidence.description,
      relatedClaim: input.evidence.relatedClaim,
      pastedText: input.evidence.pastedText,
      evidenceDate: input.evidence.evidenceDate,
      externalRef: input.evidence.externalRef,
      fileHash: input.evidence.fileHash,
      fileCount: input.evidence.fileCount,
      availability: input.evidence.availability,
      substantiveEvidence: input.evidence.substantiveEvidence,
      caseVersionHash: input.evidence.caseVersionHash,
      evidenceVersionHash: input.evidence.evidenceVersionHash,
    },
    qualityCheck: {
      toolId: input.qualityCheck.toolId,
      executionRequestHash: input.qualityCheck.executionRequestHash,
      readiness: input.qualityCheck.readiness,
      missingEvidence: input.qualityCheck.missingEvidence,
      ambiguities: input.qualityCheck.ambiguities,
      reviewerQuestions: input.qualityCheck.reviewerQuestions,
      recommendedImprovements: input.qualityCheck.recommendedImprovements,
      // Original x402 QC provenance — never rewritten.
      settlementTxHash: input.qualityCheck.settlementTxHash,
      paymentReference: input.qualityCheck.paymentReference,
      resultReference: input.qualityCheck.resultReference,
    },
    qcInconsistency: inconsistencies,
    decision: "NO DECISION MADE BY THE AGENT — human review required.",
  };
}
