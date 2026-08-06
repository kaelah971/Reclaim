// ---------------------------------------------------------------------------
// Adapter Error Classes — typed errors for tool execution, recovery, and dispatch
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

export class ResolutionAgentToolAdapterError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ResolutionAgentToolAdapterError";
  }
}

export class ResolutionAgentUnsupportedToolError extends ResolutionAgentToolAdapterError {
  constructor(toolId: string) {
    super(`Unsupported tool: ${toolId}`, "UNSUPPORTED_TOOL");
  }
}

export class ResolutionAgentToolIdentityMismatchError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Tool identity mismatch: ${detail}`, "TOOL_IDENTITY_MISMATCH");
  }
}

export class ResolutionAgentToolStalePlanError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Stale plan: ${detail}`, "STALE_PLAN");
  }
}

export class ResolutionAgentToolBudgetError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Budget error: ${detail}`, "TOOL_BUDGET_ERROR");
  }
}

export class ResolutionAgentToolExecutionConflictError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Execution conflict: ${detail}`, "TOOL_EXECUTION_CONFLICT");
  }
}

export class ResolutionAgentWalletAddressMismatchError extends ResolutionAgentToolAdapterError {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(expected: string, actual: string) {
    super(
      "Wallet address mismatch: decrypted address does not match persisted case wallet address",
      "WALLET_ADDRESS_MISMATCH",
    );
    // expected and actual are intentionally NOT included in the message to avoid leaking addresses
  }
}

export class ResolutionAgentSettlementUnpaidError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Settlement unpaid: ${detail}`, "SETTLEMENT_UNPAID");
  }
}

export class ResolutionAgentSettlementAmbiguousError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Settlement ambiguous: ${detail}`, "SETTLEMENT_AMBIGUOUS");
  }
}

export class ResolutionAgentPaidResultRecoveryError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Paid result recovery failed: ${detail}`, "PAID_RESULT_RECOVERY_ERROR");
  }
}

export class ResolutionAgentToolResultValidationError extends ResolutionAgentToolAdapterError {
  constructor(detail: string) {
    super(`Result validation error: ${detail}`, "RESULT_VALIDATION_ERROR");
  }
}
