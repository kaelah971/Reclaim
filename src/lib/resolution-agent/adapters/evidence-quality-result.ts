// ---------------------------------------------------------------------------
// Evidence Quality Result Normalizer
//
// Converts an EvidenceQualityAssessment into a planner-facing
// EvidenceQualityOutcome.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { EvidenceQualityAssessment } from "../../x402/ai/evidenceQualityGenerate";
import type { EvidenceQualityOutcome } from "../planner/types";

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Convert a raw evidence quality assessment into a normalized planner-facing
 * outcome.  The readiness heuristics are:
 *
 *   qualityScore >= 70 → "ready"
 *   qualityScore >= 40 → "needs_improvement"
 *   qualityScore  < 40 → "insufficient"
 */
export function normalizeEvidenceQualityResult(params: {
  assessment: EvidenceQualityAssessment;
  evidenceVersionHash: string;
  executionStatus: "settled" | "pending" | "failed";
}): EvidenceQualityOutcome {
  const { assessment, evidenceVersionHash, executionStatus } = params;

  const readiness: EvidenceQualityOutcome["readiness"] =
    assessment.qualityScore >= 70
      ? "ready"
      : assessment.qualityScore >= 40
        ? "needs_improvement"
        : "insufficient";

  return {
    evidenceVersionHash,
    readiness,
    missingEvidence: [],
    ambiguities: assessment.riskFlags ?? [],
    recommendedImprovements: assessment.recommendedActions ?? [],
    reviewerQuestions: assessment.weaknesses?.map((w) => `Reviewer question: ${w}`) ?? [],
    executionStatus,
  };
}
