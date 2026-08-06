// ---------------------------------------------------------------------------
// Resolution Agent Store — error classes
// ---------------------------------------------------------------------------

export class ResolutionAgentStoreError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ResolutionAgentStoreError";
  }
}

export class ResolutionAgentNotFoundError extends ResolutionAgentStoreError {
  constructor(public readonly agentId: string) {
    super(`Resolution agent not found: ${agentId}`);
    this.name = "ResolutionAgentNotFoundError";
  }
}

export class ResolutionAgentAlreadyExistsError extends ResolutionAgentStoreError {
  constructor(public readonly agentId: string) {
    super(`Resolution agent already exists: ${agentId}`);
    this.name = "ResolutionAgentAlreadyExistsError";
  }
}

export class ResolutionAgentConcurrencyError extends ResolutionAgentStoreError {
  constructor(
    public readonly agentId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrency conflict for agent ${agentId}: expected version ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "ResolutionAgentConcurrencyError";
  }
}

export class ResolutionAgentSerializationError extends ResolutionAgentStoreError {
  constructor(message: string) {
    super(`Serialization error: ${message}`);
    this.name = "ResolutionAgentSerializationError";
  }
}

export class ResolutionAgentToolExecutionConflictError extends ResolutionAgentStoreError {
  constructor(agentId: string, requestHash: string) {
    super(
      `Tool execution conflict for agent ${agentId}: request hash ${requestHash} already exists`,
    );
    this.name = "ResolutionAgentToolExecutionConflictError";
  }
}
