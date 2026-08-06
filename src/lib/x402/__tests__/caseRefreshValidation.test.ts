// ---------------------------------------------------------------------------
// Case Refresh Validation — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  caseRefreshInputSchema,
  type CaseRefreshInput,
} from "../caseRefreshValidation";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Case Refresh Validation", () => {
  describe("required fields", () => {
    it("accepts valid complete input", () => {
      const result = caseRefreshInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
    });

    it("rejects missing escrowPaymentId", () => {
      const input = { ...validInput(), escrowPaymentId: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing agreementLabel", () => {
      const input = { ...validInput(), agreementLabel: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing deliverableSummary", () => {
      const input = { ...validInput(), deliverableSummary: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing deliveryFormat", () => {
      const input = { ...validInput(), deliveryFormat: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing releaseRule", () => {
      const input = { ...validInput(), releaseRule: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing evidenceExpectation", () => {
      const input = { ...validInput(), evidenceExpectation: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing escrowState", () => {
      const input = { ...validInput(), escrowState: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing caseVersionHash", () => {
      const input = { ...validInput(), caseVersionHash: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing evidenceVersionHash", () => {
      const input = { ...validInput(), evidenceVersionHash: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing evidenceAvailability", () => {
      const input = { ...validInput(), evidenceAvailability: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing evidenceCount", () => {
      const input = { ...validInput(), evidenceCount: undefined };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("optional fields", () => {
    it("accepts null evidenceReference", () => {
      const input = { ...validInput(), evidenceReference: null };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts missing evidenceReference", () => {
      const { evidenceReference: _evr, ...rest } = validInput();
      const result = caseRefreshInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("accepts null previousQualityCheck", () => {
      const input = { ...validInput(), previousQualityCheck: null };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts null previousCaseRefresh", () => {
      const input = { ...validInput(), previousCaseRefresh: null };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts missing escrowChainId", () => {
      const { escrowChainId: _, ...rest } = validInput();
      const result = caseRefreshInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("accepts missing escrowContractAddress", () => {
      const { escrowContractAddress: _, ...rest } = validInput();
      const result = caseRefreshInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });
  });

  describe("type validation", () => {
    it("rejects non-string escrowPaymentId", () => {
      const input = { ...validInput(), escrowPaymentId: 42 };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects non-number evidenceCount", () => {
      const input = { ...validInput(), evidenceCount: "five" };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects non-array openEvidenceRequests", () => {
      const input = { ...validInput(), openEvidenceRequests: "not_an_array" };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects non-array fulfilledEvidenceRequests", () => {
      const input = { ...validInput(), fulfilledEvidenceRequests: "not_an_array" };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid evidenceReference format", () => {
      const input = { ...validInput(), evidenceReference: 123 };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("nested object validation", () => {
    it("rejects openEvidenceRequests with missing party", () => {
      const input = {
        ...validInput(),
        openEvidenceRequests: [{ item: "X", status: "open" }],
      };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects openEvidenceRequests with missing status", () => {
      const input = {
        ...validInput(),
        openEvidenceRequests: [{ party: "client", item: "X" }],
      };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects fulfilledEvidenceRequests with missing party", () => {
      const input = {
        ...validInput(),
        fulfilledEvidenceRequests: [{ item: "X" }],
      };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects previousQualityCheck with missing readiness", () => {
      const input = {
        ...validInput(),
        previousQualityCheck: { missingEvidence: [], reviewerQuestions: [] },
      };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects previousCaseRefresh with missing caseVersionHash", () => {
      const input = {
        ...validInput(),
        previousCaseRefresh: { readiness: "needs_evidence", unresolvedGaps: [] },
      };
      const result = caseRefreshInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("minimal valid input", () => {
    it("accepts input with only required fields and empty arrays", () => {
      const minimal = {
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
      const result = caseRefreshInputSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });
  });
});
