// ---------------------------------------------------------------------------
// Evidence Request Errors — typed error classes for the evidence-request
// service layer.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/**
 * Base error class for all evidence-request–related errors.
 */
export class ResolutionAgentEvidenceRequestError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ResolutionAgentEvidenceRequestError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Specific errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a deduplication identity computation disagrees with the
 * evidence request data (e.g., normalized item does not match).
 */
export class ResolutionAgentEvidenceRequestIdentityMismatchError extends ResolutionAgentEvidenceRequestError {
  constructor(message: string) {
    super(message, "EVIDENCE_REQUEST_IDENTITY_MISMATCH");
    this.name = "ResolutionAgentEvidenceRequestIdentityMismatchError";
  }
}

/**
 * Thrown when a plan's case or evidence version hashes do not match the
 * agent's current observation, indicating the plan is stale.
 */
export class ResolutionAgentEvidenceRequestStalePlanError extends ResolutionAgentEvidenceRequestError {
  constructor(message: string) {
    super(message, "EVIDENCE_REQUEST_STALE_PLAN");
    this.name = "ResolutionAgentEvidenceRequestStalePlanError";
  }
}

/**
 * Thrown when the responsible party for an evidence request is not
 * "client" or "worker".
 */
export class ResolutionAgentEvidenceRequestUnauthorizedPartyError extends ResolutionAgentEvidenceRequestError {
  constructor(message: string) {
    super(message, "EVIDENCE_REQUEST_UNAUTHORIZED_PARTY");
    this.name = "ResolutionAgentEvidenceRequestUnauthorizedPartyError";
  }
}

/**
 * Thrown when there is a conflict with an existing evidence request
 * (e.g., same party, different evidence item, but same identity collision).
 */
export class ResolutionAgentEvidenceRequestConflictError extends ResolutionAgentEvidenceRequestError {
  constructor(message: string) {
    super(message, "EVIDENCE_REQUEST_CONFLICT");
    this.name = "ResolutionAgentEvidenceRequestConflictError";
  }
}

/**
 * Thrown when the agent's current state is incompatible with the
 * requested operation (e.g., agent is closed or expired).
 */
export class ResolutionAgentEvidenceRequestStateError extends ResolutionAgentEvidenceRequestError {
  constructor(message: string) {
    super(message, "EVIDENCE_REQUEST_STATE_ERROR");
    this.name = "ResolutionAgentEvidenceRequestStateError";
  }
}
