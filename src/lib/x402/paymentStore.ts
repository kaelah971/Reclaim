// ---------------------------------------------------------------------------
// x402 payment identifier store — idempotency & result caching
//
// SERVER-ONLY. An in-memory Map-based store that tracks payment lifecycle:
// pending → settled (with brief + receipt) or failed (with error).
//
// SERVERLESS LIMITATIONS (I3.1 documented):
//   - Hot reload clears the in-memory store.
//   - Multiple Vercel server instances do not share this store.
//   - Process restarts lose all pending / settled records.
//   - Durable persistence (Redis, DynamoDB, Supabase) is required before
//     production to preserve payment records across cold starts and
//     deployments.
//
// The PaymentStore interface is intentionally crafted so the in-memory
// implementation can be swapped for a durable backend without rewriting
// the route handler.
//
// I4: Added InMemoryPaymentStore class for interface compliance.
//     SupabasePaymentStore is in paymentStore.supabase.ts.
//     Use getPaymentStore() from paymentStore.supabase.ts for the
//     active implementation.
// ---------------------------------------------------------------------------

import type { SettlementReceipt } from "./types";
import type { DisputeBrief } from "./disputeBrief";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentIdentifier = string;

export type PaymentStatus = "pending" | "settled" | "failed" | "paid_pending_brief";

export interface PaymentRecord {
  status: PaymentStatus;
  receipt?: SettlementReceipt;
  brief?: DisputeBrief;
  error?: string;
  createdAt: number;
}

export interface ConsumedTxRecord {
  txHash: string;
  paymentId: PaymentIdentifier;
  consumedAt: number;
  legacyRecovery?: boolean;
  recoveredPayer?: string;
  recoveredRequestHash?: string;
}

// ---------------------------------------------------------------------------
// PaymentStore interface — contract for replaceable implementations
//
// I4: All methods are async to support both in-memory and database-backed
//     implementations without changing the interface.
// ---------------------------------------------------------------------------

export interface PaymentStore {
  createPaymentId(): PaymentIdentifier;
  recordPending(paymentId: PaymentIdentifier, payerAddress?: string, payToAddress?: string, amount?: string): Promise<void>;
  recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): Promise<void>;
  recordFailed(paymentId: PaymentIdentifier, error: string): Promise<void>;
  getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined>;
  getResult(paymentId: PaymentIdentifier): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined>;
  getError(paymentId: PaymentIdentifier): Promise<string | undefined>;
  recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): Promise<void>;
  recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void>;
  getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>>;
  findByTxHash(txHash: string): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined>;

  /** I3.1: Check whether a transaction hash has already been consumed for recovery. */
  isTxHashConsumed(txHash: string): Promise<boolean>;

  /**
   * I3.1: Mark a transaction hash as consumed so it cannot be reused for
   * another brief / payment ID.
   */
  consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): Promise<void>;

  /** I3.1: Look up a consumed transaction record (for diagnostics). */
  findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined>;

  /** I3.1: Store the canonical request hash computed before settlement. */
  setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void>;

  /** I3.1: Retrieve the canonical request hash for a payment. */
  getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// In-memory store data
// ---------------------------------------------------------------------------

const store = new Map<PaymentIdentifier, PaymentRecord>();
const consumedTxs = new Map<string, ConsumedTxRecord>();
const requestHashStore = new Map<PaymentIdentifier, string>();

/** Remove records older than this (1 hour in ms). */
const MAX_AGE_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// InMemoryPaymentStore — satisfies the PaymentStore interface
// ---------------------------------------------------------------------------

export class InMemoryPaymentStore implements PaymentStore {
  createPaymentId(): PaymentIdentifier {
    return `pay_${crypto.randomUUID()}`;
  }

  async recordPending(paymentId: PaymentIdentifier): Promise<void> {
    store.set(paymentId, { status: "pending", createdAt: Date.now() });
  }

  async recordSettled(
    paymentId: PaymentIdentifier,
    receipt: SettlementReceipt,
    brief: DisputeBrief,
  ): Promise<void> {
    store.set(paymentId, { status: "settled", receipt, brief, createdAt: Date.now() });
  }

  async recordFailed(paymentId: PaymentIdentifier, error: string): Promise<void> {
    store.set(paymentId, { status: "failed", error, createdAt: Date.now() });
  }

  async getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined> {
    pruneExpired();
    return store.get(paymentId)?.status;
  }

  async getResult(
    paymentId: PaymentIdentifier,
  ): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    pruneExpired();
    const record = store.get(paymentId);
    if (
      (record?.status === "settled" || record?.status === "paid_pending_brief") &&
      record.receipt
    ) {
      return { receipt: record.receipt, brief: record.brief };
    }
    return undefined;
  }

  async getError(paymentId: PaymentIdentifier): Promise<string | undefined> {
    pruneExpired();
    const record = store.get(paymentId);
    if (record?.status === "failed") return record.error;
    return undefined;
  }

  async recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): Promise<void> {
    store.set(paymentId, { status: "paid_pending_brief", receipt, createdAt: Date.now() });
  }

  async recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void> {
    const record = store.get(paymentId);
    if (!record || !record.receipt) return;
    if (record.status !== "paid_pending_brief" && record.status !== "settled") return;
    store.set(paymentId, { ...record, status: "settled", brief, createdAt: Date.now() });
  }

  async getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>> {
    pruneExpired();
    return store;
  }

  async findByTxHash(
    txHash: string,
  ): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined> {
    pruneExpired();
    for (const [paymentId, record] of store) {
      if (record.receipt?.txHash?.toLowerCase() === txHash.toLowerCase()) {
        return { paymentId, record };
      }
    }
    return undefined;
  }

  async isTxHashConsumed(txHash: string): Promise<boolean> {
    return consumedTxs.has(txHash.toLowerCase());
  }

  async consumeTxHash(
    txHash: string,
    paymentId: PaymentIdentifier,
    metadata?: Partial<ConsumedTxRecord>,
  ): Promise<void> {
    consumedTxs.set(txHash.toLowerCase(), {
      txHash,
      paymentId,
      consumedAt: Date.now(),
      ...metadata,
    });
  }

  async findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined> {
    return consumedTxs.get(txHash.toLowerCase());
  }

  async setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void> {
    requestHashStore.set(paymentId, requestHash);
  }

  async getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined> {
    return requestHashStore.get(paymentId);
  }
}

// ---------------------------------------------------------------------------
// Legacy standalone function exports — keep existing tests and callers working
//
// These delegate to a singleton InMemoryPaymentStore for backward compat.
// New code should use getPaymentStore() from paymentStore.supabase.ts.
// ---------------------------------------------------------------------------

const legacyStore = new InMemoryPaymentStore();

export function createPaymentId(): PaymentIdentifier {
  return legacyStore.createPaymentId();
}

export function recordPending(paymentId: PaymentIdentifier): void {
  store.set(paymentId, { status: "pending", createdAt: Date.now() });
}

export function recordSettled(
  paymentId: PaymentIdentifier,
  receipt: SettlementReceipt,
  brief: DisputeBrief,
): void {
  store.set(paymentId, { status: "settled", receipt, brief, createdAt: Date.now() });
}

export function recordFailed(paymentId: PaymentIdentifier, error: string): void {
  store.set(paymentId, { status: "failed", error, createdAt: Date.now() });
}

export function getStatus(paymentId: PaymentIdentifier): PaymentStatus | undefined {
  pruneExpired();
  return store.get(paymentId)?.status;
}

export function getResult(
  paymentId: PaymentIdentifier,
): { receipt: SettlementReceipt; brief?: DisputeBrief } | undefined {
  pruneExpired();
  const record = store.get(paymentId);
  if (
    (record?.status === "settled" || record?.status === "paid_pending_brief") &&
    record.receipt
  ) {
    return { receipt: record.receipt, brief: record.brief };
  }
  return undefined;
}

export function recordSettlementReceipt(
  paymentId: PaymentIdentifier,
  receipt: SettlementReceipt,
): void {
  store.set(paymentId, { status: "paid_pending_brief", receipt, createdAt: Date.now() });
}

export function recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): void {
  const record = store.get(paymentId);
  if (!record || !record.receipt) return;
  if (record.status !== "paid_pending_brief" && record.status !== "settled") return;
  store.set(paymentId, { ...record, status: "settled", brief, createdAt: Date.now() });
}

export function getAllEntries(): ReadonlyMap<PaymentIdentifier, PaymentRecord> {
  pruneExpired();
  return store;
}

export function findByTxHash(
  txHash: string,
): { paymentId: PaymentIdentifier; record: PaymentRecord } | undefined {
  pruneExpired();
  for (const [paymentId, record] of store) {
    if (record.receipt?.txHash?.toLowerCase() === txHash.toLowerCase()) {
      return { paymentId, record };
    }
  }
  return undefined;
}

export function getError(paymentId: PaymentIdentifier): string | undefined {
  pruneExpired();
  const record = store.get(paymentId);
  if (record?.status === "failed") return record.error;
  return undefined;
}

export function isTxHashConsumed(txHash: string): boolean {
  return consumedTxs.has(txHash.toLowerCase());
}

export function consumeTxHash(
  txHash: string,
  paymentId: PaymentIdentifier,
  metadata?: Partial<ConsumedTxRecord>,
): void {
  consumedTxs.set(txHash.toLowerCase(), {
    txHash,
    paymentId,
    consumedAt: Date.now(),
    ...metadata,
  });
}

export function findConsumedTx(txHash: string): ConsumedTxRecord | undefined {
  return consumedTxs.get(txHash.toLowerCase());
}

export function setRequestHash(paymentId: PaymentIdentifier, requestHash: string): void {
  requestHashStore.set(paymentId, requestHash);
}

export function getRequestHash(paymentId: PaymentIdentifier): string | undefined {
  return requestHashStore.get(paymentId);
}

// ---------------------------------------------------------------------------
// Internal: prune expired records to prevent unbounded memory growth
// ---------------------------------------------------------------------------

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now - record.createdAt > MAX_AGE_MS) {
      store.delete(key);
      requestHashStore.delete(key);
    }
  }
}
