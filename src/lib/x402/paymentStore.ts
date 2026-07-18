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

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const store = new Map<PaymentIdentifier, PaymentRecord>();

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
// Internal: prune expired records to prevent unbounded memory growth
// ---------------------------------------------------------------------------

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now - record.createdAt > MAX_AGE_MS) {
      store.delete(key);
    }
  }
}
