// ---------------------------------------------------------------------------
// Dispute Brief Result Normalizer — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeDisputeBriefResult } from "../dispute-brief-result";
import type { DisputeBriefGenerationResult } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGenerationResult(overrides: Partial<DisputeBriefGenerationResult> = {}): DisputeBriefGenerationResult {
  return {
    briefId: "brief_001",
    generatedAt: new Date().toISOString(),
    generationMode: "ai",
    reviewerPacketReady: true,
    summary: "A comprehensive dispute brief has been generated.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dispute Brief Result Normalizer", () => {
  it("normalizes a settled result to DisputeBriefOutcome", () => {
    const result = makeGenerationResult();
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "settled",
    });

    expect(outcome.caseVersionHash).toBe("case_hash_v1");
    expect(outcome.reviewerPacketReady).toBe(true);
    expect(outcome.resultReference).toBe("brief_001");
    expect(outcome.executionStatus).toBe("settled");
  });

  it("preserves execution status", () => {
    const settled = normalizeDisputeBriefResult({
      result: makeGenerationResult(),
      caseVersionHash: "case_hash_v1",
      executionStatus: "settled",
    });
    expect(settled.executionStatus).toBe("settled");

    const pending = normalizeDisputeBriefResult({
      result: makeGenerationResult({ reviewerPacketReady: false }),
      caseVersionHash: "case_hash_v1",
      executionStatus: "pending",
    });
    expect(pending.executionStatus).toBe("pending");

    const failed = normalizeDisputeBriefResult({
      result: makeGenerationResult({ briefId: "", reviewerPacketReady: false }),
      caseVersionHash: "case_hash_v1",
      executionStatus: "failed",
    });
    expect(failed.executionStatus).toBe("failed");
  });

  it("reviewerPacketReady is true when settled with a briefId", () => {
    const result = makeGenerationResult({ briefId: "brief_123", reviewerPacketReady: true });
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "settled",
    });
    expect(outcome.reviewerPacketReady).toBe(true);
  });

  it("reviewerPacketReady is false when execution is not settled", () => {
    const result = makeGenerationResult({ briefId: "brief_123" });
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "pending",
    });
    expect(outcome.reviewerPacketReady).toBe(false);
  });

  it("reviewerPacketReady is false when briefId is empty", () => {
    const result = makeGenerationResult({ briefId: "" });
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "settled",
    });
    expect(outcome.reviewerPacketReady).toBe(false);
  });

  it("resultReference is null when briefId is empty", () => {
    const result = makeGenerationResult({ briefId: "" });
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "settled",
    });
    expect(outcome.resultReference).toBeNull();
  });

  it("resultReference is null when briefId is empty string", () => {
    const result = makeGenerationResult({ briefId: "" });
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v1",
      executionStatus: "pending",
    });
    expect(outcome.resultReference).toBeNull();
  });

  it("preserves case version hash", () => {
    const result = makeGenerationResult();
    const outcome = normalizeDisputeBriefResult({
      result,
      caseVersionHash: "case_hash_v42",
      executionStatus: "settled",
    });
    expect(outcome.caseVersionHash).toBe("case_hash_v42");
  });
});
