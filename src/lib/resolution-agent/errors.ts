import type { ResolutionAgentStatus, ResolutionAgentToolId } from "./types";

// ---------------------------------------------------------------------------
// Domain Error Classes
// ---------------------------------------------------------------------------

export class InvalidAgentStateTransitionError extends Error {
  constructor(
    public readonly from: ResolutionAgentStatus,
    public readonly to: ResolutionAgentStatus,
    public readonly reason: string,
  ) {
    super(`Invalid state transition: ${from} → ${to}: ${reason}`);
    this.name = "InvalidAgentStateTransitionError";
  }
}

export class PolicyViolationError extends Error {
  constructor(
    public readonly violation: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`Policy violation: ${violation}`);
    this.name = "PolicyViolationError";
  }
}

export class InvalidBudgetOperationError extends Error {
  constructor(
    public readonly operation: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`Invalid budget operation: ${operation}`);
    this.name = "InvalidBudgetOperationError";
  }
}

export class UnsafePublicSerializationError extends Error {
  constructor(
    public readonly leakedField: string,
  ) {
    super(`Unsafe public serialization: field "${leakedField}" must not be exposed`);
    this.name = "UnsafePublicSerializationError";
  }
}

export class ToolNotAllowlistedError extends Error {
  constructor(
    public readonly toolId: ResolutionAgentToolId,
  ) {
    super(`Tool not allowlisted: ${toolId}`);
    this.name = "ToolNotAllowlistedError";
  }
}
