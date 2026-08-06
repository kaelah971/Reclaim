// ---------------------------------------------------------------------------
// Worker Module — SERVER-ONLY barrel
//
// NOT exported from src/lib/resolution-agent/index.ts (public barrel).
// Consumed by server-side worker orchestration code only.
// ---------------------------------------------------------------------------

export {
  RUNNABLE_AGENT_STATUSES,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_RENEWAL_THRESHOLD_MS,
  DEFAULT_MAX_ITERATION_MS,
  DEFAULT_MAX_CANDIDATES_TO_SCAN,
  defaultTokenGenerator,
} from "./types";

export type {
  RunnableAgentStatus,
  WorkerCandidate,
  LeaseContext,
  ActionExecutionResult,
  ResolutionAgentActionExecutor,
  RecoveryDecisionKind,
  RecoveryDecision,
  ResolutionAgentRecoveryHandler,
  ResolutionAgentWorkerDependencies,
  ResolutionAgentWorkerResult,
  SecureTokenGenerator,
} from "./types";

export {
  generateLeaseToken,
  computeLeaseExpiry,
  isLeaseActive,
  createLeaseContext,
} from "./lease";

export { classifyResolutionAgentRecovery } from "./recovery";

export { dispatchControlAction, isPlanStale } from "./dispatcher";

export {
  ResolutionAgentWorkerError,
  ResolutionAgentLeaseConflictError,
  ResolutionAgentLeaseLostError,
  ResolutionAgentLeaseExpiredError,
  ResolutionAgentStalePlanError,
  ResolutionAgentWorkerRecoveryError,
  ResolutionAgentUnsupportedActionError,
  ResolutionAgentWorkerConcurrencyError,
} from "./errors";

export { runResolutionAgentWorkerIteration } from "./service";
