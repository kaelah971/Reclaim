// ---------------------------------------------------------------------------
// Case Refresh Generate — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateCaseRefresh,
  generateCaseRefreshDeterministic,
} from "../caseRefreshGenerate";
import type { CaseRefreshInput } from "../caseRefreshValidation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validInput(): CaseRefreshInput {
  return {
    escrowChainId: "eip155:42220",
    escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    escrowPaymentId: "pay_42",
    agreementLabel: "Logo Design Agreement",
    deliverableSummary: "Final SVG logo files",
    deliveryFormat: "digital",
    releaseRule: "worker_delivery_confirmed",
    evidenceExpectation: "Screenshot or file delivery proof",
    escrowState: "disputed",
    caseVersionHash: "case_hash_v3",
    evidenceVersionHash: "ev_hash_v2",
    evidenceAvailability: "metadata_available",
    evidenceReference: "ev_ref_123",
    evidenceCount: 5,
    openEvidenceRequests: [
      { party: "client", item: "Screenshot proof", status: "open" },
    ],
    fulfilledEvidenceRequests: [
      { party: "worker", item: "Delivery receipt" },
    ],
    previousQualityCheck: {
      readiness: "needs_improvement",
      missingEvidence: ["Screenshot proof"],
      reviewerQuestions: ["When was the delivery made?"],
    },
    previousCaseRefresh: {
      caseVersionHash: "case_hash_v2",
      readiness: "needs_evidence",
      unresolvedGaps: ["Missing payment screenshot"],
    },
  };
}

function minimalInput(): CaseRefreshInput {
  return {
    escrowPaymentId: "pay_1",
    agreementLabel: "Test Agreement",
    deliverableSummary: "Test Deliverable",
    deliveryFormat: "digital",
    releaseRule: "standard",
    evidenceExpectation: "Proof of delivery",
    escrowState: "funded",
    caseVersionHash: "hash_cv_1",
    evidenceVersionHash: "hash_ev_1",
    evidenceAvailability: "none",
    evidenceCount: 0,
    openEvidenceRequests: [],
    fulfilledEvidenceRequests: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Case Refresh Generate", () => {
  describe("generateCaseRefreshDeterministic", () => {
    it("returns a structured result with required fields", () => {
      const result = generateCaseRefreshDeterministic(validInput());
      expect(result.result.caseVersionHash).toBe(validInput().caseVersionHash);
      expect(result.result.evidenceVersionHash).toBe(validInput().evidenceVersionHash);
      expect(result.result.readiness).toMatch(/^(ready|needs_more_evidence|blocked)$/);
      expect(result.result.generatedAt).toBeTruthy();
      expect(result.result.generationMode).toBe("deterministic_fallback");
      expect(result.result.changeSummary).toBeTruthy();
      expect(Array.isArray(result.result.addressedEvidenceGaps)).toBe(true);
      expect(Array.isArray(result.result.remainingEvidenceGaps)).toBe(true);
      expect(Array.isArray(result.result.unresolvedEvidenceGaps)).toBe(true);
      expect(Array.isArray(result.result.newQuestions)).toBe(true);
      expect(Array.isArray(result.result.reviewerQuestionsResolved)).toBe(true);
      expect(Array.isArray(result.result.reviewerQuestionsRemaining)).toBe(true);
      expect(result.result.conciseReviewerSummary).toBeTruthy();
      expect(result.result.resultVersion).toBe("1.0.0");
      expect(result.usedFallback).toBe(true);
    });

    it('returns "ready" when no pending gaps or requests', () => {
      const input = {
        ...validInput(),
        openEvidenceRequests: [],
        previousQualityCheck: null,
        previousCaseRefresh: null,
        evidenceAvailability: "metadata_available",
        evidenceCount: 5,
      };
      const result = generateCaseRefreshDeterministic(input);
      expect(result.result.readiness).toBe("ready");
    });

    it('returns "needs_more_evidence" when open evidence requests exist', () => {
      const result = generateCaseRefreshDeterministic(validInput());
      expect(result.result.readiness).toBe("needs_more_evidence");
    });

    it('returns "blocked" when unresolved gaps exceed threshold', () => {
      const input = {
        ...validInput(),
        openEvidenceRequests: [
          { party: "client", item: "Gap1", status: "open" },
          { party: "client", item: "Gap2", status: "open" },
          { party: "worker", item: "Gap3", status: "open" },
        ],
        previousQualityCheck: null,
      };
      const result = generateCaseRefreshDeterministic(input);
      expect(result.result.readiness).toBe("blocked");
    });

    it("resolves reviewer questions when previous gaps are fulfilled", () => {
      const input = {
        ...validInput(),
        openEvidenceRequests: [],
        previousCaseRefresh: null,
      };
      const result = generateCaseRefreshDeterministic(input);
      // Reviewer questions from previous quality check should be marked resolved
      expect(result.result.reviewerQuestionsResolved).toContain("When was the delivery made?");
    });

    it("includes change summary text", () => {
      const result = generateCaseRefreshDeterministic(validInput());
      expect(result.result.changeSummary.length).toBeGreaterThan(0);
    });

    it("has different caseVersionHash from previous refresh", () => {
      const input = {
        ...validInput(),
        previousCaseRefresh: {
          caseVersionHash: "case_hash_v2",
          readiness: "needs_evidence",
          unresolvedGaps: ["Screenshot proof", "Missing payment screenshot"],
        },
        openEvidenceRequests: [],
        previousQualityCheck: null,
        fulfilledEvidenceRequests: [
          { party: "client", item: "Screenshot proof" },
        ],
      };
      const result = generateCaseRefreshDeterministic(input);
      expect(result.result.addressedEvidenceGaps.length).toBeGreaterThan(0);
      expect(result.result.addressedEvidenceGaps).toContain("Screenshot proof");
    });

    it("handles evidence without previous refresh", () => {
      const input = { ...validInput(), previousCaseRefresh: null };
      const result = generateCaseRefreshDeterministic(input);
      expect(result.result.changeSummary).toMatch(/first/i);
    });

    it("handles minimal input with no evidence", () => {
      const result = generateCaseRefreshDeterministic(minimalInput());
      expect(result.result.readiness).toBe("blocked");
      expect(result.result.changeSummary.toLowerCase()).toContain("no evidence");
    });
  });

  describe("generateCaseRefresh (AI path mock)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("falls back to deterministic when AI API key is not configured", async () => {
      const origApiKey = process.env.AI_API_KEY;
      delete (process.env as Record<string, string>).AI_API_KEY;
      try {
        const result = await generateCaseRefresh(validInput());
        expect(result.usedFallback).toBe(true);
        expect(result.result.generationMode).toBe("deterministic_fallback");
      } finally {
        if (origApiKey) process.env.AI_API_KEY = origApiKey;
      }
    });

    it("falls back to deterministic when AI_API_KEY is empty", async () => {
      const origApiKey = process.env.AI_API_KEY;
      process.env.AI_API_KEY = "";
      try {
        const result = await generateCaseRefresh(validInput());
        expect(result.usedFallback).toBe(true);
      } finally {
        if (origApiKey !== undefined) {
          process.env.AI_API_KEY = origApiKey;
        } else {
          delete (process.env as Record<string, string>).AI_API_KEY;
        }
      }
    });

    it("returns consistent result shape for deterministic fallback", async () => {
      const origApiKey = process.env.AI_API_KEY;
      delete (process.env as Record<string, string>).AI_API_KEY;
      try {
        const result = await generateCaseRefresh(validInput());
        expect(result.result.caseVersionHash).toBe(validInput().caseVersionHash);
        expect(result.result.evidenceVersionHash).toBe(validInput().evidenceVersionHash);
        expect(result.result.resultVersion).toBe("1.0.0");
        expect(result.usedFallback).toBe(true);
      } finally {
        if (origApiKey) process.env.AI_API_KEY = origApiKey;
      }
    });
  });
});
