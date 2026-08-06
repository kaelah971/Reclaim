// ---------------------------------------------------------------------------
// Dispute Brief Result Normalizer
//
// Converts a DisputeBriefGenerationResult into a planner-facing
// DisputeBriefOutcome.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { DisputeBriefOutcome } from "../planner/types";
import type { DisputeBriefGenerationResult } from "./types";

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Convert a raw dispute brief generation result into a normalized
 * planner-facing outcome.
 */
export function normalizeDisputeBriefResult(params: {
  result: DisputeBriefGenerationResult;
  caseVersionHash: string;
  executionStatus: "settled" | "pending" | "failed";
}): DisputeBriefOutcome {
  const { result, caseVersionHash, executionStatus } = params;

  const reviewerPacketReady =
    executionStatus === "settled" && result.briefId !== "";

  return {
    caseVersionHash,
    reviewerPacketReady,
    resultReference: result.briefId || null,
    executionStatus,
  };
}
