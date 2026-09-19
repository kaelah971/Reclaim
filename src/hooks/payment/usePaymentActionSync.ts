"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// usePaymentActionSync — post-receipt canonical sync (P4.5F).
//
// After a successful receipt:
//  1. caller locks the completed action (disabled on isSuccess — see room)
//  2. this hook shows "Transaction confirmed — updating payment status…"
//  3. refetches canonical payment state immediately
//  4. if RPC is stale, bounded poll/backoff until the expected barrier
//     appears (e.g. Created → Funded)
//  5. stops automatically once expected state appears
//  6. on timeout shows "Transaction confirmed. Status is still updating."
//     + safe "Refresh status" (refetch only — never rebroadcast)
//
// NEVER rebroadcasts: only refetch() is ever called, never the write action.
// Polling is cancelled on unmount / payment / chain change.
// ---------------------------------------------------------------------------

export const PAYMENT_SYNCING_MESSAGE =
  "Transaction confirmed — updating payment status…";
export const PAYMENT_SYNC_TIMEOUT_MESSAGE =
  "Transaction confirmed. Status is still updating.";

/** Lifecycle order for barrier progression (Disputed/Cancelled are branches). */
const LIFECYCLE_ORDER: Record<string, number> = {
  Created: 0,
  Funded: 1,
  Accepted: 2,
  DeliverySubmitted: 3,
  ReleaseRequested: 4,
  Released: 5,
};

/**
 * True when the canonical state has reached (or passed) the expected barrier.
 * Later lifecycle states count as met (e.g. Accepted satisfies a Funded
 * barrier). Branch states (Disputed/Cancelled) never satisfy a forward
 * barrier — they are distinct outcomes.
 */
export function isSyncBarrierMet(
  canonicalState: string | undefined,
  expectedState: string | undefined,
): boolean {
  if (expectedState === undefined) return true;
  if (canonicalState === undefined) return false;
  if (canonicalState === expectedState) return true;
  const canonicalIdx = LIFECYCLE_ORDER[canonicalState];
  const expectedIdx = LIFECYCLE_ORDER[expectedState];
  if (canonicalIdx === undefined || expectedIdx === undefined) return false;
  return canonicalIdx > expectedIdx;
}

export interface PaymentActionSyncParams {
  /** True once the tx receipt confirmed. */
  isSuccess: boolean;
  /** Tx hash once signed (preserved for display). */
  txHash: `0x${string}` | undefined;
  /** Current canonical on-chain state (e.g. payment.state). */
  canonicalState: string | undefined;
  /** Expected barrier state (e.g. "Funded" after fundPayment). */
  expectedState: string | undefined;
  /** Canonical refetch (e.g. refetchPayment). Never the write. */
  refetch: () => void;
  /** Payment identity for effect scoping (cancels on change). */
  paymentId: string | bigint | undefined;
  /** Chain identity for effect scoping (cancels on change). */
  chainId: number | undefined;
  /** Bounded poll timeout (default 60s). */
  timeoutMs?: number;
  /** Poll cadence (default 4s). */
  pollIntervalMs?: number;
}

export interface PaymentActionSync {
  /** Receipt confirmed but canonical state not yet at the barrier. */
  isSyncing: boolean;
  /** Bounded wait elapsed — still confirmed, still stale. */
  isTimedOut: boolean;
  /** Receipt confirmed and barrier observed. */
  isSynced: boolean;
}

export function usePaymentActionSync({
  isSuccess,
  txHash,
  canonicalState,
  expectedState,
  refetch,
  paymentId,
  chainId,
  timeoutMs = 60000,
  pollIntervalMs = 4000,
}: PaymentActionSyncParams): PaymentActionSync {
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef(refetch);

  useEffect(() => {
    refetchRef.current = refetch;
  });

  const paymentKey =
    paymentId === undefined ? "" : paymentId.toString();
  const barrierMet = isSyncBarrierMet(canonicalState, expectedState);
  const needsSync =
    isSuccess &&
    txHash !== undefined &&
    expectedState !== undefined &&
    !barrierMet;

  // Reset timeout flag when identity changes or sync no longer needed.
  useEffect(() => {
    if (!needsSync) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimedOut(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSync, paymentKey, chainId, expectedState]);

  useEffect(() => {
    if (!needsSync || timedOut) return;

    // Immediate canonical re-read on receipt.
    try {
      refetchRef.current();
    } catch {
      // Best-effort — polling continues.
    }

    timerRef.current = setInterval(() => {
      try {
        refetchRef.current();
      } catch {
        // Best-effort.
      }
    }, pollIntervalMs);

    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, timeoutMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // paymentKey/chainId/expectedState cancel polling on change (unmount
    // safety included via cleanup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSync, timedOut, paymentKey, chainId, expectedState, pollIntervalMs, timeoutMs]);

  // Unmount safety: never leak timers.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const isSynced =
    isSuccess &&
    txHash !== undefined &&
    expectedState !== undefined &&
    barrierMet;

  return {
    isSyncing: needsSync && !timedOut,
    isTimedOut: needsSync && timedOut,
    isSynced,
  };
}
