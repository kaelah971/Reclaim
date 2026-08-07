// ---------------------------------------------------------------------------
// Evidence Request Module — SERVER-ONLY barrel
//
// NOT exported from src/lib/resolution-agent/index.ts (public barrel).
// Consumed by server-side worker orchestration and dispatcher code only.
// ---------------------------------------------------------------------------

// Types
export type {
  EvidenceRequestDedupIdentity,
  EvidenceRequestCreationParams,
  CreateEvidenceRequestResult,
  EvidenceRequestStore,
} from "./types";

// Errors
export {
  ResolutionAgentEvidenceRequestError,
  ResolutionAgentEvidenceRequestIdentityMismatchError,
  ResolutionAgentEvidenceRequestStalePlanError,
  ResolutionAgentEvidenceRequestUnauthorizedPartyError,
  ResolutionAgentEvidenceRequestConflictError,
  ResolutionAgentEvidenceRequestStateError,
} from "./errors";

// Identity
export {
  computeEvidenceRequestDedupIdentity,
  normalizeEvidenceItem,
  normalizeReason,
} from "./identity";

// Service
export {
  executeCreateEvidenceRequest,
  executeWaitForEvidence,
} from "./service";
