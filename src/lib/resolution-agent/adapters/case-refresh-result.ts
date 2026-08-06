// ---------------------------------------------------------------------------
// Case Refresh Result Normalizer
//
// Converts a CaseRefreshResult from the generator into a planner-facing
// CaseRefreshOutcome.
// ---------------------------------------------------------------------------

import type { CaseRefreshResult } from "../../x402/caseRefreshGenerate";
import type { CaseRefreshOutcome } from "../planner/types";

// ---------------------------------------------------------------------------
// Readiness mapping: generator readiness → planner readiness
// ---------------------------------------------------------------------------

type GeneratorReadiness = CaseRefreshResult["readiness"];
type PlannerReadiness = CaseRefreshOutcome["readiness"];

function mapReadiness(readiness: GeneratorReadiness): PlannerReadiness {
  switch (readiness) {
    case "ready":
      return "ready";
    case "needs_more_evidence":
      return "needs_evidence";
    case "blocked":
      return "needs_clarification";
    default:
      return "needs_clarification";
  }
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

export function normalizeCaseRefreshResult(
  result: CaseRefreshResult,
  executionStatus: "settled" | "pending" | "failed",
): CaseRefreshOutcome {
  const readiness = mapReadiness(result.readiness);

  return {
    caseVersionHash: result.caseVersionHash,
    readiness,
    unresolvedEvidenceGaps: result.unresolvedEvidenceGaps,
    newQuestions: result.newQuestions,
    executionStatus,
  };
}
