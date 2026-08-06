import { describe, it, expect } from "vitest";
import {
  RUNNABLE_AGENT_STATUSES,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_RENEWAL_THRESHOLD_MS,
  DEFAULT_MAX_ITERATION_MS,
  DEFAULT_MAX_CANDIDATES_TO_SCAN,
  defaultTokenGenerator,
} from "../types";

describe("Worker type constants", () => {
  it("RUNNABLE_AGENT_STATUSES includes active", () => {
    expect(RUNNABLE_AGENT_STATUSES).toContain("active");
  });

  it("RUNNABLE_AGENT_STATUSES includes running_tool", () => {
    expect(RUNNABLE_AGENT_STATUSES).toContain("running_tool");
  });

  it("RUNNABLE_AGENT_STATUSES includes waiting_for_evidence", () => {
    expect(RUNNABLE_AGENT_STATUSES).toContain("waiting_for_evidence");
  });

  it("RUNNABLE_AGENT_STATUSES includes waiting_for_human_approval", () => {
    expect(RUNNABLE_AGENT_STATUSES).toContain("waiting_for_human_approval");
  });

  it("RUNNABLE_AGENT_STATUSES includes failed_recoverable", () => {
    expect(RUNNABLE_AGENT_STATUSES).toContain("failed_recoverable");
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include draft", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain("draft");
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include ready_for_human_review", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain(
      "ready_for_human_review",
    );
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include closed", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain("closed");
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include paused", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain("paused");
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include expired", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain("expired");
  });

  it("RUNNABLE_AGENT_STATUSES does NOT include budget_exhausted", () => {
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain(
      "budget_exhausted",
    );
  });

  it("DEFAULT_LEASE_DURATION_MS is 60 seconds", () => {
    expect(DEFAULT_LEASE_DURATION_MS).toBe(60_000);
  });

  it("DEFAULT_LEASE_RENEWAL_THRESHOLD_MS is 30 seconds", () => {
    expect(DEFAULT_LEASE_RENEWAL_THRESHOLD_MS).toBe(30_000);
  });

  it("DEFAULT_MAX_ITERATION_MS is 45 seconds", () => {
    expect(DEFAULT_MAX_ITERATION_MS).toBe(45_000);
  });

  it("DEFAULT_MAX_CANDIDATES_TO_SCAN is 5", () => {
    expect(DEFAULT_MAX_CANDIDATES_TO_SCAN).toBe(5);
  });

  it("lease duration is longer than renewal threshold", () => {
    expect(DEFAULT_LEASE_DURATION_MS).toBeGreaterThan(
      DEFAULT_LEASE_RENEWAL_THRESHOLD_MS,
    );
  });

  it("max iteration is less than lease duration", () => {
    expect(DEFAULT_MAX_ITERATION_MS).toBeLessThan(DEFAULT_LEASE_DURATION_MS);
  });

  it("lease duration exceeds max iteration for safety margin", () => {
    const margin = DEFAULT_LEASE_DURATION_MS - DEFAULT_MAX_ITERATION_MS;
    expect(margin).toBeGreaterThanOrEqual(15_000);
  });
});

describe("defaultTokenGenerator", () => {
  it("generates a non-empty string", () => {
    const token = defaultTokenGenerator.generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(defaultTokenGenerator.generateToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("generates UUID-format tokens", () => {
    const token = defaultTokenGenerator.generateToken();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(token).toMatch(uuidRegex);
  });
});

describe("RunnableAgentStatus type", () => {
  it("mutable array is readonly const", () => {
    // The const assertion should make this read-only at the type level
    const statuses: readonly string[] = RUNNABLE_AGENT_STATUSES;
    expect(statuses.length).toBe(5);
  });
});
