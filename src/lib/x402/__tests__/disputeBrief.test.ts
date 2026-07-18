// ---------------------------------------------------------------------------
// Unit tests: dispute brief generator & request validation
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { keccak256, stringToHex } from "viem";
import { generateDisputeBrief } from "../disputeBrief";
import { parseDisputeBriefRequest } from "../validation";
import type { PaymentData } from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FROZEN_TIME_MS = new Date("2026-07-17T12:00:00.000Z").getTime();
const FROZEN_ISO = "2026-07-17T12:00:00.000Z";

function createMockPayment(overrides?: Partial<PaymentData>): PaymentData {
  return {
    id: BigInt(42),
    client: "0x1111111111111111111111111111111111111111",
    worker: "0x2222222222222222222222222222222222222222",
    token: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    amount: BigInt(100_000000), // 100 USDC
    agreementLabel: "Logo design for website",
    deliverableSummary: "Final SVG + source files",
    deliveryFormat: "Digital files via email",
    releaseRule: "Upon approval by client",
    evidenceExpectation: "Screenshot of delivered work",
    termsHash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    evidenceReference: "",
    disputeReference: "",
    deliveryDeadline: BigInt(0),
    autoReleaseSeconds: BigInt(86400),
    disputeWindowSeconds: BigInt(604800),
    state: "Funded",
    createdAt: BigInt(1),
    fundedAt: BigInt(2),
    acceptedAt: BigInt(3),
    deliveryAt: BigInt(0),
    releaseRequestedAt: BigInt(0),
    releasedAt: BigInt(0),
    ...overrides,
  };
}

const VALID_REQUEST = {
  paymentId: "42",
  agreementTitle: "Logo Design",
  clientAddress: "0x1111111111111111111111111111111111111111",
  workerAddress: "0x2222222222222222222222222222222222222222",
  protectedAmount: "100.00",
  disputeReason: "Worker did not deliver the agreed work.",
  requestedOutcome: "Full refund to client.",
  evidenceReferences: [
    "https://example.com/chat-logs.pdf",
    "https://example.com/contract-screenshot.png",
  ],
  relevantTimelineEntries: [
    { date: "2026-07-01", description: "Agreement created on-chain" },
    { date: "2026-07-02", description: "Funds deposited by client" },
    { date: "2026-07-15", description: "Deadline passed — no delivery" },
  ],
};

// ---------------------------------------------------------------------------
// generateDisputeBrief tests
// ---------------------------------------------------------------------------

describe("generateDisputeBrief", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_TIME_MS);
  });

  // ------------------------------------------------------------------
  // Test 1: Full brief generation with valid input
  // ------------------------------------------------------------------
  it("produces a complete brief with all required top-level sections", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    // Required top-level keys
    expect(brief).toHaveProperty("briefId");
    expect(brief).toHaveProperty("generatedTimestamp");
    expect(brief).toHaveProperty("paymentId");
    expect(brief).toHaveProperty("neutralCaseTitle");
    expect(brief).toHaveProperty("parties");
    expect(brief).toHaveProperty("protectedAmount");
    expect(brief).toHaveProperty("currentOnChainState");
    expect(brief).toHaveProperty("agreementSummary");
    expect(brief).toHaveProperty("claimedIssue");
    expect(brief).toHaveProperty("requestedOutcome");
    expect(brief).toHaveProperty("evidenceInventory");
    expect(brief).toHaveProperty("missingEvidence");
    expect(brief).toHaveProperty("timeline");
    expect(brief).toHaveProperty("disputedFacts");
    expect(brief).toHaveProperty("undisputedFacts");
    expect(brief).toHaveProperty("questionsRequiringHumanReview");
    expect(brief).toHaveProperty("proceduralNextSteps");
    expect(brief).toHaveProperty("limitationsStatement");
  });

  it("sets generatedTimestamp to the frozen test time", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.generatedTimestamp).toBe(FROZEN_ISO);
  });

  it("uses the correct paymentId from the request", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.paymentId).toBe("42");
  });

  it("builds a neutral case title from the agreement title", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.neutralCaseTitle).toBe(
      "Dispute: Logo Design (Payment #42)",
    );
  });

  it("falls back to a generic title when no agreement title is provided", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, agreementTitle: undefined },
      createMockPayment(),
    );
    expect(brief.neutralCaseTitle).toBe("Payment Dispute #42");
  });

  it("records parties with correct labels and addresses", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.parties.client.label).toBe("Client");
    expect(brief.parties.client.address).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(brief.parties.worker.label).toBe("Worker");
    expect(brief.parties.worker.address).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("falls back to on-chain address when request address is missing", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, clientAddress: undefined, workerAddress: undefined },
      createMockPayment(),
    );
    expect(brief.parties.client.address).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(brief.parties.worker.address).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("includes USDC suffix on protected amount", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.protectedAmount).toBe("100.00 USDC");
  });

  it("falls back to on-chain formatted amount when protectedAmount is missing", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, protectedAmount: undefined },
      createMockPayment({ amount: BigInt(50000000) }), // 50 USDC
    );
    expect(brief.protectedAmount).toBe("50 USDC");
  });

  it("reports the current on-chain state correctly", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ state: "Funded" }),
    );
    expect(brief.currentOnChainState).toBe("Funded");

    const brief2 = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ state: "Accepted" }),
    );
    expect(brief2.currentOnChainState).toBe("Accepted");
  });

  it("sets claimed issue from dispute reason", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.claimedIssue).toBe("Worker did not deliver the agreed work.");
  });

  it("sets requested outcome", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.requestedOutcome).toBe("Full refund to client.");
  });

  // ------------------------------------------------------------------
  // Test 2: Deterministic output
  // ------------------------------------------------------------------
  it("produces deterministic output for the same input at the same time", () => {
    const payment = createMockPayment();
    const brief1 = generateDisputeBrief(VALID_REQUEST, payment);
    const brief2 = generateDisputeBrief(VALID_REQUEST, payment);

    // Deep equality — everything must match exactly
    expect(brief1).toEqual(brief2);
  });

  it("produces different brief IDs at different timestamps", () => {
    const payment = createMockPayment();
    const brief1 = generateDisputeBrief(VALID_REQUEST, payment);

    // Advance time by 1 second
    vi.setSystemTime(FROZEN_TIME_MS + 1000);
    const brief2 = generateDisputeBrief(VALID_REQUEST, payment);

    expect(brief1.briefId).not.toBe(brief2.briefId);
    expect(brief1.generatedTimestamp).not.toBe(brief2.generatedTimestamp);
  });

  it("produces different brief IDs for different dispute reasons", () => {
    const payment = createMockPayment();
    const brief1 = generateDisputeBrief(VALID_REQUEST, payment);
    const brief2 = generateDisputeBrief(
      { ...VALID_REQUEST, disputeReason: "Different reason entirely." },
      payment,
    );

    expect(brief1.briefId).not.toBe(brief2.briefId);
  });

  // ------------------------------------------------------------------
  // Test 3: Mandatory limitations language
  // ------------------------------------------------------------------
  it("includes the mandatory limitations statement", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    expect(brief.limitationsStatement).toContain(
      "This brief does not determine truth.",
    );
    expect(brief.limitationsStatement).toContain(
      "This brief is not legal advice.",
    );
    expect(brief.limitationsStatement).toContain(
      "AI is not deciding the dispute.",
    );
    expect(brief.limitationsStatement).toContain(
      "Human review and contract rules govern resolution.",
    );
  });

  // ------------------------------------------------------------------
  // Test 4: Missing evidence detection
  // ------------------------------------------------------------------
  it("reports missing evidence when no evidence references are submitted", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, evidenceReferences: [] },
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.missingEvidence).toContain(
      "No evidence references were provided by the disputant.",
    );
  });

  it("reports missing evidence when on-chain evidence reference is empty", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.missingEvidence).toContain(
      "No evidence reference is recorded on-chain for this payment.",
    );
  });

  it("reports expected evidence from on-chain terms", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({
        evidenceExpectation: "Screenshot of delivered work",
      }),
    );

    expect(brief.missingEvidence).toContain(
      "The agreement expects evidence: Screenshot of delivered work",
    );
  });

  it("notes missing communication records when evidence text is irrelevant", () => {
    // Use evidence references that don't contain "chat", "message", "deliver", or "file"
    // so the heuristic correctly flags communication records as missing.
    const brief = generateDisputeBrief(
      {
        ...VALID_REQUEST,
        evidenceReferences: [
          "https://example.com/screenshot-001.png",
          "https://example.com/terms-snapshot.png",
        ],
      },
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.missingEvidence).toContain(
      "Communication records between parties have not been provided.",
    );
  });

  it("notes missing deliverable files when evidence text is irrelevant", () => {
    const brief = generateDisputeBrief(
      {
        ...VALID_REQUEST,
        evidenceReferences: [
          "https://example.com/screenshot-001.png",
        ],
      },
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.missingEvidence).toContain(
      "Deliverable files or links have not been provided as evidence.",
    );
  });

  // ------------------------------------------------------------------
  // Test 5: Evidence inventory
  // ------------------------------------------------------------------
  it("includes submitted evidence references in the inventory", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    expect(brief.evidenceInventory).toHaveLength(2);
    expect(brief.evidenceInventory).toContain(
      "https://example.com/chat-logs.pdf",
    );
    expect(brief.evidenceInventory).toContain(
      "https://example.com/contract-screenshot.png",
    );
  });

  it("returns an empty evidence inventory when none are submitted", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, evidenceReferences: undefined },
      createMockPayment(),
    );

    expect(brief.evidenceInventory).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Test 6: Limitations statement always present (even with empty evidence)
  // ------------------------------------------------------------------
  it("always includes the limitations statement regardless of evidence state", () => {
    const brief = generateDisputeBrief(
      { ...VALID_REQUEST, evidenceReferences: [] },
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.limitationsStatement).toBeTruthy();
    expect(typeof brief.limitationsStatement).toBe("string");
    expect(brief.limitationsStatement.length).toBeGreaterThan(50);
  });

  // ------------------------------------------------------------------
  // Test 7: Brief ID derivation
  // ------------------------------------------------------------------
  it("derives brief ID from keccak256 of paymentId + timestamp + disputeReason", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    const expectedSeed = `42:${FROZEN_ISO}:${VALID_REQUEST.disputeReason}`;
    const expectedBriefId = keccak256(stringToHex(expectedSeed));

    expect(brief.briefId).toBe(expectedBriefId);
    // Brief ID should be a keccak256 hash (66 chars: 0x + 64 hex)
    expect(brief.briefId).toMatch(/^0x[a-f0-9]{64}$/);
  });

  // ------------------------------------------------------------------
  // Timeline tests
  // ------------------------------------------------------------------
  it("includes user-submitted timeline entries", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    expect(brief.timeline).toHaveLength(4); // 3 user + 1 auto-added
    expect(brief.timeline[0].date).toBe("2026-07-01");
    expect(brief.timeline[0].description).toBe(
      "Agreement created on-chain",
    );
  });

  it("appends a generation entry to the timeline", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());

    const lastEntry = brief.timeline[brief.timeline.length - 1];
    expect(lastEntry.description).toContain(
      "Dispute brief generated via Reclaim x402 service.",
    );
  });

  // ------------------------------------------------------------------
  // Standard sections are populated
  // ------------------------------------------------------------------
  it("populates the standard review questions", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.questionsRequiringHumanReview.length).toBeGreaterThanOrEqual(
      5,
    );
    expect(brief.questionsRequiringHumanReview[0]).toContain(
      "Was the deliverable substantially completed",
    );
  });

  it("populates the standard procedural next steps", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.proceduralNextSteps.length).toBeGreaterThanOrEqual(3);
    expect(brief.proceduralNextSteps[0]).toContain(
      "Both parties are invited to review",
    );
  });

  // ------------------------------------------------------------------
  // Dispute state facts
  // ------------------------------------------------------------------
  it("includes on-chain evidence reference in disputed facts when present", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({
        evidenceReference:
          "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      }),
    );

    const fact = brief.disputedFacts.find((f) =>
      f.startsWith("An on-chain evidence reference exists"),
    );
    expect(fact).toBeTruthy();
  });

  it("notes when no on-chain evidence reference has been submitted", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ evidenceReference: "" }),
    );

    expect(brief.disputedFacts).toContain(
      "No on-chain evidence reference has been submitted.",
    );
  });

  it("notes existing on-chain dispute reference for Disputed state", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({
        state: "Disputed",
        disputeReference:
          "0xdeadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeef12",
      }),
    );

    const fact = brief.disputedFacts.find((f) =>
      f.startsWith("An existing dispute reference exists on-chain:"),
    );
    expect(fact).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Undisputed facts
  // ------------------------------------------------------------------
  it("includes on-chain payment ID in undisputed facts", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.undisputedFacts).toContain(
      "Payment ID 42 exists on-chain on Celo Sepolia.",
    );
  });

  it("includes protected amount in undisputed facts", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ amount: BigInt(100_000000) }),
    );
    expect(brief.undisputedFacts).toContain(
      "Protected amount: 100 USDC held in escrow contract.",
    );
  });

  it("includes client and worker addresses in undisputed facts", () => {
    const brief = generateDisputeBrief(VALID_REQUEST, createMockPayment());
    expect(brief.undisputedFacts).toContain(
      "Client address: 0x1111111111111111111111111111111111111111",
    );
    expect(brief.undisputedFacts).toContain(
      "Worker address: 0x2222222222222222222222222222222222222222",
    );
  });

  it("includes state-specific undisputed facts for Funded state", () => {
    const brief = generateDisputeBrief(
      VALID_REQUEST,
      createMockPayment({ state: "Funded" }),
    );
    expect(brief.undisputedFacts).toContain(
      "Funds are held in escrow and have not been accessed by either party.",
    );
    expect(brief.undisputedFacts).toContain(
      "The worker has not yet accepted the payment (no acceptance on-chain).",
    );
  });
});

// ---------------------------------------------------------------------------
// Validation tests — parseDisputeBriefRequest
// ---------------------------------------------------------------------------

describe("parseDisputeBriefRequest", () => {
  // ------------------------------------------------------------------
  // Valid request
  // ------------------------------------------------------------------
  it("parses a valid request successfully", () => {
    const result = parseDisputeBriefRequest(VALID_REQUEST);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentId).toBe("42");
      expect(result.data.disputeReason).toBe(
        "Worker did not deliver the agreed work.",
      );
      expect(result.data.requestedOutcome).toBe("Full refund to client.");
    }
  });

  it("parses a minimal valid request (only required fields)", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentId).toBe("1");
      // Optional fields should be undefined
      expect(result.data.agreementTitle).toBeUndefined();
      expect(result.data.clientAddress).toBeUndefined();
      expect(result.data.evidenceReferences).toBeUndefined();
    }
  });

  // ------------------------------------------------------------------
  // Missing required fields
  // ------------------------------------------------------------------
  it("fails when disputeReason is missing", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("disputeReason"))).toBe(true);
    }
  });

  it("fails when requestedOutcome is missing", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("requestedOutcome"))).toBe(
        true,
      );
    }
  });

  it("fails when paymentId is missing", () => {
    const result = parseDisputeBriefRequest({
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("paymentId"))).toBe(true);
    }
  });

  // ------------------------------------------------------------------
  // Invalid paymentId format
  // ------------------------------------------------------------------
  it("fails when paymentId is not a numeric string", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "abc",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.paymentId).toBeDefined();
      expect(result.errors.paymentId[0]).toContain("numeric string");
    }
  });

  it("fails when paymentId is a hex value", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "0x1a",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.paymentId).toBeDefined();
    }
  });

  it("fails when paymentId is a negative number", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "-1",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
  });

  it("fails when paymentId is a floating-point number", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1.5",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
  });

  // ------------------------------------------------------------------
  // Empty dispute reason
  // ------------------------------------------------------------------
  it("fails when disputeReason is empty", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "",
      requestedOutcome: "Refund.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("disputeReason"))).toBe(true);
    }
  });

  it("fails when requestedOutcome is empty", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
      requestedOutcome: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("requestedOutcome"))).toBe(
        true,
      );
    }
  });

  // ------------------------------------------------------------------
  // Invalid timeline entries
  // ------------------------------------------------------------------
  it("fails when a timeline entry is missing a date", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
      relevantTimelineEntries: [
        { date: "", description: "Something happened." },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(
        errorPaths.some((p) => p.includes("relevantTimelineEntries") || p.includes("timeline")),
      ).toBe(true);
    }
  });

  it("fails when a timeline entry is missing a description", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
      relevantTimelineEntries: [
        { date: "2026-07-01", description: "" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(
        errorPaths.some((p) => p.includes("relevantTimelineEntries") || p.includes("timeline")),
      ).toBe(true);
    }
  });

  it("accepts valid timeline entries", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Not delivered.",
      requestedOutcome: "Refund.",
      relevantTimelineEntries: [
        { date: "2026-07-01", description: "Agreement created." },
        { date: "2026-07-10", description: "Funds deposited." },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relevantTimelineEntries).toHaveLength(2);
    }
  });

  // ------------------------------------------------------------------
  // Invalid address format
  // ------------------------------------------------------------------
  it("fails when clientAddress is not a valid hex address", () => {
    const result = parseDisputeBriefRequest({
      ...VALID_REQUEST,
      clientAddress: "not-an-address",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("clientAddress"))).toBe(true);
    }
  });

  it("fails when workerAddress is not a valid hex address", () => {
    const result = parseDisputeBriefRequest({
      ...VALID_REQUEST,
      workerAddress: "bad-address",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = Object.keys(result.errors);
      expect(errorPaths.some((p) => p.includes("workerAddress"))).toBe(true);
    }
  });

  // ------------------------------------------------------------------
  // Non-object input
  // ------------------------------------------------------------------
  it("fails gracefully when given a string instead of an object", () => {
    const result = parseDisputeBriefRequest("not an object");
    expect(result.success).toBe(false);
  });

  it("fails gracefully when given null", () => {
    const result = parseDisputeBriefRequest(null);
    expect(result.success).toBe(false);
  });

  it("fails gracefully when given undefined", () => {
    const result = parseDisputeBriefRequest(undefined);
    expect(result.success).toBe(false);
  });

  // ------------------------------------------------------------------
  // Optional agreement-specific fields parse correctly
  // ------------------------------------------------------------------
  it("accepts an optional agreement title", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Issue.",
      requestedOutcome: "Resolution.",
      agreementTitle: "Website Redesign",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agreementTitle).toBe("Website Redesign");
    }
  });

  it("accepts optional evidence references array", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Issue.",
      requestedOutcome: "Resolution.",
      evidenceReferences: [
        "https://example.com/evidence-1.png",
        "https://example.com/evidence-2.pdf",
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidenceReferences).toHaveLength(2);
    }
  });

  it("accepts a valid payment state value", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Issue.",
      requestedOutcome: "Resolution.",
      currentPaymentState: "Funded",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentPaymentState).toBe("Funded");
    }
  });

  it("rejects an invalid payment state value", () => {
    const result = parseDisputeBriefRequest({
      paymentId: "1",
      disputeReason: "Issue.",
      requestedOutcome: "Resolution.",
      currentPaymentState: "InvalidState",
    });
    expect(result.success).toBe(false);
  });
});
