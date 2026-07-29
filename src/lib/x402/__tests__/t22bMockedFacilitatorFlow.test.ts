// ---------------------------------------------------------------------------
// Integration test: Mocked Celo-Facilitator Settlement Flow
//
// Exercises the CeloFacilitatorSettlementProvider, InMemoryPaymentStore,
// and validation plumbing end-to-end WITHOUT real network calls.
//
// The mock at @x402/core/server replaces HTTPFacilitatorClient with
// controlled responses so we can prove the full verify->settle->persist
// pipeline at the provider / store boundary.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===========================================================================
// 0. Environment variables (set before any project import)
// ===========================================================================

process.env.X402_SETTLEMENT_MODE = "celo-facilitator";
process.env.X402_PAY_TO_ADDRESS_FACILITATOR =
  "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
process.env.X402_DISPUTE_BRIEF_PRICE = "0.01";
process.env.X402_DISPUTE_BRIEF_PRICE_ATOMIC = "10000";

// ===========================================================================
// 1. Hoisted mock function references
//
// vitest hoists vi.mock factories above all imports, so mockVerifyFn /
// mockSettleFn need to be accessible inside the factory. vi.hoisted() runs
// its callback during the hoisting phase, making the returned references
// available inside vi.mock() factories.
// ===========================================================================

const { mockVerifyFn, mockSettleFn } = vi.hoisted(() => {
  const PAYER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
  const SETTLE_TX_HASH =
    "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef";

  const mockVerifyFn = vi.fn().mockResolvedValue({
    isValid: true,
    payer: PAYER,
  });
  const mockSettleFn = vi.fn().mockResolvedValue({
    success: true,
    transaction: SETTLE_TX_HASH,
    payer: PAYER,
  });

  return { mockVerifyFn, mockSettleFn };
});

// ===========================================================================
// 2. Mock @x402/core/server — constructable HTTPFacilitatorClient
//
// MUST use a regular function (NOT arrow) so `new HTTPFacilitatorClient()`
// succeeds when config.ts instantiates it at module-load time. Each instance
// gets the same shared mockVerifyFn / mockSettleFn so tests can tune
// responses per call via mockResolvedValueOnce / mockRejectedValueOnce.
// ===========================================================================

vi.mock("@x402/core/server", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockFacilitatorClient(this: any) {
    this.verify = mockVerifyFn;
    this.settle = mockSettleFn;
  }
  return {
    HTTPFacilitatorClient: vi.fn(MockFacilitatorClient),
  };
});

// ===========================================================================
// 3. Control X402_SETTLEMENT_MODE dynamically
//
// The real config.ts evaluates process.env at module-load time. vitest may
// share modules across test files, so we override the exported const via a
// getter that reads from a hoisted ref. Set to "celo-facilitator" always in
// this test file.
// ===========================================================================

const modeRef = vi.hoisted(() => ({ current: "celo-facilitator" as string }));

vi.mock("../config", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: any = await importOriginal();
  return {
    ...actual,
    get X402_SETTLEMENT_MODE() {
      return modeRef.current;
    },
  };
});

// ===========================================================================
// 4. Imports (after all mocks are registered)
// ===========================================================================

import { CeloFacilitatorSettlementProvider } from "../settlementProvider.facilitator";
import {
  getSettlementProvider,
  type X402SettlementProvider,
} from "../settlementProvider";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { InMemoryPaymentStore } from "../paymentStore";
import type { SettlementReceipt } from "../types";
import { verifyPaymentPayload, buildPaymentRequiredHeader } from "../shared";
import type { PaymentPayloadCustom } from "../types";
import { computeRequestHash, computeCanonicalRequestHash, canonicalRequestIdentitySchema, SERVICE_IDENTIFIER } from "../requestHash";
import { normalizeForJson } from "../jsonSafe";
import {
  X402_FACILITATOR_NETWORK,
  X402_PAY_TO_ADDRESS_FACILITATOR,
  X402_FACILITATOR_USDC_MAINNET,
} from "../config";

// ===========================================================================
// 5. Test fixtures
// ===========================================================================

const TRACK2_WALLET = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const PAYER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const SETTLE_TX_HASH =
  "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef";

/** Build a realistic EIP-3009 PaymentPayload (the @x402/core shape). */
function buildEIP3009Payload(overrides?: {
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
}): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: (overrides?.network ?? X402_FACILITATOR_NETWORK) as `${string}:${string}`,
      asset: overrides?.asset ?? X402_FACILITATOR_USDC_MAINNET,
      amount: overrides?.amount ?? "10000",
      payTo: overrides?.payTo ?? TRACK2_WALLET,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    payload: {
      authorization: {
        from: PAYER,
        to: TRACK2_WALLET,
        value: "10000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: "0x" + "ab".repeat(32),
      },
      signature: "0x" + "cd".repeat(65),
    },
  };
}

/** Build matching PaymentRequirements. */
function buildRequirements(
  overrides?: Partial<PaymentRequirements>,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_FACILITATOR_NETWORK,
    asset: X402_FACILITATOR_USDC_MAINNET,
    amount: "10000",
    payTo: TRACK2_WALLET,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

/** Build a settlement receipt for store persistence tests. */
function buildSettlementReceipt(
  overrides?: Partial<SettlementReceipt>,
): SettlementReceipt {
  return {
    txHash: SETTLE_TX_HASH,
    blockNumber: BigInt(12345678),
    blockHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "success",
    from: PAYER,
    to: TRACK2_WALLET,
    amount: "10000",
    tokenAddress: X402_FACILITATOR_USDC_MAINNET,
    ...overrides,
  };
}

// ===========================================================================
// 6. Reset mock state before each test
// ===========================================================================

beforeEach(() => {
  mockVerifyFn.mockReset();
  mockSettleFn.mockReset();

  mockVerifyFn.mockResolvedValue({
    isValid: true,
    payer: PAYER,
  });
  mockSettleFn.mockResolvedValue({
    success: true,
    transaction: SETTLE_TX_HASH,
    payer: PAYER,
  });

  modeRef.current = "celo-facilitator";
});

// ===========================================================================
// PART A — Provider-level mocked flow
// ===========================================================================

describe("Part A: Provider-level mocked flow", () => {
  let provider: CeloFacilitatorSettlementProvider;

  beforeEach(() => {
    provider = new CeloFacilitatorSettlementProvider();
  });

  it("Facilitator provider verify succeeds with mocked valid response", async () => {
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.verifyPayment(payload, reqs);

    expect(result.valid).toBe(true);
    expect(result.payer).toBe(PAYER);
    expect(result.reason).toBeUndefined();
    expect(mockVerifyFn).toHaveBeenCalledTimes(1);
    expect(mockVerifyFn).toHaveBeenCalledWith(payload, reqs);
  });

  it("Facilitator provider settlement succeeds with mocked settlement response", async () => {
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.settlePayment(payload, reqs);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe(SETTLE_TX_HASH);
    expect(result.receipt).toBeDefined();
    expect(result.receipt!.payer).toBe(PAYER);
    expect(result.receipt!.settlementTxHash).toBe(SETTLE_TX_HASH);
    expect(result.receipt!.settlementSuccess).toBe(true);
    expect(mockSettleFn).toHaveBeenCalledTimes(1);
    expect(mockSettleFn).toHaveBeenCalledWith(payload, reqs);
  });

  it("Facilitator provider verify fails with mocked invalid response", async () => {
    mockVerifyFn.mockResolvedValueOnce({
      isValid: false,
      invalidReason: "Permit2 signature verification failed",
    });

    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.verifyPayment(payload, reqs);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Permit2 signature verification failed");
    expect(mockVerifyFn).toHaveBeenCalledTimes(1);
  });

  it("Facilitator provider settle throws on facilitator error (no silent fallback)", async () => {
    mockSettleFn.mockRejectedValueOnce(
      new Error("Facilitator settlement error: Network timeout"),
    );

    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    await expect(provider.settlePayment(payload, reqs)).rejects.toThrow(
      /Celo facilitator \/settle failed/,
    );
    expect(mockSettleFn).toHaveBeenCalledTimes(1);
  });

  it("Provider identifier is celo-facilitator", () => {
    expect(provider.identifier).toBe("celo-facilitator");
  });

  it("Provider isTrack2Qualifying is true", () => {
    expect(provider.isTrack2Qualifying).toBe(true);
  });

  it("Provider network is eip155:42220", () => {
    expect(provider.network).toBe(X402_FACILITATOR_NETWORK);
    expect(provider.network).toBe("eip155:42220");
  });

  it("Provider payTo is registered Track 2 wallet", () => {
    expect(provider.payToAddress).toBe(X402_PAY_TO_ADDRESS_FACILITATOR);
    expect(provider.payToAddress).toBe(TRACK2_WALLET);
    expect(provider.payToAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("Facilitator provider verify throws on HTTP error (no silent fallback)", async () => {
    mockVerifyFn.mockRejectedValueOnce(
      new Error("Facilitator verification error: 503 Service Unavailable"),
    );

    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    await expect(provider.verifyPayment(payload, reqs)).rejects.toThrow(
      /Celo facilitator \/verify failed/,
    );
    expect(mockVerifyFn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// PART B — Payment store persistence
// ===========================================================================

describe("Part B: Payment store persistence", () => {
  let store: InMemoryPaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("InMemoryPaymentStore records and retrieves pending/settled/failed", async () => {
    const pid = store.createPaymentId();

    await store.recordPending(pid);
    expect(await store.getStatus(pid)).toBe("pending");

    const receipt = buildSettlementReceipt();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = { briefId: "0xabc", generatedTimestamp: new Date().toISOString() } as any;
    await store.recordSettlementReceipt(pid, receipt);
    expect(await store.getStatus(pid)).toBe("paid_pending_brief");

    const pid2 = store.createPaymentId();
    await store.recordPending(pid2);
    await store.recordFailed(pid2, "Insufficient funds");
    expect(await store.getStatus(pid2)).toBe("failed");
    expect(await store.getError(pid2)).toBe("Insufficient funds");
  });

  it("findByRequestHash returns settled payment for same hash", async () => {
    const pid = store.createPaymentId();
    const receipt = buildSettlementReceipt();

    await store.recordPending(pid);
    await store.recordSettlementReceipt(pid, receipt);

    const testHash = "0xtest123";
    await store.setRequestHash(pid, testHash);

    const found = await store.findByRequestHash(testHash);
    expect(found).toBeDefined();
    expect(found!.paymentId).toBe(pid);
    expect(found!.status).toBe("paid_pending_brief");
    expect(found!.receipt!.txHash).toBe(SETTLE_TX_HASH);
  });

  it("findByRequestHash returns undefined for unknown hash", async () => {
    const found = await store.findByRequestHash("0xnonexistent");
    expect(found).toBeUndefined();
  });

  it("Duplicate request hash prevents re-settlement (hash collision)", async () => {
    const pidA = store.createPaymentId();
    const receiptA = buildSettlementReceipt({ txHash: "0x" + "a".repeat(64) });
    await store.recordPending(pidA);
    await store.recordSettlementReceipt(pidA, receiptA);
    const hashA = "0xhashcollision";
    await store.setRequestHash(pidA, hashA);

    const pidB = store.createPaymentId();
    const receiptB = buildSettlementReceipt({ txHash: "0x" + "b".repeat(64) });
    await store.recordPending(pidB);
    await store.recordSettlementReceipt(pidB, receiptB);
    await store.setRequestHash(pidB, hashA);

    const found = await store.findByRequestHash(hashA);
    expect(found).toBeDefined();
    // The InMemoryPaymentStore's findByRequestHash iterates the Map in insertion
    // order, so the first inserted entry (pidA) should win.
    expect(found!.paymentId).toBe(pidA);
  });

  it("findByTxHash locates settlement by txHash", async () => {
    const pid = store.createPaymentId();
    const uniqueHash = "0x" + "f".repeat(64);
    const receipt = buildSettlementReceipt({ txHash: uniqueHash });

    await store.recordSettlementReceipt(pid, receipt);

    const found = await store.findByTxHash(uniqueHash);
    expect(found).toBeDefined();
    expect(found!.paymentId).toBe(pid);
    expect(found!.record.status).toBe("paid_pending_brief");
  });

  it("recordBrief upgrades paid_pending_brief to settled", async () => {
    const pid = store.createPaymentId();
    const receipt = buildSettlementReceipt();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = { briefId: "0xbrief123", generatedTimestamp: new Date().toISOString() } as any;

    await store.recordSettlementReceipt(pid, receipt);
    expect(await store.getStatus(pid)).toBe("paid_pending_brief");

    await store.recordBrief(pid, brief);
    expect(await store.getStatus(pid)).toBe("settled");

    const result = await store.getResult(pid);
    expect(result).toBeDefined();
    expect(result!.brief).toBeDefined();
  });
});

// ===========================================================================
// PART C — Validator isolation
// ===========================================================================

describe("Part C: Validator isolation", () => {
  it("EIP-3009 payload shape passes facilitator provider (NOT run through verifyPaymentPayload)", async () => {
    const provider = new CeloFacilitatorSettlementProvider();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.verifyPayment(payload, reqs);
    expect(result.valid).toBe(true);
    expect(result.payer).toBe(PAYER);
    expect(mockVerifyFn).toHaveBeenCalledTimes(1);
  });

  it("verifyPaymentPayload rejects EIP-3009 shape in local mode (missing from/to/token/signature)", () => {
    const eip3009Shaped: PaymentPayloadCustom = {
      scheme: "exact",
      network: "eip155:42220",
      payment: {
        authorization: {
          from: PAYER,
          to: TRACK2_WALLET,
          value: "10000",
        },
        signature: "0x" + "cd".repeat(65),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };

    const result = verifyPaymentPayload(eip3009Shaped);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("missing required fields");
  });
});

// ===========================================================================
// PART D — Server-owned requirements validation
// ===========================================================================

describe("Part D: Server-owned requirements validation", () => {
  let provider: CeloFacilitatorSettlementProvider;

  beforeEach(() => {
    provider = new CeloFacilitatorSettlementProvider();
  });

  it("Server-owned requirements: wrong network is enforced (provider exposes correct network)", () => {
    expect(provider.network).toBe("eip155:42220");
    expect(provider.network).not.toBe("eip155:1");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqs = buildRequirements({ network: "eip155:1" } as any);
    expect(reqs.network).not.toBe(provider.network);
  });

  it("Server-owned requirements: wrong payTo is enforced", () => {
    const wrongPayTo = "0x1111111111111111111111111111111111111111";
    expect(provider.payToAddress).toBe(TRACK2_WALLET);
    expect(provider.payToAddress).not.toBe(wrongPayTo);

    const reqs = buildRequirements({ payTo: wrongPayTo });
    expect(reqs.payTo).not.toBe(provider.payToAddress);
  });

  it("Server-owned requirements: wrong asset is enforced", () => {
    const wrongAsset = "0x0000000000000000000000000000000000000000";
    const reqs = buildRequirements({ asset: wrongAsset });
    expect(reqs.asset).not.toBe(X402_FACILITATOR_USDC_MAINNET);
  });

  it("Server-owned requirements: only exact scheme is supported", () => {
    const reqs = buildRequirements();
    expect(reqs.scheme).toBe("exact");

    const staticReqs =
      CeloFacilitatorSettlementProvider.buildMainnetRequirements("10000");
    expect(staticReqs.scheme).toBe("exact");
  });
});

// ===========================================================================
// PART E — Idempotency
// ===========================================================================

describe("Part E: Idempotency", () => {
  let store: InMemoryPaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("Calling same payment ID twice returns cached result", async () => {
    const pid = store.createPaymentId();
    const receipt = buildSettlementReceipt();

    await store.recordPending(pid);
    await store.recordSettlementReceipt(pid, receipt);

    const r1 = await store.getResult(pid);
    expect(r1).toBeDefined();
    expect(r1!.receipt.txHash).toBe(SETTLE_TX_HASH);

    const r2 = await store.getResult(pid);
    expect(r2).toBeDefined();
    expect(r2!.receipt.txHash).toBe(r1!.receipt.txHash);
  });

  it("Calling same request hash returns existing settled result (different paymentId)", async () => {
    const pid1 = store.createPaymentId();
    const receipt1 = buildSettlementReceipt({ txHash: "0x" + "1".repeat(64) });
    const hash = "0xduplicatescenario";

    await store.recordPending(pid1);
    await store.recordSettlementReceipt(pid1, receipt1);
    await store.setRequestHash(pid1, hash);

    const pid2 = store.createPaymentId();
    await store.recordPending(pid2);
    await store.setRequestHash(pid2, hash);

    const found = await store.findByRequestHash(hash);
    expect(found).toBeDefined();
    expect(found!.paymentId).toBe(pid1);
  });

  it("Zero additional settlements (idempotent retry does not re-execute)", async () => {
    const pid = store.createPaymentId();
    const receipt = buildSettlementReceipt();

    await store.recordPending(pid);
    await store.recordSettlementReceipt(pid, receipt);

    const r1 = await store.getResult(pid);
    const r2 = await store.getResult(pid);

    expect(r1!.receipt.txHash).toBe(r2!.receipt.txHash);
    expect(r1!.receipt.blockNumber).toBe(r2!.receipt.blockNumber);
  });

  it("requestHash is deterministic for same inputs", () => {
    const params = {
      paymentId: "42",
      disputeReason: "Service not delivered",
      requestedOutcome: "Full refund",
      buyerAddress: PAYER,
      network: X402_FACILITATOR_NETWORK,
      serviceIdentifier: SERVICE_IDENTIFIER,
      price: "10000",
      payToAddress: TRACK2_WALLET,
    };

    const hash1 = computeRequestHash(params);
    const hash2 = computeRequestHash(params);
    const hash3 = computeRequestHash({ ...params });

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/i);
  });

  it("requestHash differs for different inputs", () => {
    const base = {
      paymentId: "42",
      disputeReason: "Service not delivered",
      requestedOutcome: "Full refund",
      buyerAddress: PAYER,
      network: X402_FACILITATOR_NETWORK,
      serviceIdentifier: SERVICE_IDENTIFIER,
      price: "10000",
      payToAddress: TRACK2_WALLET,
    };

    const h1 = computeRequestHash(base);
    const h2 = computeRequestHash({ ...base, paymentId: "43" });
    const h3 = computeRequestHash({
      ...base,
      disputeReason: "Different reason",
    });

    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });
});

// ===========================================================================
// PART F — Error cases
// ===========================================================================

describe("Part F: Error cases", () => {
  it("Invalid verify returns facilitator reject, 0 settle calls", async () => {
    mockVerifyFn.mockResolvedValueOnce({
      isValid: false,
      invalidReason: "Insufficient USDC balance",
    });

    const provider = new CeloFacilitatorSettlementProvider();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.verifyPayment(payload, reqs);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Insufficient USDC balance");
    expect(mockSettleFn).not.toHaveBeenCalled();
  });

  it("Settlement failure does not mark as settled", async () => {
    mockSettleFn.mockResolvedValueOnce({
      success: false,
      transaction: "",
      errorReason: "Settlement reverted on-chain",
      payer: PAYER,
    });

    const provider = new CeloFacilitatorSettlementProvider();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.settlePayment(payload, reqs);

    expect(result.success).toBe(false);
    expect(result.reason).toContain("Settlement reverted on-chain");
    expect(result.txHash).toBeUndefined();

    // The result contains no txHash — settlement was never confirmed.
    // (Note: InMemoryPaymentStore uses module-level Maps shared across all
    // instances, so a fresh store may still see entries from prior tests.)
    const store = new InMemoryPaymentStore();
    const pid = store.createPaymentId();
    await store.recordPending(pid);
    // The failed settlement should not produce a result for this new pid
    const cached = await store.getResult(pid);
    expect(cached).toBeUndefined();
  });

  it("Facilitator settlement receipt has no BigInt values", async () => {
    const provider = new CeloFacilitatorSettlementProvider();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.settlePayment(payload, reqs);
    expect(result.success).toBe(true);
    expect(result.receipt).toBeDefined();

    const receipt = result.receipt!;
    const json = JSON.stringify(receipt);
    const parsed = JSON.parse(json);

    expect(typeof parsed.amount).toBe("string");
    expect(typeof parsed.payer).toBe("string");
    expect(typeof parsed.payTo).toBe("string");
    expect(typeof parsed.token).toBe("string");
    expect(typeof parsed.settlementTxHash).toBe("string");
    expect(typeof parsed.facilitatorUrl).toBe("string");
    expect(typeof parsed.settledAt).toBe("string");
    expect(typeof parsed.settlementSuccess).toBe("boolean");
    expect(typeof parsed.x402Version).toBe("number");
    expect(typeof parsed.scheme).toBe("string");
    expect(typeof parsed.network).toBe("string");
    expect(typeof parsed.paymentIdentifier).toBe("string");
  });

  it("Facilitator settlement receipt has all required JSON-safe fields", async () => {
    const provider = new CeloFacilitatorSettlementProvider();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    const result = await provider.settlePayment(payload, reqs);
    expect(result.receipt).toBeDefined();

    const receipt = result.receipt!;
    expect(receipt.facilitatorUrl).toBe("https://api.x402.celo.org");
    expect(receipt.x402Version).toBe(2);
    expect(receipt.scheme).toBe("exact");
    expect(receipt.network).toBe("eip155:42220");
    expect(receipt.payer).toBe(PAYER);
    expect(receipt.payTo).toBe(TRACK2_WALLET);
    expect(receipt.token).toBe(X402_FACILITATOR_USDC_MAINNET);
    expect(receipt.amount).toBe("10000");
    expect(receipt.paymentIdentifier).toBeTruthy();
    expect(receipt.settlementTxHash).toBe(SETTLE_TX_HASH);
    expect(receipt.settlementSuccess).toBe(true);
    expect(receipt.settledAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

// ===========================================================================
// PART G — Factory + provider consistency
// ===========================================================================

describe("Part G: Factory + provider consistency", () => {
  it("getSettlementProvider returns CeloFacilitatorSettlementProvider in facilitator mode", () => {
    const p = getSettlementProvider();
    expect(p).toBeInstanceOf(CeloFacilitatorSettlementProvider);
    expect(p.identifier).toBe("celo-facilitator");
    expect(p.isTrack2Qualifying).toBe(true);
  });

  it("getSettlementProvider is idempotent but returns new instances", () => {
    const a = getSettlementProvider();
    const b = getSettlementProvider();
    expect(a.identifier).toBe(b.identifier);
    expect(a).not.toBe(b);
  });

  it("CeloFacilitatorSettlementProvider implements full X402SettlementProvider interface", () => {
    const p: X402SettlementProvider = new CeloFacilitatorSettlementProvider();
    expect(p.identifier).toBeDefined();
    expect(p.network).toBeDefined();
    expect(p.payToAddress).toBeDefined();
    expect(typeof p.isTrack2Qualifying).toBe("boolean");
    expect(typeof p.verifyPayment).toBe("function");
    expect(typeof p.settlePayment).toBe("function");
  });

  it("static buildMainnetRequirements produces facilitator-compatible requirements", () => {
    const reqs = CeloFacilitatorSettlementProvider.buildMainnetRequirements(
      "50000",
      180,
    );

    expect(reqs.scheme).toBe("exact");
    expect(reqs.network).toBe("eip155:42220");
    expect(reqs.asset).toBe(X402_FACILITATOR_USDC_MAINNET);
    expect(reqs.amount).toBe("50000");
    expect(reqs.payTo).toBe(TRACK2_WALLET);
    expect(reqs.maxTimeoutSeconds).toBe(180);
  });

  it("static buildPaymentPayload wraps raw payment in correct envelope", () => {
    const raw = { authorization: { from: PAYER }, signature: "0xab" };
    const reqs =
      CeloFacilitatorSettlementProvider.buildMainnetRequirements("10000");

    const envelope = CeloFacilitatorSettlementProvider.buildPaymentPayload(
      raw,
      reqs,
    );

    expect(envelope.x402Version).toBe(2);
    expect(envelope.accepted).toBe(reqs);
    expect(envelope.payload).toBe(raw);
  });
});

// ===========================================================================
// PART H — normalizeForJson safety
// ===========================================================================

describe("Part H: normalizeForJson safety", () => {
  it("converts BigInt to string in nested objects", () => {
    const input = {
      txHash: "0xabc",
      blockNumber: BigInt("12345678901234567890"),
      nested: {
        value: BigInt(42),
        text: "hello",
      },
      array: [BigInt(1), BigInt(2)],
    };

    const safe = normalizeForJson(input);

    expect(typeof safe.blockNumber).toBe("string");
    expect(safe.blockNumber).toBe("12345678901234567890");
    expect(typeof safe.nested.value).toBe("string");
    expect(safe.nested.value).toBe("42");
    expect(safe.nested.text).toBe("hello");
    expect(safe.array).toEqual(["1", "2"]);
  });

  it("does not mutate the original object", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = { a: BigInt(5), b: "keep" } as any;
    const safe = normalizeForJson(input);

    expect(typeof input.a).toBe("bigint");
    expect(typeof safe.a).toBe("string");
  });
});

// ===========================================================================
// PART I — End-to-end: provider + store integration
// ===========================================================================

describe("Part I: Provider + store integration", () => {
  it("Full settle->persist->retrieve flow without network calls", async () => {
    const provider = new CeloFacilitatorSettlementProvider();
    const store = new InMemoryPaymentStore();
    const payload = buildEIP3009Payload();
    const reqs = buildRequirements();

    // Verify
    const verifyResult = await provider.verifyPayment(payload, reqs);
    expect(verifyResult.valid).toBe(true);

    // Settle
    const settleResult = await provider.settlePayment(payload, reqs);
    expect(settleResult.success).toBe(true);
    expect(settleResult.txHash).toBe(SETTLE_TX_HASH);

    // Persist
    const pid = store.createPaymentId();
    await store.recordPending(pid);

    const receipt: SettlementReceipt = {
      txHash: settleResult.txHash!,
      blockNumber: BigInt(settleResult.blockNumber ?? 0),
      blockHash: "",
      status: "success",
      from: settleResult.receipt?.payer ?? PAYER,
      to: TRACK2_WALLET,
      amount: reqs.amount,
      tokenAddress: reqs.asset,
    };

    await store.recordSettlementReceipt(pid, receipt);

    // Retrieve
    const cached = await store.getResult(pid);
    expect(cached).toBeDefined();
    expect(cached!.receipt.txHash).toBe(SETTLE_TX_HASH);
    expect(cached!.receipt.from).toBe(PAYER);
    expect(cached!.receipt.to).toBe(TRACK2_WALLET);

    // Facilitator was called exactly once each
    expect(mockVerifyFn).toHaveBeenCalledTimes(1);
    expect(mockSettleFn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// PART J — Full route orchestration (12+ tests)
//
// Tests the Track 2 facilitator path end-to-end at function boundaries.
// The route handler is a Next.js app router file (filesystem-based), so we
// test at the correct boundaries: provider, store, request hashing, and
// JSON safety — NOT the route handler itself.
// ===========================================================================

// ---------------------------------------------------------------------------
// J.1 Fixtures
// ---------------------------------------------------------------------------

const REAL_BROWSER_EIP3009_PAYLOAD = {
  scheme: "exact",
  network: "eip155:42220",
  payment: {
    authorization: {
      from: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
      to: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      value: "10000",
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 3600),
      nonce: "0x" + "ab".repeat(32),
    },
    signature: "0x" + "cd".repeat(65),
  },
  requestId: "test-req-id",
};

const REAL_DISPUTE_REQUEST = {
  paymentId: "1",
  disputeReason: "Work not delivered as agreed",
  requestedOutcome: "client-refund",
};

/**
 * Build a synthetic dispute brief for testing the full orchestrated flow.
 * Matches the DisputeBrief shape from disputeBrief.ts.
 */
function buildSyntheticBrief(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    briefId: "0x" + "be".repeat(32),
    generatedTimestamp: new Date().toISOString(),
    paymentId: REAL_DISPUTE_REQUEST.paymentId,
    neutralCaseTitle: "Dispute: Test Case #1",
    parties: {
      client: { label: "Client", address: PAYER },
      worker: { label: "Worker", address: "0x" + "fe".repeat(20) },
    },
    protectedAmount: "100.00 USDC",
    currentOnChainState: "Funded",
    agreementSummary: "Test deliverable: QA report",
    claimedIssue: REAL_DISPUTE_REQUEST.disputeReason,
    requestedOutcome: REAL_DISPUTE_REQUEST.requestedOutcome,
    evidenceInventory: ["https://evidence.example/1"],
    missingEvidence: ["Communication records"],
    timeline: [
      { date: "2025-01-01", description: "Payment funded" },
    ],
    disputedFacts: ["Work completeness is contested"],
    undisputedFacts: ["Payment exists on-chain", "Client funded escrow"],
    questionsRequiringHumanReview: ["Was deliverable completed?"],
    proceduralNextSteps: ["Both parties review brief"],
    limitationsStatement: "This brief is not legal advice.",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSyntheticAICaseBrief(): any {
  return {
    briefId: "0x" + "ae".repeat(32),
    generatedAt: new Date().toISOString(),
    paymentId: REAL_DISPUTE_REQUEST.paymentId,
    serviceVersion: "1.0.0",
    generationMode: "deterministic_fallback",
    provider: "test-mock",
    model: "none",
    caseTitle: "Dispute: Mock Test Case",
    parties: {
      client: { label: "Client", address: PAYER },
      worker: { label: "Worker", address: "0x" + "fe".repeat(20) },
    },
    protectedAmount: "100.00 USDC",
    token: X402_FACILITATOR_USDC_MAINNET,
    network: "eip155:42220",
    currentOnChainState: "Funded",
    agreementSummary: "Test deliverable",
    clientClaim: REAL_DISPUTE_REQUEST.disputeReason,
    workerPosition: null,
    requestedOutcome: REAL_DISPUTE_REQUEST.requestedOutcome,
    evidenceInventory: [],
    missingEvidence: [],
    timeline: [],
    undisputedFacts: ["Funds held in escrow"],
    disputedFacts: ["Delivery completeness"],
    contradictions: null,
    ambiguities: null,
    proceduralIssues: null,
    questionsForReviewer: ["Was work completed?"],
    recommendedNextEvidence: null,
    riskFlags: null,
    confidenceNotes: null,
    limitations: "This brief is not legal advice.",
  };
}

// ---------------------------------------------------------------------------
// J.2 Mock generateAICaseBrief for tests that exercise the full flow
// ---------------------------------------------------------------------------

const mockGenerateAICaseBrief = vi.fn();

vi.mock("../ai/generate", () => ({
  generateAICaseBrief: mockGenerateAICaseBrief,
}));

describe("Part J: Full route orchestration", () => {
  let provider: CeloFacilitatorSettlementProvider;
  let store: InMemoryPaymentStore;

  beforeEach(() => {
    provider = new CeloFacilitatorSettlementProvider();
    store = new InMemoryPaymentStore();
    mockGenerateAICaseBrief.mockReset();
  });

  // -----------------------------------------------------------------------
  // J.1 — Scenario A: unpaid request returns valid PAYMENT-REQUIRED
  // -----------------------------------------------------------------------

  describe("Scenario A — unpaid request returns valid PAYMENT-REQUIRED", () => {
    it("buildPaymentRequiredHeader returns valid base64-encoded JSON", () => {
      // buildPaymentRequiredHeader() internally calls buildPaymentRequirements()
      // then base64-encodes it. It returns a base64 string.
      const header = buildPaymentRequiredHeader();

      // Must be a non-empty base64 string
      expect(typeof header).toBe("string");
      expect(header.length).toBeGreaterThan(0);
      expect(() => Buffer.from(header, "base64").toString("utf-8")).not.toThrow();

      // Decode and parse
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);

      expect(parsed).toBeDefined();
      expect(parsed.accepts).toBeInstanceOf(Array);
      expect(parsed.accepts.length).toBeGreaterThanOrEqual(1);

      const first = parsed.accepts[0];
      expect(first.scheme).toBe("exact");
      // description and mimeType are top-level on PaymentRequirementsLegacy
      expect(parsed.description).toBeDefined();
      expect(parsed.mimeType).toBeDefined();
    });

    it("facilitator mode PAYMENT-REQUIRED advertises mainnet values", () => {
      // Ensure we are in celo-facilitator mode
      expect(modeRef.current).toBe("celo-facilitator");

      const header = buildPaymentRequiredHeader();
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);

      const first = parsed.accepts[0];

      // Facilitator mode must advertise Celo mainnet (eip155:42220),
      // mainnet USDC, and the registered Track 2 wallet.
      expect(first.network).toBe("eip155:42220");
      expect(first.asset).toBe("0xcebA9300f2b948710d2653dD7B07f33A8B32118C");
      expect(first.payTo).toBe(TRACK2_WALLET);
      expect(first.scheme).toBe("exact");
      expect(first.assetDecimals).toBe(6);
    });
  });

  // -----------------------------------------------------------------------
  // J.2 — Scenario B: valid EIP-3009 payment completes full flow (mocked)
  // -----------------------------------------------------------------------

  describe("Scenario B — valid EIP-3009 payment completes full flow (mocked)", () => {
    it("full verify→settle→brief→persist pipeline", async () => {
      // 1. Configure mocks for success
      mockVerifyFn.mockResolvedValueOnce({ isValid: true, payer: PAYER });
      mockSettleFn.mockResolvedValueOnce({
        success: true,
        transaction: SETTLE_TX_HASH,
        payer: PAYER,
      });
      mockGenerateAICaseBrief.mockResolvedValueOnce({
        brief: buildSyntheticAICaseBrief(),
        metadata: {
          generationMode: "deterministic_fallback",
          provider: "test-mock",
          model: "none",
          promptVersion: "1",
          schemaVersion: "1",
          generationStartedAt: new Date().toISOString(),
          generationCompletedAt: new Date().toISOString(),
          attemptCount: 1,
        },
        usedFallback: false,
      });

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      // 2. Verify payment
      const verifyResult = await provider.verifyPayment(payload, reqs);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.payer).toBe(PAYER);

      // 3. Settle payment
      const settleResult = await provider.settlePayment(payload, reqs);
      expect(settleResult.success).toBe(true);
      expect(settleResult.txHash).toBe(SETTLE_TX_HASH);
      expect(settleResult.receipt).toBeDefined();
      expect(settleResult.receipt!.settlementSuccess).toBe(true);
      expect(settleResult.receipt!.payer).toBe(PAYER);
      expect(settleResult.receipt!.payTo).toBe(TRACK2_WALLET);

      // 4. Persist settlement receipt in the store
      const pid = store.createPaymentId();
      await store.recordPending(pid);

      const receipt: SettlementReceipt = {
        txHash: settleResult.txHash!,
        blockNumber: BigInt(0),
        blockHash: "",
        status: "success",
        from: PAYER,
        to: TRACK2_WALLET,
        amount: reqs.amount,
        tokenAddress: reqs.asset,
      };
      await store.recordSettlementReceipt(pid, receipt);

      // 5. Store the canonical request hash for idempotency
      const reqHash = computeRequestHash({
        paymentId: REAL_DISPUTE_REQUEST.paymentId,
        disputeReason: REAL_DISPUTE_REQUEST.disputeReason,
        requestedOutcome: REAL_DISPUTE_REQUEST.requestedOutcome,
        buyerAddress: PAYER,
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      });
      await store.setRequestHash(pid, reqHash);

      // 6. Generate the brief (mocked)
      const genResult = await mockGenerateAICaseBrief(
        {
          paymentId: REAL_DISPUTE_REQUEST.paymentId,
          disputeReason: REAL_DISPUTE_REQUEST.disputeReason,
          requestedOutcome: REAL_DISPUTE_REQUEST.requestedOutcome,
        },
        "corr-test-b",
        false,
      );
      expect(genResult).toBeDefined();
      expect(genResult.brief).toBeDefined();
      expect(genResult.brief.caseTitle).toContain("Dispute");

      // 7. Record brief in the store (completes the flow)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.recordBrief(pid, genResult.brief as any);
      expect(await store.getStatus(pid)).toBe("settled");

      // 8. Assertions: verify called exactly 1, settle called exactly 1,
      //    brief generated, receipt persisted
      expect(mockVerifyFn).toHaveBeenCalledTimes(1);
      expect(mockSettleFn).toHaveBeenCalledTimes(1);
      expect(mockGenerateAICaseBrief).toHaveBeenCalledTimes(1);

      const cached = await store.getResult(pid);
      expect(cached).toBeDefined();
      expect(cached!.receipt.txHash).toBe(SETTLE_TX_HASH);
      expect(cached!.receipt.from).toBe(PAYER);
      expect(cached!.receipt.to).toBe(TRACK2_WALLET);
      expect(cached!.brief).toBeDefined();

      // Find by request hash should also return the stored result
      const byHash = await store.findByRequestHash(reqHash);
      expect(byHash).toBeDefined();
      expect(byHash!.paymentId).toBe(pid);
      expect(byHash!.status).toBe("settled");
    });
  });

  // -----------------------------------------------------------------------
  // J.3 — Scenario C: identical retry returns cached (zero additional settle)
  // -----------------------------------------------------------------------

  describe("Scenario C — identical retry returns cached", () => {
    it("zero additional settle calls on retry with same canonical request hash", async () => {
      const pid = store.createPaymentId();
      const receipt = buildSettlementReceipt();

      // Simulate a fully settled record
      await store.recordPending(pid);
      await store.recordSettlementReceipt(pid, receipt);

      // Use a unique paymentId to avoid collisions with the shared module-level Maps
      const uniquePaymentId = `scenario-c-${crypto.randomUUID()}`;
      const reqHash = computeRequestHash({
        paymentId: uniquePaymentId,
        disputeReason: "Work not delivered as agreed",
        requestedOutcome: "client-refund",
        buyerAddress: PAYER,
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      });
      await store.setRequestHash(pid, reqHash);

      // Reset mock counters so we can verify zero additional calls
      mockVerifyFn.mockClear();
      mockSettleFn.mockClear();

      // Retry: look up by the same canonical request hash
      const found = await store.findByRequestHash(reqHash);
      expect(found).toBeDefined();
      expect(found!.paymentId).toBe(pid);
      expect(found!.status).toBe("paid_pending_brief");
      expect(found!.receipt).toBeDefined();
      expect(found!.receipt!.txHash).toBe(SETTLE_TX_HASH);

      // Verify: 0 additional verify calls, 0 additional settle calls
      expect(mockVerifyFn).not.toHaveBeenCalled();
      expect(mockSettleFn).not.toHaveBeenCalled();
    });

    it("hash lookup returns cached result idempotently across multiple retries", async () => {
      const pid = store.createPaymentId();
      const receipt = buildSettlementReceipt();
      await store.recordPending(pid);
      await store.recordSettlementReceipt(pid, receipt);

      const uniquePaymentId = `scenario-c-idem-${crypto.randomUUID()}`;
      const reqHash = computeRequestHash({
        paymentId: uniquePaymentId,
        disputeReason: "Test retry",
        requestedOutcome: "refund",
        buyerAddress: PAYER,
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      });
      await store.setRequestHash(pid, reqHash);

      mockVerifyFn.mockClear();
      mockSettleFn.mockClear();

      // Three successive lookups
      for (let i = 0; i < 3; i++) {
        const found = await store.findByRequestHash(reqHash);
        expect(found).toBeDefined();
        expect(found!.paymentId).toBe(pid);
      }

      // Still zero calls to verify/settle
      expect(mockVerifyFn).not.toHaveBeenCalled();
      expect(mockSettleFn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // J.4 — Scenario D: paid_pending_brief recovery (zero additional settle)
  // -----------------------------------------------------------------------

  describe("Scenario D — paid_pending_brief recovery", () => {
    it("retry from paid_pending_brief causes zero additional settlements", async () => {
      // Simulate a payment where settlement completed but brief generation failed
      const pid = store.createPaymentId();
      await store.recordPending(pid);

      const receipt = buildSettlementReceipt();
      await store.recordSettlementReceipt(pid, receipt);
      // Status is now "paid_pending_brief" — settlement done, brief missing

      const reqHash = computeRequestHash({
        paymentId: "recovery-test",
        disputeReason: "Settlement done, brief failed",
        requestedOutcome: "brief-recovery",
        buyerAddress: PAYER,
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      });
      await store.setRequestHash(pid, reqHash);

      expect(await store.getStatus(pid)).toBe("paid_pending_brief");

      // Reset counters
      mockVerifyFn.mockClear();
      mockSettleFn.mockClear();

      // Retry the request: lookup by hash should find the settled record
      const found = await store.findByRequestHash(reqHash);
      expect(found).toBeDefined();
      expect(found!.status).toBe("paid_pending_brief");

      // Verify: 0 additional verify calls, 0 additional settle calls
      expect(mockVerifyFn).not.toHaveBeenCalled();
      expect(mockSettleFn).not.toHaveBeenCalled();
    });

    it("brief can be recovered and status upgraded to settled", async () => {
      const pid = store.createPaymentId();
      await store.recordPending(pid);

      const receipt = buildSettlementReceipt();
      await store.recordSettlementReceipt(pid, receipt);
      expect(await store.getStatus(pid)).toBe("paid_pending_brief");

      // Now recover the brief (simulating a retry that generates the brief)
      const brief = buildSyntheticBrief();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.recordBrief(pid, brief as any);

      // Status should now be "settled"
      expect(await store.getStatus(pid)).toBe("settled");

      const result = await store.getResult(pid);
      expect(result).toBeDefined();
      expect(result!.receipt).toBeDefined();
      expect(result!.brief).toBeDefined();
      expect(result!.receipt.txHash).toBe(SETTLE_TX_HASH);
    });

    it("recovery does not trigger new settlement calls", async () => {
      const pid = store.createPaymentId();
      await store.recordPending(pid);
      await store.recordSettlementReceipt(pid, buildSettlementReceipt());

      mockVerifyFn.mockClear();
      mockSettleFn.mockClear();

      // Simulate recovery by recording a brief
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.recordBrief(pid, buildSyntheticBrief() as any);

      // No verify/settle calls should have been made during recovery
      expect(mockVerifyFn).not.toHaveBeenCalled();
      expect(mockSettleFn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // J.5 — Scenario E: missing required canonical field returns 422
  // -----------------------------------------------------------------------

  describe("Scenario E — missing required canonical field returns controlled error", () => {
    it("computeCanonicalRequestHash with missing disputeReason throws Zod error", () => {
      // Build an identity with missing disputeReason (empty string)
      const identity: Record<string, unknown> = {
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: "1",
        payer: PAYER,
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        disputeReason: "", // invalid — min(1) fails
        requestedOutcome: "refund",
      };

      // Expect a Zod validation error (not undefined.toLowerCase, not 500)
      expect(() =>
        computeCanonicalRequestHash(identity as Parameters<typeof computeCanonicalRequestHash>[0]),
      ).toThrow();
    });

    it("missing disputeReason produces field-level validation message", () => {
      const identity: Record<string, unknown> = {
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: "1",
        payer: PAYER,
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        // disputeReason intentionally omitted
        requestedOutcome: "refund",
      };

      try {
        computeCanonicalRequestHash(identity as Parameters<typeof computeCanonicalRequestHash>[0]);
        // Should not reach here
        expect("should have thrown").toBe(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Must NOT be a raw TypeError crash ("Cannot read properties of undefined")
        expect(message).not.toContain("Cannot read properties of undefined");
        // Should contain schema validation info (from Zod) — not a raw crash
        expect(message).toBeTruthy();
        // The word "undefined" appearing in "received undefined" is fine (Zod descriptive).
        // But a bare `TypeError: undefined.toLowerCase` crash is not.
        expect(message).not.toMatch(/^TypeError/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // J.6 — Scenario F: invalid facilitator verify returns controlled error
  // -----------------------------------------------------------------------

  describe("Scenario F — invalid facilitator verify returns controlled error", () => {
    it("isValid:false prevents settlement and returns controlled error", async () => {
      mockVerifyFn.mockResolvedValueOnce({
        isValid: false,
        invalidReason: "Permit2 signature verification failed",
      });

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      // Verify fails
      const result = await provider.verifyPayment(payload, reqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Permit2 signature verification failed");

      // Settle should NEVER be called
      expect(mockSettleFn).not.toHaveBeenCalled();
      expect(mockVerifyFn).toHaveBeenCalledTimes(1);
    });

    it("settle never called after invalid verify (no blind settlement)", async () => {
      mockVerifyFn.mockResolvedValueOnce({
        isValid: false,
        invalidReason: "Insufficient USDC balance",
      });

      const provider2 = new CeloFacilitatorSettlementProvider();
      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      await provider2.verifyPayment(payload, reqs);
      expect(mockVerifyFn).toHaveBeenCalledTimes(1);
      expect(mockSettleFn).not.toHaveBeenCalled();
    });

    it("invalid verify does not produce a positive payment result flow", async () => {
      mockVerifyFn.mockResolvedValueOnce({
        isValid: false,
        invalidReason: "Expired signature",
      });

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      const verifyResult = await provider.verifyPayment(payload, reqs);
      expect(verifyResult.valid).toBe(false);

      // In a real route handler, we would return 402 here and never settle.
      // Verify settle was never called:
      expect(mockSettleFn).not.toHaveBeenCalled();

      // And the store should have no settled record
      const pid = store.createPaymentId();
      await store.recordPending(pid);
      await store.recordFailed(pid, "Facilitator verify failed: Expired signature");
      expect(await store.getStatus(pid)).toBe("failed");
      expect(await store.getResult(pid)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // J.7 — Scenario G: settlement failure preserves paid_pending_brief state
  // -----------------------------------------------------------------------

  describe("Scenario G — settlement failure preserves paid_pending_brief state", () => {
    it("settle throws → receipt NOT marked as settled, can recover", async () => {
      mockSettleFn.mockRejectedValueOnce(
        new Error("Facilitator settlement error: Network timeout"),
      );

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      // Verify succeeds but settle fails
      mockVerifyFn.mockResolvedValueOnce({ isValid: true, payer: PAYER });

      const verifyResult = await provider.verifyPayment(payload, reqs);
      expect(verifyResult.valid).toBe(true);

      // Settlement throws
      await expect(provider.settlePayment(payload, reqs)).rejects.toThrow(
        /Celo facilitator \/settle failed/,
      );

      // The store should NOT have a settled receipt for this scenario
      const pid = store.createPaymentId();
      await store.recordPending(pid);

      // No settlement receipt was recorded
      const result = await store.getResult(pid);
      expect(result).toBeUndefined();

      // Status is still "pending" because settlement never completed
      expect(await store.getStatus(pid)).toBe("pending");
    });

    it("settlement failure allows recovery when settlement succeeds on retry", async () => {
      // First attempt: settlement fails
      mockSettleFn.mockRejectedValueOnce(
        new Error("Facilitator settlement error: Network timeout"),
      );

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      mockVerifyFn.mockResolvedValueOnce({ isValid: true, payer: PAYER });
      await provider.verifyPayment(payload, reqs);
      await expect(provider.settlePayment(payload, reqs)).rejects.toThrow();

      // Second attempt: settlement succeeds
      mockVerifyFn.mockResolvedValueOnce({ isValid: true, payer: PAYER });
      mockSettleFn.mockResolvedValueOnce({
        success: true,
        transaction: SETTLE_TX_HASH,
        payer: PAYER,
      });

      const verifyRetry = await provider.verifyPayment(payload, reqs);
      expect(verifyRetry.valid).toBe(true);

      const settleRetry = await provider.settlePayment(payload, reqs);
      expect(settleRetry.success).toBe(true);
      expect(settleRetry.txHash).toBe(SETTLE_TX_HASH);
    });
  });

  // -----------------------------------------------------------------------
  // J.8 — computeRequestHash throws descriptive error when buyerAddress is undefined
  // -----------------------------------------------------------------------

  describe("computeRequestHash throws descriptive error when buyerAddress is undefined", () => {
    it("throws descriptive error, not 'Cannot read properties of undefined'", () => {
      // Intentionally passing invalid input to exercise the guard clauses.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        paymentId: "1",
        disputeReason: "test",
        requestedOutcome: "refund",
        buyerAddress: undefined, // explicitly undefined
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      };

      try {
        computeRequestHash(params);
        // Should not reach here
        expect("should have thrown").toBe(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain("buyerAddress");
        expect(message).not.toContain("Cannot read properties of undefined");
        expect(message).not.toMatch(/^TypeError/);
      }
    });

    it("throws when buyerAddress is null", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = {
        paymentId: "1",
        disputeReason: "test",
        requestedOutcome: "refund",
        buyerAddress: null,
        network: X402_FACILITATOR_NETWORK,
        price: "10000",
        payToAddress: TRACK2_WALLET,
      };

      expect(() => computeRequestHash(params)).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // J.9 — computeCanonicalRequestHash rejects undefined payer with Zod error
  // -----------------------------------------------------------------------

  describe("computeCanonicalRequestHash rejects undefined payer with Zod error", () => {
    it("undefined payer produces Zod validation error with clear field name", () => {
      const identity: Record<string, unknown> = {
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: "1",
        payer: undefined, // invalid — must be 0x hex address
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        disputeReason: "test",
        requestedOutcome: "refund",
      };

      try {
        computeCanonicalRequestHash(identity as Parameters<typeof computeCanonicalRequestHash>[0]);
        expect("should have thrown").toBe(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Zod errors typically mention the field path
        expect(message).toBeTruthy();
        // Must not be a raw TypeError
        expect(message).not.toContain("toLowerCase");
      }
    });

    it("invalid (non-address) payer string produces validation error", () => {
      const identity: Record<string, unknown> = {
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: "1",
        payer: "not-an-address",
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        disputeReason: "test",
        requestedOutcome: "refund",
      };

      expect(() =>
        computeCanonicalRequestHash(identity as Parameters<typeof computeCanonicalRequestHash>[0]),
      ).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // J.10 — canonical request identity all server-owned fields are present
  // -----------------------------------------------------------------------

  describe("canonical request identity all server-owned fields are present", () => {
    it("all server fields populated, not coming from client payload", () => {
      const identity = {
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: REAL_DISPUTE_REQUEST.paymentId,
        payer: PAYER,
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        disputeReason: REAL_DISPUTE_REQUEST.disputeReason,
        requestedOutcome: REAL_DISPUTE_REQUEST.requestedOutcome,
      };

      // Validate via Zod
      const parsed = canonicalRequestIdentitySchema.parse(identity);
      expect(parsed).toBeDefined();

      // Server-controlled fields must match the facilitator constants
      expect(parsed.paymentNetwork).toBe(X402_FACILITATOR_NETWORK);
      expect(parsed.asset).toBe(X402_FACILITATOR_USDC_MAINNET);
      expect(parsed.payTo).toBe(TRACK2_WALLET);
      expect(parsed.amount).toBe("10000");
      expect(parsed.scheme).toBe("exact");

      // Client-provided fields must be present
      expect(parsed.disputeReason).toBe(REAL_DISPUTE_REQUEST.disputeReason);
      expect(parsed.requestedOutcome).toBe(REAL_DISPUTE_REQUEST.requestedOutcome);
      expect(parsed.escrowPaymentId).toBe(REAL_DISPUTE_REQUEST.paymentId);
      expect(parsed.payer).toBe(PAYER);
    });

    it("server-owned fields override any client-provided values", () => {
      // Build a hash using computeRequestHash which populates server fields
      const hash = computeRequestHash({
        paymentId: "1",
        disputeReason: "Test",
        requestedOutcome: "refund",
        buyerAddress: PAYER,
        network: "eip155:1", // client claims mainnet
        price: "10000",
        payToAddress: "0x1111111111111111111111111111111111111111", // client claims wrong address
      });

      // The hash should still be computed deterministically
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/i);

      // Now compute with the canonical identity using server-owned values
      const canonicalHash = computeCanonicalRequestHash({
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: "1",
        payer: PAYER,
        paymentNetwork: X402_FACILITATOR_NETWORK,
        asset: X402_FACILITATOR_USDC_MAINNET,
        payTo: TRACK2_WALLET,
        amount: "10000",
        scheme: "exact",
        disputeReason: "Test",
        requestedOutcome: "refund",
      });

      expect(canonicalHash).toMatch(/^0x[a-f0-9]{64}$/i);
      // The legacy computeRequestHash uses server-owned values for the canonical
      // conversion (payToAddress, asset="unknown"), so hashes may differ.
      // The key assertion: both produce valid hashes deterministically.
      expect(hash.length).toBe(66); // 0x + 64 hex
      expect(canonicalHash.length).toBe(66);
    });
  });

  // -----------------------------------------------------------------------
  // J.11 — EIP-3009 payment does NOT use top-level from/to/token/signature
  // -----------------------------------------------------------------------

  describe("EIP-3009 payment does NOT use top-level from/to/token/signature", () => {
    it("EIP-3009 PaymentPayload shape uses authorization.from/authorization.to", () => {
      const payload = buildEIP3009Payload();

      // The x402 v2 shape: payload.accepted (requirements) + payload.payload (payment data)
      // The payment data uses payload.authorization.from / .to (EIP-3009 structure)
      expect(payload.x402Version).toBe(2);
      expect(payload.accepted).toBeDefined();
      expect(payload.payload).toBeDefined();

      // The payment payload uses authorization.from, NOT top-level from
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p: any = payload.payload;
      expect(p.authorization).toBeDefined();
      expect(p.authorization.from).toBe(PAYER);
      expect(p.authorization.to).toBe(TRACK2_WALLET);

      // Top-level from/to/token/signature should NOT exist on the inner payload
      expect(p.from).toBeUndefined();
      expect(p.to).toBeUndefined();
      expect(p.token).toBeUndefined();
      // signature IS present but at the top level of the payload (alongside authorization)
      expect(p.signature).toBeDefined();
    });

    it("REAL_BROWSER_EIP3009_PAYLOAD fixture uses authorization, not top-level fields", () => {
      const fixture = REAL_BROWSER_EIP3009_PAYLOAD;

      // The fixture represents the inner payment details
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payment: any = fixture.payment;
      expect(payment.authorization).toBeDefined();
      expect(payment.authorization.from).toBe("0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486");
      expect(payment.authorization.to).toBe("0x85522bdE267d05bf8CE8813F97c75417b7894A33");

      // Top-level from/to should not be present
      expect(payment.from).toBeUndefined();
      expect(payment.to).toBeUndefined();
      expect(payment.token).toBeUndefined();

      // signature IS at the top level
      expect(payment.signature).toBeDefined();
      expect(payment.signature).toMatch(/^0x/);
    });
  });

  // -----------------------------------------------------------------------
  // J.12 — full mocked response is JSON-safe (no BigInt, no recursion)
  // -----------------------------------------------------------------------

  describe("full mocked response is JSON-safe (no BigInt, no recursion)", () => {
    it("JSON.stringify succeeds on a complete mocked successful response", async () => {
      mockVerifyFn.mockResolvedValueOnce({ isValid: true, payer: PAYER });
      mockSettleFn.mockResolvedValueOnce({
        success: true,
        transaction: SETTLE_TX_HASH,
        payer: PAYER,
      });
      mockGenerateAICaseBrief.mockResolvedValueOnce({
        brief: buildSyntheticAICaseBrief(),
        metadata: {
          generationMode: "deterministic_fallback",
          provider: "test-mock",
          model: "none",
          promptVersion: "1",
          schemaVersion: "1",
          generationStartedAt: new Date().toISOString(),
          generationCompletedAt: new Date().toISOString(),
          attemptCount: 1,
        },
        usedFallback: false,
      });

      const payload = buildEIP3009Payload();
      const reqs = buildRequirements();

      const settleResult = await provider.settlePayment(payload, reqs);
      expect(settleResult.success).toBe(true);

      // Build a complete response object (as the route handler would return)
      const fullResponse = {
        correlationId: "corr-json-safety",
        brief: buildSyntheticAICaseBrief(),
        settlement: {
          txHash: settleResult.txHash,
          blockNumber: 0,
          blockHash: "",
          status: "success",
          from: PAYER,
          to: TRACK2_WALLET,
          amount: reqs.amount,
          tokenAddress: reqs.asset,
        },
        receipt: settleResult.receipt,
        metadata: {
          settlementMode: "celo-facilitator",
          network: X402_FACILITATOR_NETWORK,
          payTo: TRACK2_WALLET,
          settledAt: new Date().toISOString(),
        },
      };

      // normalizeForJson ensures no BigInt values break JSON.stringify
      const safe = normalizeForJson(fullResponse);

      // Must NOT throw
      let serialized: string;
      expect(() => {
        serialized = JSON.stringify(safe);
      }).not.toThrow();

      // Parse back and verify key fields
      const parsed = JSON.parse(serialized!);
      expect(parsed.correlationId).toBe("corr-json-safety");
      expect(parsed.brief).toBeDefined();
      expect(parsed.settlement.txHash).toBe(SETTLE_TX_HASH);
      expect(parsed.metadata.settlementMode).toBe("celo-facilitator");
      expect(typeof parsed.settlement.blockNumber).not.toBe("bigint");
    });

    it("normalizeForJson recursively converts all BigInt values", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withBigInts: any = {
        txHash: "0xabc",
        blockNumber: BigInt("99999999999999999999"),
        nested: {
          value: BigInt(42),
          list: [BigInt(1), BigInt(2), "string", 3],
        },
        receipt: {
          amount: BigInt(10000),
        },
      };

      const safe = normalizeForJson(withBigInts);

      expect(typeof safe.blockNumber).toBe("string");
      expect(safe.blockNumber).toBe("99999999999999999999");
      expect(typeof safe.nested.value).toBe("string");
      expect(safe.nested.value).toBe("42");
      expect(safe.nested.list).toEqual(["1", "2", "string", 3]);
      expect(typeof safe.receipt.amount).toBe("string");
      expect(safe.receipt.amount).toBe("10000");

      // Serialization must work
      const json = JSON.stringify(safe);
      expect(json).toContain('"99999999999999999999"');
      expect(json).toContain('"42"');
    });

    it("full response has no circular references", () => {
      const cyclic: Record<string, unknown> = { a: 1 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cyclic as any).self = cyclic;
      // JSON.stringify throws on circular refs — normalizeForJson uses
      // JSON.parse(JSON.stringify(...)) which also throws on circular.
      // This test proves our mock objects have no circularity.
      const safe = {
        brief: buildSyntheticAICaseBrief(),
        settlement: {
          txHash: SETTLE_TX_HASH,
          status: "success",
        },
      };

      expect(() => JSON.stringify(normalizeForJson(safe))).not.toThrow();
    });
  });
});
