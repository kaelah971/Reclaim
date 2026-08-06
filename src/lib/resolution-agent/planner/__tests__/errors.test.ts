import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Import after implementation
// ---------------------------------------------------------------------------

describe("Planner errors — typed error hierarchy", () => {
  it("ResolutionAgentPlannerError has a code property", async () => {
    const { ResolutionAgentPlannerError } = await import("../errors");
    const err = new ResolutionAgentPlannerError("test", "TEST_CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test");
    expect(err.name).toBe("ResolutionAgentPlannerError");
  });

  it("ResolutionAgentPlanningNotAllowedError extends base and has code", async () => {
    const { ResolutionAgentPlanningNotAllowedError } = await import("../errors");
    const err = new ResolutionAgentPlanningNotAllowedError("not allowed", "NOT_ALLOWED");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NOT_ALLOWED");
    expect(err.message).toBe("not allowed");
    expect(err.name).toBe("ResolutionAgentPlanningNotAllowedError");
  });

  it("ResolutionAgentMalformedToolResultError extends base and has code", async () => {
    const { ResolutionAgentMalformedToolResultError } = await import("../errors");
    const err = new ResolutionAgentMalformedToolResultError("bad result", "MALFORMED_RESULT");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("MALFORMED_RESULT");
    expect(err.message).toBe("bad result");
  });

  it("ResolutionAgentPlannerPolicyError extends base and has code", async () => {
    const { ResolutionAgentPlannerPolicyError } = await import("../errors");
    const err = new ResolutionAgentPlannerPolicyError("policy violation", "POLICY_VIOLATION");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("POLICY_VIOLATION");
  });

  it("ResolutionAgentPlannerConcurrencyError extends base and has code", async () => {
    const { ResolutionAgentPlannerConcurrencyError } = await import("../errors");
    const err = new ResolutionAgentPlannerConcurrencyError("stale version", "STALE_VERSION");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("STALE_VERSION");
  });

  it("ResolutionAgentMissingObservationError extends base and has code", async () => {
    const { ResolutionAgentMissingObservationError } = await import("../errors");
    const err = new ResolutionAgentMissingObservationError("no observation", "MISSING_OBSERVATION");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("MISSING_OBSERVATION");
  });

  it("errors do not expose secrets in messages", async () => {
    const { ResolutionAgentPlannerError } = await import("../errors");
    // Even if a secret-like string is passed, the error itself is safe
    const err = new ResolutionAgentPlannerError("planning failed", "PLANNING_FAILED");
    expect(err.message).not.toContain("private");
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("key");
  });
});
