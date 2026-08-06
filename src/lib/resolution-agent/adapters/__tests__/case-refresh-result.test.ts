// ---------------------------------------------------------------------------
// Case Refresh Adapter Result — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeCaseRefreshResult } from "../case-refresh-result";
import type { CaseRefreshResult } from "../../../x402/caseRefreshGenerate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<CaseRefreshResult> = {}): CaseRefreshResult {
  return {
    caseVersionHash: "case_hash_v3",
    evidenceVersionHash: "ev_hash_v2",
    readiness: "ready",
    generatedAt: new Date().toISOString(),
    generationMode: "ai",
    changeSummary: "Evidence has been updated with new screenshots",
    addressedEvidenceGaps: ["Missing screenshot"],
    remainingEvidenceGaps: [],
    unresolvedEvidenceGaps: [],
    newQuestions: [],
    reviewerQuestionsResolved: ["When was the delivery made?"],
    reviewerQuestionsRemaining: [],
    conciseReviewerSummary: "Case is ready for review after evidence update",
    resultVersion: "1.0.0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Case Refresh Result Normalizer", () => {
  it("normalizes a settled result to CaseRefreshOutcome", () => {
    const result = makeResult({ readiness: "ready" });
    const outcome = normalizeCaseRefreshResult(result, "settled");

    expect(outcome.caseVersionHash).toBe("case_hash_v3");
    expect(outcome.readiness).toBe("ready");
    expect(outcome.executionStatus).toBe("settled");
    expect(outcome.unresolvedEvidenceGaps).toEqual([]);
    expect(outcome.newQuestions).toEqual([]);
  });

  it('maps "ready" directly to "ready"', () => {
    const result = makeResult({ readiness: "ready" });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.readiness).toBe("ready");
  });

  it('maps "needs_more_evidence" to "needs_evidence"', () => {
    const result = makeResult({ readiness: "needs_more_evidence" });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.readiness).toBe("needs_evidence");
  });

  it('maps "blocked" to "needs_clarification"', () => {
    const result = makeResult({ readiness: "blocked" });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.readiness).toBe("needs_clarification");
  });

  it("preserves execution status", () => {
    const settled = normalizeCaseRefreshResult(makeResult(), "settled");
    expect(settled.executionStatus).toBe("settled");

    const pending = normalizeCaseRefreshResult(makeResult(), "pending");
    expect(pending.executionStatus).toBe("pending");

    const failed = normalizeCaseRefreshResult(makeResult(), "failed");
    expect(failed.executionStatus).toBe("failed");
  });

  it("passes through unresolved evidence gaps", () => {
    const result = makeResult({
      unresolvedEvidenceGaps: ["Gap A", "Gap B"],
    });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.unresolvedEvidenceGaps).toEqual(["Gap A", "Gap B"]);
  });

  it("passes through new questions", () => {
    const result = makeResult({
      newQuestions: ["What is the delivery date?", "Is the payment confirmed?"],
    });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.newQuestions).toEqual(["What is the delivery date?", "Is the payment confirmed?"]);
  });

  it("preserves case version hash", () => {
    const result = makeResult({ caseVersionHash: "v42" });
    const outcome = normalizeCaseRefreshResult(result, "settled");
    expect(outcome.caseVersionHash).toBe("v42");
  });
});
