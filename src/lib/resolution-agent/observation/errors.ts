// ---------------------------------------------------------------------------
// Observation Error Classes — typed, safe, never leak secrets or RPC internals
// ---------------------------------------------------------------------------

export class CaseObservationError extends Error {
  public readonly code: string;

  constructor(message: string, code = "CASE_OBSERVATION_ERROR") {
    super(message);
    this.name = "CaseObservationError";
    this.code = code;
  }
}

export class CaseObservationNotAllowedError extends CaseObservationError {
  constructor(agentStatus: string) {
    super(
      `Observation not allowed for agent in status "${agentStatus}". ` +
        "Only agents in observable states may be observed.",
      "CASE_OBSERVATION_NOT_ALLOWED",
    );
    this.name = "CaseObservationNotAllowedError";
  }
}

export class CaseIdentityMismatchError extends CaseObservationError {
  constructor(
    public readonly agentId: string,
    public readonly storedField: string,
    public readonly observedField: string,
  ) {
    super(
      `Case identity mismatch for agent ${agentId}: ` +
        `stored identity does not match observed identity.`,
      "CASE_IDENTITY_MISMATCH",
    );
    this.name = "CaseIdentityMismatchError";
  }
}

export class CaseObservationSerializationError extends CaseObservationError {
  constructor(message: string) {
    super(
      `Serialization error during observation: ${message}`,
      "CASE_OBSERVATION_SERIALIZATION",
    );
    this.name = "CaseObservationSerializationError";
  }
}

export class CaseObservationHashError extends CaseObservationError {
  constructor(message: string) {
    super(
      `Hash computation error during observation: ${message}`,
      "CASE_OBSERVATION_HASH",
    );
    this.name = "CaseObservationHashError";
  }
}

export class CaseEvidenceUnavailableError extends CaseObservationError {
  constructor(escrowPaymentId: string) {
    super(
      `Evidence unavailable for escrow payment ${escrowPaymentId}. ` +
        "No evidence metadata could be retrieved.",
      "CASE_EVIDENCE_UNAVAILABLE",
    );
    this.name = "CaseEvidenceUnavailableError";
  }
}

export class CaseObservationConcurrencyError extends CaseObservationError {
  constructor(
    public readonly agentId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrency conflict during observation for agent ${agentId}: ` +
        `expected version ${expectedVersion}, actual ${actualVersion}. ` +
        "Another process modified the agent record.",
      "CASE_OBSERVATION_CONCURRENCY",
    );
    this.name = "CaseObservationConcurrencyError";
  }
}
