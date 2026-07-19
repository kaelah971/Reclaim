// ---------------------------------------------------------------------------
// x402 payment identifier store — idempotency & result caching
//
// SERVER-ONLY. An in-memory Map-based store that tracks payment lifecycle:
// pending → settled (with brief + receipt) or failed (with error).
//
// IMPORTANT: This is NOT durable. Vercel serverless instances do not share
// memory. A payment identifier recorded on one instance is invisible to
// another. For production, replace with Redis, DynamoDB, or another shared
// store. The idempotency guarantee is best-effort within a single instance.
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
// ---------------------------------------------------------------------------

export interface PaymentStore {
  createPaymentId(): PaymentIdentifier;
  recordPending(paymentId: PaymentIdentifier): void;
  recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): void;
  recordFailed(paymentId: PaymentIdentifier, error: string): void;
  getStatus(paymentId: PaymentIdentifier): PaymentStatus | undefined;
  getResult(paymentId: PaymentIdentifier): { receipt: SettlementReceipt; brief?: DisputeBrief } | undefined;
  getError(paymentId: PaymentIdentifier): string | undefined;
  recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): void;
  recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): void;
  getAllEntries(): ReadonlyMap<PaymentIdentifier, PaymentRecord>;
  findByTxHash(txHash: string): { paymentId: PaymentIdentifier; record: PaymentRecord } | undefined;

  /** I3.1: Check whether a transaction hash has already been consumed for recovery. */
  isTxHashConsumed(txHash: string): boolean;

  /**
   * I3.1: Mark a transaction hash as consumed so it cannot be reused for
   * another brief / payment ID.
   */
  consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): void;

  /** I3.1: Look up a consumed transaction record (for diagnostics). */
  findConsumedTx(txHash: string): ConsumedTxRecord | undefined;

  /** I3.1: Store the canonical request hash computed before settlement. */
  setRequestHash(paymentId: PaymentIdentifier, requestHash: string): void;

  /** I3.1: Retrieve the canonical request hash for a payment. */
  getRequestHash(paymentId: PaymentIdentifier): string | undefined;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const store = new Map<PaymentIdentifier, PaymentRecord>();
const consumedTxs = new Map<string, ConsumedTxRecord>();
const requestHashStore = new Map<PaymentIdentifier, string>();

/** Remove records older than this (1 hour in ms). */
const MAX_AGE_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a unique payment identifier using crypto.randomUUID().
 * Prefixes with "pay_" for readability in logs.
 */
export function createPaymentId(): PaymentIdentifier {
  return `pay_${crypto.randomUUID()}`;
}

/**
 * Mark a payment as pending (awaiting settlement).
 */
export function recordPending(paymentId: PaymentIdentifier): void {
  store.set(paymentId, {
    status: "pending",
    createdAt: Date.now(),
  });
}

/**
 * Mark a payment as successfully settled. Stores the receipt and brief
 * so idempotent retries can return the same result without re-settling.
 */
export function recordSettled(
  paymentId: PaymentIdentifier,
  receipt: SettlementReceipt,
  brief: DisputeBrief,
): void {
  store.set(paymentId, {
    status: "settled",
    receipt,
    brief,
    createdAt: Date.now(),
  });
}

/**
 * Mark a payment as failed. Stores the error message for diagnostics.
 */
export function recordFailed(
  paymentId: PaymentIdentifier,
  error: string,
): void {
  store.set(paymentId, {
    status: "failed",
    error,
    createdAt: Date.now(),
  });
}

/**
 * Get the current status of a payment identifier.
 * Returns undefined if the paymentId has never been seen.
 */
export function getStatus(
  paymentId: PaymentIdentifier,
): PaymentStatus | undefined {
  pruneExpired();
  return store.get(paymentId)?.status;
}

/**
 * Get the full result (receipt + brief) for a settled or paid-pending payment.
 * Returns undefined if the payment has not been settled.
 */
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

/**
 * Record ONLY the settlement receipt — without the brief.
 * Used when settlement succeeds but brief generation must be deferred.
 * The record can be upgraded later with recordBrief().
 */
export function recordSettlementReceipt(
  paymentId: PaymentIdentifier,
  receipt: SettlementReceipt,
): void {
  store.set(paymentId, {
    status: "paid_pending_brief",
    receipt,
    createdAt: Date.now(),
  });
}

/**
 * Attach a brief to an existing settlement receipt.
 * Upgrades the status from paid_pending_brief → settled.
 * No-ops if the payment is not in a recoverable state.
 */
export function recordBrief(
  paymentId: PaymentIdentifier,
  brief: DisputeBrief,
): void {
  const record = store.get(paymentId);
  if (!record || !record.receipt) return;
  if (record.status !== "paid_pending_brief" && record.status !== "settled") return;
  store.set(paymentId, {
    ...record,
    status: "settled",
    brief,
    createdAt: Date.now(),
  });
}

/**
 * Return all non-expired entries for inspection / recovery.
 * Exposed for admin/debug use — not for regular request paths.
 */
export function getAllEntries(): ReadonlyMap<PaymentIdentifier, PaymentRecord> {
  pruneExpired();
  return store;
}

/**
 * Search all entries for a settlement matching a transaction hash.
 * Returns the payment identifier and record, or undefined.
 */
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

/**
 * Get the error message for a failed payment.
 */
export function getError(
  paymentId: PaymentIdentifier,
): string | undefined {
  pruneExpired();
  const record = store.get(paymentId);
  if (record?.status === "failed") {
    return record.error;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// I3.1: Transaction hash consumption (replay protection)
// ---------------------------------------------------------------------------

/**
 * Check whether a transaction hash has already been consumed for recovery.
 * Consumed transactions cannot be reused for another brief or payment ID.
 */
export function isTxHashConsumed(txHash: string): boolean {
  const key = txHash.toLowerCase();
  return consumedTxs.has(key);
}

/**
 * Mark a transaction hash as consumed so it cannot be reused.
 * Always records with lowercase key for case-insensitive lookup.
 *
 * @param txHash   The settlement transaction hash to consume.
 * @param paymentId The payment ID this recovery was bound to.
 * @param metadata  Optional metadata (legacy flag, payer, request hash).
 */
export function consumeTxHash(
  txHash: string,
  paymentId: PaymentIdentifier,
  metadata?: Partial<ConsumedTxRecord>,
): void {
  const key = txHash.toLowerCase();
  consumedTxs.set(key, {
    txHash: txHash,
    paymentId,
    consumedAt: Date.now(),
    ...metadata,
  });
}

/**
 * Look up a consumed transaction record.
 * Returns undefined if the txHash has never been consumed.
 */
export function findConsumedTx(
  txHash: string,
): ConsumedTxRecord | undefined {
  const key = txHash.toLowerCase();
  return consumedTxs.get(key);
}

// ---------------------------------------------------------------------------
// I3.1: Request hash storage (brief input binding)
// ---------------------------------------------------------------------------

/**
 * Store the canonical request hash for a payment.
 * Called BEFORE settlement so the hash is available during recovery.
 */
export function setRequestHash(
  paymentId: PaymentIdentifier,
  requestHash: string,
): void {
  requestHashStore.set(paymentId, requestHash);
}

/**
 * Retrieve the canonical request hash for a payment.
 * Returns undefined if no hash was stored.
 */
export function getRequestHash(
  paymentId: PaymentIdentifier,
): string | undefined {
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
  /* consumedTx records are intentionally NOT pruned by age — they provide
     permanent replay protection for the lifetime of the in-memory instance */
}
