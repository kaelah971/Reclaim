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
  FulfillmentStore,
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

// Fulfillment
export {
  fulfillEvidenceRequest,
  buildEvidencePreimage,
  preimageContainsRequestId,
} from "./fulfillment";
export type { FulfillEvidenceRequestParams } from "./fulfillment";

// Reconciliation
export {
  reconcileEvidenceRequestOnChain,
} from "./reconciliation";
export type {
  ReconciliationResult,
  ReconcileEvidenceRequestParams,
} from "./reconciliation";
