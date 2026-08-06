// ---------------------------------------------------------------------------
// Case Refresh Request Hash — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  computeCaseRefreshHash,
  computeCaseRefreshHashFromInput,
  caseRefreshIdentitySchema,
  type CaseRefreshIdentity,
} from "../caseRefreshRequestHash";
import {
  CASE_REFRESH_SERVICE_IDENTIFIER,
  type CaseRefreshInput,
} from "../caseRefreshValidation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validInput(): CaseRefreshInput {
  return {
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

const FIXED_PAYER = "0x1111111111111111111111111111111111111111";
const FIXED_NETWORK = "eip155:42220";
const FIXED_ASSET = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const FIXED_PAY_TO = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const FIXED_AMOUNT = "10000";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Case Refresh Request Hash", () => {
  describe("computeCaseRefreshHashFromInput", () => {
    it("returns a 0x-prefixed 66-char string", () => {
      const hash = computeCaseRefreshHashFromInput(
        validInput(),
        FIXED_PAYER,
        FIXED_NETWORK,
        FIXED_ASSET,
        FIXED_PAY_TO,
        FIXED_AMOUNT,
      );
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("is deterministic for identical inputs", () => {
      const hash1 = computeCaseRefreshHashFromInput(
        validInput(),
        FIXED_PAYER,
        FIXED_NETWORK,
        FIXED_ASSET,
        FIXED_PAY_TO,
        FIXED_AMOUNT,
      );
      const hash2 = computeCaseRefreshHashFromInput(
        validInput(),
        FIXED_PAYER,
        FIXED_NETWORK,
        FIXED_ASSET,
        FIXED_PAY_TO,
        FIXED_AMOUNT,
      );
      expect(hash1).toBe(hash2);
    });

    it("changes when escrowPaymentId changes", () => {
      const input = validInput();
      const hash1 = computeCaseRefreshHashFromInput(input, FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT);
      const hash2 = computeCaseRefreshHashFromInput(
        { ...input, escrowPaymentId: "pay_99" },
        FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT,
      );
      expect(hash1).not.toBe(hash2);
    });

    it("changes when payer changes", () => {
      const hash1 = computeCaseRefreshHashFromInput(validInput(), FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT);
      const hash2 = computeCaseRefreshHashFromInput(
        validInput(), "0x9999999999999999999999999999999999999999",
        FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT,
      );
      expect(hash1).not.toBe(hash2);
    });

    it("changes when amount changes", () => {
      const hash1 = computeCaseRefreshHashFromInput(validInput(), FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT);
      const hash2 = computeCaseRefreshHashFromInput(
        validInput(), FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, "20000",
      );
      expect(hash1).not.toBe(hash2);
    });

    it("changes when caseVersionHash changes", () => {
      const input = validInput();
      const hash1 = computeCaseRefreshHashFromInput(input, FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT);
      const hash2 = computeCaseRefreshHashFromInput(
        { ...input, caseVersionHash: "case_hash_v4" },
        FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT,
      );
      expect(hash1).not.toBe(hash2);
    });

    it("changes when evidenceVersionHash changes", () => {
      const input = validInput();
      const hash1 = computeCaseRefreshHashFromInput(input, FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT);
      const hash2 = computeCaseRefreshHashFromInput(
        { ...input, evidenceVersionHash: "ev_hash_v3" },
        FIXED_PAYER, FIXED_NETWORK, FIXED_ASSET, FIXED_PAY_TO, FIXED_AMOUNT,
      );
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("computeCaseRefreshHash (raw identity)", () => {
    it("produces hash from a valid identity", () => {
      const identity: CaseRefreshIdentity = {
        service: "case-refresh",
        escrowPaymentId: "pay_42",
        payer: FIXED_PAYER,
        paymentNetwork: FIXED_NETWORK,
        asset: FIXED_ASSET,
        payTo: FIXED_PAY_TO,
        amount: FIXED_AMOUNT,
        scheme: "exact",
        caseRefreshInputHash: keccak256(stringToHex("test-input-hash")),
      };
      const hash = computeCaseRefreshHash(identity);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe("caseRefreshIdentitySchema", () => {
    it("validates a correct identity", () => {
      const identity: CaseRefreshIdentity = {
        service: CASE_REFRESH_SERVICE_IDENTIFIER,
        escrowPaymentId: "pay_42",
        payer: FIXED_PAYER,
        paymentNetwork: FIXED_NETWORK,
        asset: FIXED_ASSET,
        payTo: FIXED_PAY_TO,
        amount: FIXED_AMOUNT,
        scheme: "exact",
        caseRefreshInputHash: keccak256(stringToHex("test-input-hash")),
      };
      const result = caseRefreshIdentitySchema.safeParse(identity);
      expect(result.success).toBe(true);
    });

    it("rejects wrong service identifier", () => {
      const identity = {
        service: "wrong-service",
        escrowPaymentId: "pay_42",
        payer: FIXED_PAYER,
        paymentNetwork: FIXED_NETWORK,
        asset: FIXED_ASSET,
        payTo: FIXED_PAY_TO,
        amount: FIXED_AMOUNT,
        scheme: "exact",
        caseRefreshInputHash: keccak256(stringToHex("test")),
      };
      const result = caseRefreshIdentitySchema.safeParse(identity);
      expect(result.success).toBe(false);
    });

    it("rejects invalid payer address format", () => {
      const identity = {
        service: CASE_REFRESH_SERVICE_IDENTIFIER,
        escrowPaymentId: "pay_42",
        payer: "invalid",
        paymentNetwork: FIXED_NETWORK,
        asset: FIXED_ASSET,
        payTo: FIXED_PAY_TO,
        amount: FIXED_AMOUNT,
        scheme: "exact",
        caseRefreshInputHash: keccak256(stringToHex("test")),
      };
      const result = caseRefreshIdentitySchema.safeParse(identity);
      expect(result.success).toBe(false);
    });

    it("rejects missing caseRefreshInputHash", () => {
      const identity = {
        service: CASE_REFRESH_SERVICE_IDENTIFIER,
        escrowPaymentId: "pay_42",
        payer: FIXED_PAYER,
        paymentNetwork: FIXED_NETWORK,
        asset: FIXED_ASSET,
        payTo: FIXED_PAY_TO,
        amount: FIXED_AMOUNT,
        scheme: "exact",
      };
      const result = caseRefreshIdentitySchema.safeParse(identity);
      expect(result.success).toBe(false);
    });
  });
});
