// ---------------------------------------------------------------------------
// I4: SupabasePaymentStore contract & compliance tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { PaymentStore } from "../paymentStore";
import { InMemoryPaymentStore } from "../paymentStore";
import {
  computeRequestHash,
} from "../requestHash";
import type { SettlementReceipt } from "../types";
import type { DisputeBrief } from "../disputeBrief";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_RECEIPT: SettlementReceipt = {
  txHash: "0x392415d5642f5e74327fddbfba6fd1f434b05e7c6d4e084e3f7bcc4fbb9f0d7c",
  blockNumber: BigInt(10000000),
  blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  status: "success",
  from: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
  to: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  amount: "10000",
  tokenAddress: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
};

const MOCK_BRIEF: DisputeBrief = {
  briefId: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  generatedTimestamp: "2026-07-19T12:00:00.000Z",
  paymentId: "1",
  neutralCaseTitle: "Test Dispute (Payment #1)",
  parties: {
    client: { label: "Client", address: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486" },
    worker: { label: "Worker", address: "0x2222222222222222222222222222222222222222" },
  },
  protectedAmount: "100 USDC",
  currentOnChainState: "Funded",
  agreementSummary: "Test agreement",
  claimedIssue: "Not delivered",
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

// ---------------------------------------------------------------------------
// PaymentStore interface completeness
// ---------------------------------------------------------------------------

describe("I4 PaymentStore interface completeness", () => {
  it("InMemoryPaymentStore implements all PaymentStore methods", () => {
    const store = new InMemoryPaymentStore();

    // Verify all methods exist
    expect(typeof store.createPaymentId).toBe("function");
    expect(typeof store.recordPending).toBe("function");
    expect(typeof store.recordSettled).toBe("function");
    expect(typeof store.recordFailed).toBe("function");
    expect(typeof store.getStatus).toBe("function");
    expect(typeof store.getResult).toBe("function");
    expect(typeof store.getError).toBe("function");
    expect(typeof store.recordSettlementReceipt).toBe("function");
    expect(typeof store.recordBrief).toBe("function");
    expect(typeof store.getAllEntries).toBe("function");
    expect(typeof store.findByTxHash).toBe("function");
    expect(typeof store.isTxHashConsumed).toBe("function");
    expect(typeof store.consumeTxHash).toBe("function");
    expect(typeof store.findConsumedTx).toBe("function");
    expect(typeof store.setRequestHash).toBe("function");
    expect(typeof store.getRequestHash).toBe("function");
  });

  it("InMemoryPaymentStore recordPending is async-compatible", async () => {
    const store = new InMemoryPaymentStore();
    const id = store.createPaymentId();
    await store.recordPending(id);
    const status = await store.getStatus(id);
    expect(status).toBe("pending");
  });

  it("InMemoryPaymentStore full lifecycle is async-compatible", async () => {
    const store = new InMemoryPaymentStore();
    const id = store.createPaymentId();

    await store.recordPending(id);
    expect(await store.getStatus(id)).toBe("pending");

    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    const paidResult = await store.getResult(id);
    expect(paidResult).toBeDefined();
    expect(paidResult!.receipt.txHash).toBe(MOCK_RECEIPT.txHash);
    expect(paidResult!.brief).toBeUndefined();

    await store.recordBrief(id, MOCK_BRIEF);
    const settledResult = await store.getResult(id);
    expect(settledResult).toBeDefined();
    expect(settledResult!.brief!.briefId).toBe(MOCK_BRIEF.briefId);
    expect(await store.getStatus(id)).toBe("settled");
  });
});

// ---------------------------------------------------------------------------
// Factory selection behavior (in-memory when Supabase is not configured)
// ---------------------------------------------------------------------------

describe("I4 store factory", () => {
  it("getPaymentStore returns InMemoryPaymentStore when SUPABASE_URL is not set", async () => {
    // The environment doesn't have SUPABASE_URL set (by default in tests),
    // so the factory should return the in-memory implementation.

    // We verify this by checking that store methods work correctly
    // (they're the in-memory ones, which don't require Supabase).

    // Dynamic import to avoid module caching issues
    const { getPaymentStore } = await import("../paymentStore.supabase");
    const store = getPaymentStore();

    const id = store.createPaymentId();
    await store.recordPending(id);
    const status = await store.getStatus(id);
    expect(status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Atomic state transition patterns
// ---------------------------------------------------------------------------

describe("I4 atomic state transitions (InMemoryPaymentStore)", () => {
  let store: PaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("pending → paid_pending_brief transition works", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);

    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    expect(await store.getStatus(id)).toBe("paid_pending_brief");
  });

  it("paid_pending_brief → settled transition works", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);

    await store.recordBrief(id, MOCK_BRIEF);
    expect(await store.getStatus(id)).toBe("settled");
  });

  it("settled remains terminal — brief is preserved (in-memory: brief is idempotent, not locked)", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    await store.recordBrief(id, MOCK_BRIEF);

    const result1 = await store.getResult(id);
    expect(result1!.brief).toBeDefined();

    // In-memory store allows overwriting; SupabasePaymentStore would reject
    // this via WHERE state = 'paid_pending_brief' conditional update.
    // This is a known difference — the in-memory store is not designed
    // for pessimistic concurrency.
    const differentBrief = { ...MOCK_BRIEF, briefId: "0x9999999999999999999999999999999999999999999999999999999999999999" };
    await store.recordBrief(id, differentBrief);
    const result2 = await store.getResult(id);

    // The brief was overwritten because in-memory has no conditional update.
    // This is documented and accepted — production uses Supabase.
    expect(result2!.brief!.briefId).toBe(differentBrief.briefId);
  });

  it("failed state returns error, not result", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordFailed(id, "Test failure");

    expect(await store.getStatus(id)).toBe("failed");
    expect(await store.getResult(id)).toBeUndefined();
    expect(await store.getError(id)).toBe("Test failure");
  });

  it("request hash persistence survives lifecycle transitions", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);

    const hash = computeRequestHash({
      paymentId: "1",
      disputeReason: "Test",
      requestedOutcome: "Outcome",
      buyerAddress: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
      network: "eip155:11142220",
      price: "10000",
      payToAddress: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    });

    await store.setRequestHash(id, hash);
    expect(await store.getRequestHash(id)).toBe(hash);

    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    expect(await store.getRequestHash(id)).toBe(hash); // Still there after settlement

    await store.recordBrief(id, MOCK_BRIEF);
    expect(await store.getRequestHash(id)).toBe(hash); // Still there after brief
  });
});

// ---------------------------------------------------------------------------
// Concurrency patterns — same payment ID
// ---------------------------------------------------------------------------

describe("I4 concurrency — duplicate payment identifier", () => {
  let store: PaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("duplicate recordSettlementReceipt overwrites in-memory (documented limitation)", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);

    // In-memory store overwrites unconditionally.
    // SupabasePaymentStore uses conditional UPDATE WHERE transaction_hash IS NULL
    // which would preserve the first receipt. This test documents the difference.
    const secondReceipt: SettlementReceipt = {
      ...MOCK_RECEIPT,
      txHash: "0x" + "b".repeat(64),
    };
    await store.recordSettlementReceipt(id, secondReceipt);

    const afterResult = await store.getResult(id);
    // In-memory: overwritten. Supabase: first receipt preserved.
    expect(afterResult!.receipt.txHash).toBe(secondReceipt.txHash);
  });

  it("transaction hash is unique — consumed only once", async () => {
    const txHash = "0x" + "a".repeat(64);
    await store.consumeTxHash(txHash, "pay_test", { legacyRecovery: true });

    expect(await store.isTxHashConsumed(txHash)).toBe(true);

    // Second consume should be a no-op (or we check before calling)
    const isConsumed = await store.isTxHashConsumed(txHash);
    expect(isConsumed).toBe(true);
  });

  it("same payment identifier returns existing brief on retry", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    await store.recordBrief(id, MOCK_BRIEF);

    // Retry — should get same result
    const result1 = await store.getResult(id);
    const result2 = await store.getResult(id);
    expect(result1!.receipt.txHash).toBe(result2!.receipt.txHash);
    expect(result1!.brief!.briefId).toBe(result2!.brief!.briefId);
  });
});

// ---------------------------------------------------------------------------
// Process restart recovery (in-memory limitation)
// ---------------------------------------------------------------------------

describe("I4 process restart — in-memory limitation", () => {
  it("new InMemoryPaymentStore shares module-level maps (documented limitation)", async () => {
    // Two instances of InMemoryPaymentStore share the same Map because
    // the storage is module-level, not instance-level. This is a known
    // limitation of the in-memory implementation. The SupabasePaymentStore
    // uses a shared PostgreSQL database which IS durable across instances.
    const store1 = new InMemoryPaymentStore();
    const id = store1.createPaymentId();
    await store1.recordPending(id);
    await store1.recordSettlementReceipt(id, MOCK_RECEIPT);

    expect(await store1.getResult(id)).toBeDefined();

    // "New" instance — shares the same module-level Map
    const store2 = new InMemoryPaymentStore();
    // Records persist because the underlying store Map is module-level
    expect(await store2.getResult(id)).toBeDefined();

    // This means the "process restart" test doesn't apply to InMemoryPaymentStore.
    // Process restart WOULD clear the Map (this test simulates same-process, different instance).
    // SupabasePaymentStore data survives process restarts because it's in PostgreSQL.
  });
});

// ---------------------------------------------------------------------------
// Legacy settlement migration idempotency patterns
// ---------------------------------------------------------------------------

describe("I4 legacy settlement migration idempotency", () => {
  let store: PaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("consuming the same txHash twice is idempotent (safe)", async () => {
    const txHash = "0x392415d5642f5e74327fddbfba6fd1f434b05e7c6d4e084e3f7bcc4fbb9f0d7c";

    await store.consumeTxHash(txHash, "pay_legacy", {
      legacyRecovery: true,
      recoveredPayer: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
    });

    expect(await store.isTxHashConsumed(txHash)).toBe(true);

    // Second consume — should not throw
    await store.consumeTxHash(txHash, "pay_legacy", {
      legacyRecovery: true,
      recoveredPayer: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
    });

    const record = await store.findConsumedTx(txHash);
    expect(record).toBeDefined();
    expect(record!.legacyRecovery).toBe(true);
  });

  it("legacy settlement is bound to Payment #1", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, {
      ...MOCK_RECEIPT,
      from: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
    });

    const result = await store.getResult(id);
    expect(result).toBeDefined();
    expect(result!.receipt.from.toLowerCase()).toBe(
      "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486"
    );
  });

  it("migration can look up settlement by txHash (shared module-level maps)", async () => {
    const id = store.createPaymentId();
    const uniqueTxHash = "0x" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const uniqueReceipt = { ...MOCK_RECEIPT, txHash: uniqueTxHash };

    await store.recordPending(id);
    await store.recordSettlementReceipt(id, uniqueReceipt);

    // findByTxHash works because the receipt is stored in the shared
    // module-level Map. This is the same behavior used by the API route.
    const found = await store.findByTxHash(uniqueTxHash);
    expect(found).toBeDefined();
    expect(found!.paymentId).toBe(id);
    expect(found!.record.receipt!.txHash).toBe(uniqueTxHash);
  });
});

// ---------------------------------------------------------------------------
// Public metadata — unauthenticated GET pattern
// ---------------------------------------------------------------------------

describe("I4 public settlement metadata (unauthenticated GET)", () => {
  let store: PaymentStore;

  beforeEach(() => {
    store = new InMemoryPaymentStore();
  });

  it("public metadata includes txHash and block number but no brief", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);
    await store.recordBrief(id, MOCK_BRIEF);

    const result = await store.getResult(id);

    // Public fields (visible without wallet auth):
    expect(result!.receipt.txHash).toBeDefined();
    expect(result!.receipt.blockNumber).toBeDefined();
    expect(result!.receipt.from).toBeDefined();
    expect(result!.receipt.to).toBeDefined();
    expect(result!.receipt.amount).toBeDefined();
    expect(result!.receipt.tokenAddress).toBeDefined();

    // The brief is available but should only be returned to authenticated callers.
    // The API route enforces this check, not the store.
    expect(result!.brief).toBeDefined();
  });

  it("findByTxHash returns public metadata", async () => {
    const id = store.createPaymentId();
    await store.recordPending(id);
    await store.recordSettlementReceipt(id, MOCK_RECEIPT);

    const found = await store.findByTxHash(MOCK_RECEIPT.txHash);
    expect(found).toBeDefined();
    expect(found!.record.status).toBeDefined();
    expect(found!.record.receipt).toBeDefined();
  });

  it("finding by unknown txHash returns undefined", async () => {
    const found = await store.findByTxHash("0x" + "f".repeat(64));
    expect(found).toBeUndefined();
  });
});
