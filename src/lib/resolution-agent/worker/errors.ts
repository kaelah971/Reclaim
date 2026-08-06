// ---------------------------------------------------------------------------
// Worker Error Classes — typed errors for lease, recovery, dispatch
// ---------------------------------------------------------------------------

export class ResolutionAgentWorkerError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ResolutionAgentWorkerError";
  }
}

export class ResolutionAgentLeaseConflictError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Lease conflict", "LEASE_CONFLICT");
  }
}

export class ResolutionAgentLeaseLostError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Lease lost", "LEASE_LOST");
  }
}

export class ResolutionAgentLeaseExpiredError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Lease expired", "LEASE_EXPIRED");
  }
}

export class ResolutionAgentStalePlanError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Stale plan", "STALE_PLAN");
  }
}

export class ResolutionAgentWorkerRecoveryError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Recovery error", "WORKER_RECOVERY_ERROR");
  }
}

export class ResolutionAgentUnsupportedActionError extends ResolutionAgentWorkerError {
  constructor(actionKind: string) {
    super(`Unsupported action: ${actionKind}`, "UNSUPPORTED_ACTION");
  }
}

export class ResolutionAgentWorkerConcurrencyError extends ResolutionAgentWorkerError {
  constructor(msg?: string) {
    super(msg ?? "Concurrency error", "WORKER_CONCURRENCY_ERROR");
  }
}
