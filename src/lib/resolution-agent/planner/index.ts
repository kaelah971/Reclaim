// ---------------------------------------------------------------------------
// Planner Module — SERVER-ONLY barrel
//
// NOT exported from src/lib/resolution-agent/index.ts (public barrel).
// Consumed by server-side orchestration code only.
// ---------------------------------------------------------------------------

export type {
  PlannerReasonCode,
  ResolutionAgentNextAction,
  EvidenceQualityOutcome,
  CaseRefreshOutcome,
  DisputeBriefOutcome,
  NormalizedToolOutcome,
  ResolutionAgentPlannerInput,
  ResolutionAgentPlanningResult,
} from "./types";

export {
  ALL_PLANNER_RULES,
  nonExecutableAgent,
  existingInFlightTool,
  noEvidence,
  openEvidenceRequest,
  evidenceQualityCheckRequired,
  qualityCheckFoundGaps,
  meaningfulEvidenceChange,
  caseRefreshFoundGaps,
  caseReadyForBrief,
  readyForHumanReview,
  normalizeToolOutcome,
  buildToolRequestIdentity,
  buildEvidenceRequestDedupKey,
} from "./rules";

export { planResolutionAgentNextAction } from "./service";
export type { PlannerStore } from "./service";

export {
  ResolutionAgentPlannerError,
  ResolutionAgentPlanningNotAllowedError,
  ResolutionAgentMalformedToolResultError,
  ResolutionAgentPlannerPolicyError,
  ResolutionAgentPlannerConcurrencyError,
  ResolutionAgentMissingObservationError,
} from "./errors";
