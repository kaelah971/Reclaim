import { describe, it, expect } from "vitest";
import {
  ResolutionAgentWorkerError,
  ResolutionAgentLeaseConflictError,
  ResolutionAgentLeaseLostError,
  ResolutionAgentLeaseExpiredError,
  ResolutionAgentStalePlanError,
  ResolutionAgentWorkerRecoveryError,
  ResolutionAgentUnsupportedActionError,
  ResolutionAgentWorkerConcurrencyError,
} from "../errors";

describe("ResolutionAgentWorkerError", () => {
  it("creates with message and code", () => {
    const err = new ResolutionAgentWorkerError("test message", "TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("ResolutionAgentWorkerError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ResolutionAgentLeaseConflictError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentLeaseConflictError();
    expect(err.message).toBe("Lease conflict");
    expect(err.code).toBe("LEASE_CONFLICT");
    expect(err.name).toBe("ResolutionAgentWorkerError");
  });

  it("accepts custom message", () => {
    const err = new ResolutionAgentLeaseConflictError("custom");
    expect(err.message).toBe("custom");
    expect(err.code).toBe("LEASE_CONFLICT");
  });

  it("is instanceof base class", () => {
    const err = new ResolutionAgentLeaseConflictError();
    expect(err).toBeInstanceOf(ResolutionAgentWorkerError);
  });
});

describe("ResolutionAgentLeaseLostError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentLeaseLostError();
    expect(err.message).toBe("Lease lost");
    expect(err.code).toBe("LEASE_LOST");
  });
});

describe("ResolutionAgentLeaseExpiredError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentLeaseExpiredError();
    expect(err.message).toBe("Lease expired");
    expect(err.code).toBe("LEASE_EXPIRED");
  });
});

describe("ResolutionAgentStalePlanError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentStalePlanError();
    expect(err.message).toBe("Stale plan");
    expect(err.code).toBe("STALE_PLAN");
  });

  it("accepts custom message", () => {
    const err = new ResolutionAgentStalePlanError("custom stale");
    expect(err.message).toBe("custom stale");
  });
});

describe("ResolutionAgentWorkerRecoveryError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentWorkerRecoveryError();
    expect(err.message).toBe("Recovery error");
    expect(err.code).toBe("WORKER_RECOVERY_ERROR");
  });
});

describe("ResolutionAgentUnsupportedActionError", () => {
  it("includes action kind in message", () => {
    const err = new ResolutionAgentUnsupportedActionError("run_tool");
    expect(err.message).toBe("Unsupported action: run_tool");
    expect(err.code).toBe("UNSUPPORTED_ACTION");
  });

  it("does not expose secrets in message", () => {
    const err = new ResolutionAgentUnsupportedActionError("run_tool");
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("token");
    expect(err.message).not.toContain("key");
    expect(err.message).not.toContain("password");
  });
});

describe("ResolutionAgentWorkerConcurrencyError", () => {
  it("uses default message", () => {
    const err = new ResolutionAgentWorkerConcurrencyError();
    expect(err.message).toBe("Concurrency error");
    expect(err.code).toBe("WORKER_CONCURRENCY_ERROR");
  });
});

describe("Error safety invariants", () => {
  it("no error message contains 'secret'", () => {
    const errors = [
      new ResolutionAgentWorkerError("test", "X"),
      new ResolutionAgentLeaseConflictError(),
      new ResolutionAgentLeaseLostError(),
      new ResolutionAgentLeaseExpiredError(),
      new ResolutionAgentStalePlanError(),
      new ResolutionAgentWorkerRecoveryError(),
      new ResolutionAgentUnsupportedActionError("test"),
      new ResolutionAgentWorkerConcurrencyError(),
    ];
    for (const err of errors) {
      expect(err.message.toLowerCase()).not.toContain("secret");
    }
  });

  it("no error message exposes encrypted data", () => {
    const errors = [
      new ResolutionAgentWorkerError("test", "X"),
      new ResolutionAgentLeaseConflictError(),
      new ResolutionAgentLeaseLostError(),
      new ResolutionAgentLeaseExpiredError(),
      new ResolutionAgentStalePlanError(),
      new ResolutionAgentWorkerRecoveryError(),
      new ResolutionAgentUnsupportedActionError("test"),
      new ResolutionAgentWorkerConcurrencyError(),
    ];
    for (const err of errors) {
      expect(err.message).not.toContain("ciphertext");
      expect(err.message).not.toContain("authenticationTag");
      expect(err.message).not.toContain("encrypted");
    }
  });
});
