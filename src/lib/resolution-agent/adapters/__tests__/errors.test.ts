// ---------------------------------------------------------------------------
// Adapter Errors — Test Suite
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  ResolutionAgentToolAdapterError,
  ResolutionAgentUnsupportedToolError,
  ResolutionAgentToolIdentityMismatchError,
  ResolutionAgentToolStalePlanError,
  ResolutionAgentToolBudgetError,
  ResolutionAgentToolExecutionConflictError,
  ResolutionAgentWalletAddressMismatchError,
  ResolutionAgentSettlementUnpaidError,
  ResolutionAgentSettlementAmbiguousError,
  ResolutionAgentPaidResultRecoveryError,
  ResolutionAgentToolResultValidationError,
} from "../errors";

describe("ResolutionAgentToolAdapterError", () => {
  it("creates with message and code", () => {
    const err = new ResolutionAgentToolAdapterError("test message", "TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("ResolutionAgentToolAdapterError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ResolutionAgentUnsupportedToolError", () => {
  it("includes toolId in message", () => {
    const err = new ResolutionAgentUnsupportedToolError("case-refresh");
    expect(err.message).toBe("Unsupported tool: case-refresh");
    expect(err.code).toBe("UNSUPPORTED_TOOL");
    expect(err).toBeInstanceOf(ResolutionAgentToolAdapterError);
  });
});

describe("ResolutionAgentToolIdentityMismatchError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentToolIdentityMismatchError("price mismatch");
    expect(err.message).toBe("Tool identity mismatch: price mismatch");
    expect(err.code).toBe("TOOL_IDENTITY_MISMATCH");
  });
});

describe("ResolutionAgentToolStalePlanError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentToolStalePlanError("hash mismatch");
    expect(err.message).toBe("Stale plan: hash mismatch");
    expect(err.code).toBe("STALE_PLAN");
  });
});

describe("ResolutionAgentToolBudgetError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentToolBudgetError("insufficient funds");
    expect(err.message).toBe("Budget error: insufficient funds");
    expect(err.code).toBe("TOOL_BUDGET_ERROR");
  });
});

describe("ResolutionAgentToolExecutionConflictError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentToolExecutionConflictError("duplicate request");
    expect(err.message).toBe("Execution conflict: duplicate request");
    expect(err.code).toBe("TOOL_EXECUTION_CONFLICT");
  });
});

describe("ResolutionAgentWalletAddressMismatchError", () => {
  it("never includes address in message", () => {
    const err = new ResolutionAgentWalletAddressMismatchError(
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    );
    expect(err.message).toBe(
      "Wallet address mismatch: decrypted address does not match persisted case wallet address",
    );
    expect(err.code).toBe("WALLET_ADDRESS_MISMATCH");
    // Verify addresses are NOT leaked
    expect(err.message).not.toContain("0xAAAA");
    expect(err.message).not.toContain("0xBBBB");
  });
});

describe("ResolutionAgentSettlementUnpaidError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentSettlementUnpaidError("permit rejected");
    expect(err.message).toBe("Settlement unpaid: permit rejected");
    expect(err.code).toBe("SETTLEMENT_UNPAID");
  });
});

describe("ResolutionAgentSettlementAmbiguousError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentSettlementAmbiguousError("network timeout");
    expect(err.message).toBe("Settlement ambiguous: network timeout");
    expect(err.code).toBe("SETTLEMENT_AMBIGUOUS");
  });
});

describe("ResolutionAgentPaidResultRecoveryError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentPaidResultRecoveryError("generation failed");
    expect(err.message).toBe("Paid result recovery failed: generation failed");
    expect(err.code).toBe("PAID_RESULT_RECOVERY_ERROR");
  });
});

describe("ResolutionAgentToolResultValidationError", () => {
  it("includes detail in message", () => {
    const err = new ResolutionAgentToolResultValidationError("invalid score");
    expect(err.message).toBe("Result validation error: invalid score");
    expect(err.code).toBe("RESULT_VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// Error safety invariants
// ---------------------------------------------------------------------------

describe("Error safety invariants", () => {
  it("no error message contains 'secret' or 'key'", () => {
    const errors = [
      new ResolutionAgentToolAdapterError("test", "X"),
      new ResolutionAgentUnsupportedToolError("test"),
      new ResolutionAgentToolIdentityMismatchError("test"),
      new ResolutionAgentToolStalePlanError("test"),
      new ResolutionAgentToolBudgetError("test"),
      new ResolutionAgentToolExecutionConflictError("test"),
      new ResolutionAgentWalletAddressMismatchError("0xA", "0xB"),
      new ResolutionAgentSettlementUnpaidError("test"),
      new ResolutionAgentSettlementAmbiguousError("test"),
      new ResolutionAgentPaidResultRecoveryError("test"),
      new ResolutionAgentToolResultValidationError("test"),
    ];
    for (const err of errors) {
      const msg = err.message.toLowerCase();
      expect(msg).not.toContain("secret");
      expect(msg).not.toContain("key");
      expect(msg).not.toContain("password");
    }
  });

  it("no error message exposes encrypted data", () => {
    const errors = [
      new ResolutionAgentToolAdapterError("test", "X"),
      new ResolutionAgentUnsupportedToolError("test"),
      new ResolutionAgentToolIdentityMismatchError("test"),
      new ResolutionAgentToolStalePlanError("test"),
      new ResolutionAgentToolBudgetError("test"),
      new ResolutionAgentToolExecutionConflictError("test"),
      new ResolutionAgentWalletAddressMismatchError("0xA", "0xB"),
      new ResolutionAgentSettlementUnpaidError("test"),
      new ResolutionAgentSettlementAmbiguousError("test"),
      new ResolutionAgentPaidResultRecoveryError("test"),
      new ResolutionAgentToolResultValidationError("test"),
    ];
    for (const err of errors) {
      expect(err.message).not.toContain("ciphertext");
      expect(err.message).not.toContain("authenticationTag");
      expect(err.message).not.toContain("encrypted");
    }
  });

  it("wallet address mismatch never exposes raw addresses", () => {
    const err = new ResolutionAgentWalletAddressMismatchError(
      "0x1234567890abcdef1234567890abcdef12345678",
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    const msg = err.message;
    expect(msg).not.toContain("0x1234");
    expect(msg).not.toContain("0xabcd");
  });
});
