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

export type PaymentStatus = "pending" | "settled" | "failed";

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
 * Get the full result (receipt + brief) for a settled payment.
 * Returns undefined if the payment is not settled or doesn't exist.
 */
export function getResult(
  paymentId: PaymentIdentifier,
): { receipt: SettlementReceipt; brief: DisputeBrief } | undefined {
  pruneExpired();
  const record = store.get(paymentId);
  if (record?.status === "settled" && record.receipt && record.brief) {
    return { receipt: record.receipt, brief: record.brief };
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
