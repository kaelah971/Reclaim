// ---------------------------------------------------------------------------
// Observation module — server-only barrel export
// SERVER-ONLY — do NOT re-export from the public ../index.ts barrel
// ---------------------------------------------------------------------------

export {
  OBSERVATION_SCHEMA_VERSION,
  ESCROW_STATE_MAP,
  OBSERVABLE_AGENT_STATUSES,
  NON_OBSERVABLE_AGENT_STATUSES,
} from "./types";

export type {
  EscrowState,
  EscrowObservation,
  EvidenceObservation,
  EvidenceAvailability,
  ToolResultObservation,
  EvidenceRequestObservation,
  PriorAgentContext,
  CaseObservation,
  CaseChangeSummary,
  ChangeReasonCode,
  CaseObservationResult,
  CaseObservationReader,
  CaseEvidenceReader,
} from "./types";

export { canonicalize, normalizeAddress } from "./canonicalize";

export {
  computeEvidenceVersionHash,
  computeCaseVersionHash,
  compareCaseObservation,
} from "./hash";

export {
  CaseObservationError,
  CaseObservationNotAllowedError,
  CaseIdentityMismatchError,
  CaseObservationSerializationError,
  CaseObservationHashError,
  CaseEvidenceUnavailableError,
  CaseObservationConcurrencyError,
} from "./errors";

export { observeResolutionAgentCase } from "./service";
