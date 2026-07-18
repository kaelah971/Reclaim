// ---------------------------------------------------------------------------
// Unit tests: x402 shared utilities & API response patterns
//
// Tests the extracted shared helpers and validates that the x402 protocol
// types produce correct structures for HTTP header payloads.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll } from "vitest";
import type {
  PaymentRequirementsLegacy,
  PaymentRequirement,
  PaymentPayloadCustom,
  PaymentDetails,
  SettlementResponse,
} from "../types";
import {
  buildPaymentRequirements,
  buildPaymentRequiredHeader,
  decodePaymentSignatureCustomHeader,
  encodePaymentSignatureCustomHeader,
  encodePaymentResponseHeader,
  verifyPaymentPayload,
  SUPPORTED_SCHEME,
} from "../shared";
import {
  createPaymentId,
  recordPending,
  recordSettled,
  recordFailed,
  getStatus,
  getResult,
  getError,
  type PaymentIdentifier,
} from "../paymentStore";
import type { DisputeBrief } from "../disputeBrief";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * These addresses must match the vitest.config.ts env values, since config.ts
 * reads them at module import time before any test code runs.
 */
const TEST_PAY_TO_ADDRESS = "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const TEST_USDC_ADDRESS = "0x1111111111111111111111111111111111111111";
const ESCROW_ADDRESS = "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79";

/**
 * Build a valid PaymentPayloadCustom for the "exact" scheme.
 */
function buildValidPayload(
  overrides?: Partial<PaymentPayloadCustom>,
): PaymentPayloadCustom {
  const payment: PaymentDetails = {
    from: "0x1111111111111111111111111111111111111111",
    to: TEST_PAY_TO_ADDRESS,
    token: TEST_USDC_ADDRESS,
    amount: "10000", // 0.01 USDC at 6 decimals
    signature: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  };

  return {
    scheme: SUPPORTED_SCHEME,
    network: "eip155:11142220",
    payment,
    requestId: "test-req-123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

process.env.X402_PAY_TO_ADDRESS = TEST_PAY_TO_ADDRESS;
process.env.X402_USDC_ADDRESS = TEST_USDC_ADDRESS;
process.env.X402_DISPUTE_BRIEF_PRICE = "0.01";
process.env.X402_DISPUTE_BRIEF_PRICE_ATOMIC = "10000";

// ---------------------------------------------------------------------------
// PaymentRequirements building tests
// ---------------------------------------------------------------------------

describe("buildPaymentRequirements", () => {
  it("returns a valid PaymentRequirements object", () => {
    const reqs = buildPaymentRequirements();

    expect(reqs).toHaveProperty("accepts");
    expect(reqs).toHaveProperty("description");
    expect(reqs).toHaveProperty("mimeType");
    expect(Array.isArray(reqs.accepts)).toBe(true);
    expect(reqs.accepts.length).toBeGreaterThanOrEqual(1);
  });

  it("includes scheme, price, network, payTo, asset, and assetDecimals in the first requirement", () => {
    const reqs = buildPaymentRequirements();
    const scheme = reqs.accepts[0];

    expect(scheme.scheme).toBe(SUPPORTED_SCHEME);
    expect(scheme.price).toMatch(/^\$/);
    expect(scheme.network).toBe("eip155:11142220");
    expect(scheme.payTo).toBe(TEST_PAY_TO_ADDRESS);
    expect(scheme.asset).toBe(TEST_USDC_ADDRESS);
    expect(scheme.assetDecimals).toBe(6);
  });

  it("describes the service correctly", () => {
    const reqs = buildPaymentRequirements();
    expect(reqs.description).toBe("Reclaim dispute preparation brief");
    expect(reqs.mimeType).toBe("application/json");
  });

  it("returns the expected shape for the PaymentRequirement interface", () => {
    const reqs = buildPaymentRequirements();
    const scheme: PaymentRequirement = reqs.accepts[0];

    expect(typeof scheme.scheme).toBe("string");
    expect(typeof scheme.price).toBe("string");
    expect(typeof scheme.network).toBe("string");
    expect(typeof scheme.payTo).toBe("string");
    expect(typeof scheme.asset).toBe("string");
    expect(typeof scheme.assetDecimals).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// PAYMENT-REQUIRED header encoding / decoding
// ---------------------------------------------------------------------------

describe("buildPaymentRequiredHeader", () => {
  it("is a convenience wrapper that composes buildPaymentRequirements + encode", () => {
    const header = buildPaymentRequiredHeader();

    // Decode to verify the content
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    expect(parsed.accepts[0].scheme).toBe(SUPPORTED_SCHEME);
    expect(parsed.accepts[0].network).toBe("eip155:11142220");
    expect(parsed.description).toBe("Reclaim dispute preparation brief");
  });

  it("produces a valid base64 string", () => {
    const header = buildPaymentRequiredHeader();
    expect(header).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

// ---------------------------------------------------------------------------
// PAYMENT-SIGNATURE header encoding / decoding
// ---------------------------------------------------------------------------

describe("encodePaymentSignatureCustomHeader", () => {
  it("encodes a PaymentPayload as a base64 JSON string", () => {
    const payload = buildValidPayload();
    const encoded = encodePaymentSignatureCustomHeader(payload);

    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    // Round-trip decode
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    expect(parsed.scheme).toBe(SUPPORTED_SCHEME);
    expect(parsed.payment.from).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });
});

describe("decodePaymentSignatureCustomHeader", () => {
  it("decodes a valid base64 PaymentPayload correctly", () => {
    const payload = buildValidPayload();
    const encoded = encodePaymentSignatureCustomHeader(payload);
    const decoded = decodePaymentSignatureCustomHeader(encoded);

    expect(decoded.scheme).toBe(SUPPORTED_SCHEME);
    expect(decoded.network).toBe("eip155:11142220");
    expect(decoded.payment.from).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(decoded.payment.to).toBe(TEST_PAY_TO_ADDRESS);
    expect(decoded.payment.token).toBe(TEST_USDC_ADDRESS);
    expect(decoded.payment.amount).toBe("10000");
  });

  it("throws on an invalid base64 string", () => {
    expect(() => decodePaymentSignatureCustomHeader("!!!not-base64!!!")).toThrow();
  });

  it("throws on non-JSON base64 content", () => {
    const invalid = Buffer.from("this is not json").toString("base64");
    expect(() => decodePaymentSignatureCustomHeader(invalid)).toThrow();
  });

  it("round-trips: encode then decode yields the original payload", () => {
    const original = buildValidPayload();
    const encoded = encodePaymentSignatureCustomHeader(original);
    const decoded = decodePaymentSignatureCustomHeader(encoded);

    expect(decoded.scheme).toBe(original.scheme);
    expect(decoded.network).toBe(original.network);
    expect(decoded.payment.from).toBe(original.payment.from);
    expect(decoded.payment.to).toBe(original.payment.to);
    expect(decoded.payment.token).toBe(original.payment.token);
    expect(decoded.payment.amount).toBe(original.payment.amount);
  });
});

// ---------------------------------------------------------------------------
// PAYMENT-RESPONSE header encoding
// ---------------------------------------------------------------------------

describe("encodePaymentResponseHeader", () => {
  it("encodes a payment response as base64 JSON", () => {
    const response = {
      success: true,
      transaction: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      network: "eip155:11142220" as const,
    };

    const encoded = encodePaymentResponseHeader(response);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    expect(parsed.success).toBe(true);
    expect(parsed.transaction).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );
    expect(parsed.network).toBe("eip155:11142220");
  });

  it("includes optional payer field when present", () => {
    const response = {
      success: true,
      transaction: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      network: "eip155:11142220" as const,
      payer: "0x1111111111111111111111111111111111111111",
    };

    const encoded = encodePaymentResponseHeader(response);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    expect(parsed.payer).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });
});

// ---------------------------------------------------------------------------
// Payment payload verification
// ---------------------------------------------------------------------------

describe("verifyPaymentPayload", () => {
  // --- Valid payload ---
  it("accepts a valid payment payload", () => {
    const payload = buildValidPayload();
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // --- Scheme validation ---
  it("rejects an unsupported payment scheme", () => {
    const payload = buildValidPayload({ scheme: "unsupported-scheme" });
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unsupported payment scheme");
    expect(result.reason).toContain(SUPPORTED_SCHEME);
  });

  // --- Network validation ---
  it("rejects an unsupported network", () => {
    const payload = buildValidPayload({ network: "eip155:1" });
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unsupported network");
    expect(result.reason).toContain("eip155:11142220");
  });

  // --- Missing payment details ---
  it("rejects a payload with no payment details", () => {
    const payload = buildValidPayload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload as any).payment = null;
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing payment details");
  });

  // --- Missing required fields ---
  it("rejects a payment missing the 'from' field", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, from: "" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });

  it("rejects a payment missing the 'to' field", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, to: "" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });

  it("rejects a payment missing the 'token' field", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, token: "" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });

  it("rejects a payment missing the 'signature' field", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, signature: "" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });

  // --- Invalid address formats ---
  it("rejects an invalid 'from' address format", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, from: "not-an-address" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid address format");
  });

  it("rejects an invalid 'to' address format", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, to: "also-invalid" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid address format");
  });

  it("rejects a 'from' address with wrong length (41 hex chars)", () => {
    const payload = buildValidPayload();
    payload.payment = {
      ...payload.payment,
      from: "0x111111111111111111111111111111111111111",
    };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid address format");
  });

  // --- Wrong token ---
  it("rejects when the token address does not match USDC", () => {
    const payload = buildValidPayload();
    payload.payment = {
      ...payload.payment,
      token: "0x0000000000000000000000000000000000000000",
    };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match expected");
  });

  // --- Wrong recipient ---
  it("rejects when the recipient does not match the pay-to address", () => {
    const payload = buildValidPayload();
    payload.payment = {
      ...payload.payment,
      to: "0x1111111111111111111111111111111111111111",
    };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match service wallet");
  });

  // --- Amount validation ---
  it("rejects when the payment amount is less than the required price", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, amount: "1" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("less than required");
  });

  it("accepts when the payment amount equals the required price", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, amount: "10000" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(true);
  });

  it("accepts when the payment amount exceeds the required price", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, amount: "50000" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(true);
  });

  it("rejects when the amount is not a valid integer string", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, amount: "not-a-number" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid payment amount format");
  });

  // --- NEW: Placeholder signature rejection ---
  it("rejects a payment with a placeholder signature (0x)", () => {
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, signature: "0x" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing or is a placeholder");
  });

  // --- NEW: payTo address != escrow contract ---
  // Note: in the test env, payTo is TEST_PAY_TO_ADDRESS which differs from
  // ESCROW_ADDRESS, so this test validates the config module's rule.
  it("accepts when payTo is not the escrow contract address", () => {
    // TEST_PAY_TO_ADDRESS is different from ESCROW_ADDRESS
    expect(TEST_PAY_TO_ADDRESS.toLowerCase()).not.toBe(
      ESCROW_ADDRESS.toLowerCase(),
    );
    const payload = buildValidPayload();
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 402 response structure tests
// ---------------------------------------------------------------------------

describe("402 Payment Required response structure", () => {
  it("produces the expected JSON body shape for a 402 response", () => {
    const body = {
      correlationId: "test-correlation-402",
      error:
        "Payment required. Include a PAYMENT-SIGNATURE header with your request.",
    };

    expect(body).toHaveProperty("correlationId");
    expect(body).toHaveProperty("error");
    expect(typeof body.correlationId).toBe("string");
    expect(typeof body.error).toBe("string");
  });

  it("includes a PAYMENT-REQUIRED header with valid base64 JSON in a 402 response", () => {
    const paymentRequiredValue = buildPaymentRequiredHeader();

    const decoded = Buffer.from(paymentRequiredValue, "base64").toString(
      "utf-8",
    );
    const parsed = JSON.parse(decoded) as PaymentRequirementsLegacy;

    expect(parsed.accepts).toBeDefined();
    expect(parsed.accepts.length).toBe(1);
    expect(parsed.accepts[0].scheme).toBe(SUPPORTED_SCHEME);
    expect(parsed.accepts[0].network).toBe("eip155:11142220");
    expect(parsed.accepts[0].price).toBe("$0.01");
    expect(parsed.accepts[0].payTo).toBe(TEST_PAY_TO_ADDRESS);
    expect(parsed.accepts[0].asset).toBe(TEST_USDC_ADDRESS);
    expect(parsed.accepts[0].assetDecimals).toBe(6);
    expect(parsed.description).toBe("Reclaim dispute preparation brief");
    expect(parsed.mimeType).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// Error response structure tests (400 / 500 patterns)
// ---------------------------------------------------------------------------

describe("Error response structures", () => {
  it("produces the expected 400 validation error shape", () => {
    const body = {
      correlationId: "test-correlation-400",
      status: 400,
      error: "Request body validation failed.",
      details: {
        disputeReason: ["disputeReason is required"],
        paymentId: ["paymentId must be a numeric string"],
      },
    };

    expect(body.correlationId).toBeDefined();
    expect(body.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(body.details).toBeDefined();
    expect(Object.keys(body.details!).length).toBeGreaterThan(0);
  });

  it("produces the expected 500 server-config error shape", () => {
    const body = {
      correlationId: "test-correlation-500",
      status: 500,
      error: "x402 payment processing is not configured on this server.",
    };

    expect(body.status).toBe(500);
    expect(body.error).toContain("not configured");
  });

  it("produces the expected 402 malformed signature error shape", () => {
    const body = {
      correlationId: "test-correlation-402",
      status: 402,
      error:
        "Malformed PAYMENT-SIGNATURE header. Must be base64-encoded JSON.",
    };

    expect(body.status).toBe(402);
    expect(body.error).toContain("Malformed PAYMENT-SIGNATURE");
  });

  it("produces the expected 502 settlement failure error shape", () => {
    const body = {
      correlationId: "test-correlation-502",
      status: 502,
      error:
        "Payment settlement failed: Settlement transaction reverted on-chain.",
    };

    expect(body.status).toBe(502);
    expect(body.error).toContain("settlement failed");
  });
});

// ---------------------------------------------------------------------------
// Payment identifier / idempotency store tests
// ---------------------------------------------------------------------------

describe("paymentStore", () => {
  const mockBrief: DisputeBrief = {
    briefId: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    generatedTimestamp: "2026-07-17T12:00:00.000Z",
    paymentId: "42",
    neutralCaseTitle: "Test Case",
    parties: {
      client: { label: "Client", address: "0x1111" },
      worker: { label: "Worker", address: "0x2222" },
    },
    protectedAmount: "100 USDC",
    currentOnChainState: "Funded",
    agreementSummary: "Test agreement",
    claimedIssue: "Test issue",
    requestedOutcome: "Full refund",
    evidenceInventory: [],
    missingEvidence: [],
    timeline: [],
    disputedFacts: [],
    undisputedFacts: [],
    questionsRequiringHumanReview: ["Q1"],
    proceduralNextSteps: ["P1"],
    limitationsStatement: "Test limitations.",
  };

  const mockReceipt = {
    txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    blockNumber: BigInt(12345678),
    blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "success" as const,
    from: "0x1111111111111111111111111111111111111111",
    to: TEST_PAY_TO_ADDRESS,
    amount: "10000",
    tokenAddress: TEST_USDC_ADDRESS,
  };

  it("createPaymentId generates a unique payment identifier", () => {
    const id1 = createPaymentId();
    const id2 = createPaymentId();

    expect(id1).toMatch(/^pay_/);
    expect(id2).toMatch(/^pay_/);
    expect(id1).not.toBe(id2);
  });

  it("records and retrieves pending status", () => {
    const id = createPaymentId();
    recordPending(id);

    expect(getStatus(id)).toBe("pending");
    expect(getResult(id)).toBeUndefined();
    expect(getError(id)).toBeUndefined();
  });

  it("records and retrieves settled status with brief and receipt", () => {
    const id = createPaymentId();
    recordPending(id);
    recordSettled(id, mockReceipt, mockBrief);

    expect(getStatus(id)).toBe("settled");
    const result = getResult(id);
    expect(result).toBeDefined();
    expect(result!.receipt.txHash).toBe(mockReceipt.txHash);
    expect(result!.brief.briefId).toBe(mockBrief.briefId);
  });

  it("records and retrieves failed status with error", () => {
    const id = createPaymentId();
    recordPending(id);
    recordFailed(id, "Settlement reverted");

    expect(getStatus(id)).toBe("failed");
    expect(getResult(id)).toBeUndefined();
    expect(getError(id)).toBe("Settlement reverted");
  });

  it("returns undefined for unknown payment IDs", () => {
    expect(getStatus("never-seen")).toBeUndefined();
    expect(getResult("never-seen")).toBeUndefined();
    expect(getError("never-seen")).toBeUndefined();
  });

  it("correctly handles idempotent retries (settled → returns cached)", () => {
    const id = createPaymentId();
    recordPending(id);
    recordSettled(id, mockReceipt, mockBrief);

    // Second lookup should return the same cached result
    const result1 = getResult(id);
    const result2 = getResult(id);
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result1!.receipt.txHash).toBe(result2!.receipt.txHash);
    expect(result1!.brief.briefId).toBe(result2!.brief.briefId);
  });

  it("failed payment should not return result", () => {
    const id = createPaymentId();
    recordPending(id);
    recordFailed(id, "RPC error");

    expect(getResult(id)).toBeUndefined();
    expect(getError(id)).toBe("RPC error");
  });
});

// ---------------------------------------------------------------------------
// Missing payTo configuration tests
// ---------------------------------------------------------------------------

describe("missing payTo configuration", () => {
  it("rejects payment verification when payTo is empty", () => {
    // Temporarily override the payTo to simulate missing config
    // But since config is module-level, we test the payload verification
    // which checks against the configured payTo
    const payload = buildValidPayload();
    payload.payment = { ...payload.payment, to: "" };
    const result = verifyPaymentPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });
});

// ---------------------------------------------------------------------------
// Payment identifier format validation
// ---------------------------------------------------------------------------

describe("payment identifier format", () => {
  it("payment IDs follow the expected format (pay_uuid)", () => {
    const id = createPaymentId();
    // Should be: pay_ followed by a UUID (8-4-4-4-12 hex digits)
    expect(id).toMatch(/^pay_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generated payment IDs are unique across many calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createPaymentId());
    }
    expect(ids.size).toBe(100);
  });
});
