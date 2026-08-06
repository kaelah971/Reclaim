// ---------------------------------------------------------------------------
// Planner Error Classes — typed, no secrets in messages
// ---------------------------------------------------------------------------

export class ResolutionAgentPlannerError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ResolutionAgentPlannerError";
    this.code = code;
  }
}

export class ResolutionAgentPlanningNotAllowedError extends ResolutionAgentPlannerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ResolutionAgentPlanningNotAllowedError";
  }
}

export class ResolutionAgentMalformedToolResultError extends ResolutionAgentPlannerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ResolutionAgentMalformedToolResultError";
  }
}

export class ResolutionAgentPlannerPolicyError extends ResolutionAgentPlannerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ResolutionAgentPlannerPolicyError";
  }
}

export class ResolutionAgentPlannerConcurrencyError extends ResolutionAgentPlannerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ResolutionAgentPlannerConcurrencyError";
  }
}

export class ResolutionAgentMissingObservationError extends ResolutionAgentPlannerError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ResolutionAgentMissingObservationError";
  }
}
