"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCreatePayment } from "@/hooks/contracts/useCreatePayment";
import type { CreatePaymentParams } from "@/hooks/contracts/useCreatePayment";
import { useTokenApproval } from "@/hooks/contracts/useTokenApproval";
import { useFundPayment } from "@/hooks/contracts/useEscrowActions";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";
import { CELO_MAINNET_CHAIN_ID, getChainName } from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

// ---------------------------------------------------------------------------
// useProtectPaymentFlow — thin creation-orchestration state machine (P4.2b).
//
// Composes the EXISTING hooks (simulate-before-write, role checks,
// exact-amount approve and Celo attribution all live there — nothing is
// bypassed). Sequential only: createPayment → exact approve → fundPayment.
// No parallel-transaction architecture.
//
// - `chainId` defaults to DEFAULT_NEW_PAYMENT_CHAIN_ID (Celo Mainnet,
//   canonical constant — never a magic literal).
// - The created paymentId is kept in state so a retry of approve/fund
//   NEVER duplicates createPayment.
// - A step failure surfaces an honest error and never marks success.
// ---------------------------------------------------------------------------

export type ProtectPhase =
  | "idle"
  | "creating"
  | "approving"
  | "funding"
  | "done";

export interface ProtectPaymentInput extends CreatePaymentParams {
  /** Exact raw token amount (parsed against the chain token's decimals). */
  rawAmount: bigint;
}

export interface UseProtectPaymentFlowReturn {
  /** Explicit escrow chain this flow operates against. */
  chainId: number;
  /** Current orchestration phase. */
  phase: ProtectPhase;
  /** Payment ID from the create step (undefined until created). */
  createdPaymentId: bigint | undefined;
  /** Begin create → approve → fund. No-op unless idle. */
  start: (input: ProtectPaymentInput) => void;
  /** Retry the current failed step (never re-creates once created). */
  retry: () => void;
  /** Reset the flow and all underlying hook state. */
  reset: () => void;
  /** True while a wallet signature / confirmation is in flight. */
  isWorking: boolean;
  /** Phase-aware user-facing error (or null). */
  error: string | null;
  /** Honest human-readable progress label (or null when idle). */
  progressLabel: string | null;
  /** Transaction hashes per step (for explorer links). */
  createTxHash: `0x${string}` | undefined;
  approveTxHash: `0x${string}` | undefined;
  fundTxHash: `0x${string}` | undefined;
  /** Connected wallet's raw token balance on the flow chain (via useTokenApproval). */
  tokenBalance: bigint | undefined;
  /** True while the token balance read is in flight. */
  isLoadingTokenBalance: boolean;
}

/**
 * Display name for the escrow token on a chain: "USA₮" on Celo Mainnet,
 * legacy symbol (USDC) elsewhere. Single source so the wizard, the
 * progress labels and the preflight always agree.
 */
export function getProtectTokenDisplay(chainId: number): string {
  const token = getPaymentTokenConfig(chainId);
  return chainId === CELO_MAINNET_CHAIN_ID ? token.name : token.symbol;
}

/** Short network label: "Celo" on Mainnet, canonical name otherwise. */
export function getProtectNetworkDisplay(chainId: number): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) return "Celo";
  return getChainName(chainId);
}

export function useProtectPaymentFlow(
  chainId: number = DEFAULT_NEW_PAYMENT_CHAIN_ID,
): UseProtectPaymentFlowReturn {
  const create = useCreatePayment(chainId);
  const approval = useTokenApproval(chainId);
  const fund = useFundPayment(chainId);

  // `started` is the only local state: everything else (including the
  // phase) is DERIVED from the underlying hooks so effects never need to
  // setState synchronously — they only advance the external chain state
  // (request the next transaction) exactly once per step attempt.
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pendingRef = useRef<{
    params: CreatePaymentParams;
    rawAmount: bigint;
  } | null>(null);
  const firedApproveRef = useRef<string | null>(null);
  const firedFundRef = useRef<string | null>(null);

  const tokenDisplay = useMemo(
    () => getProtectTokenDisplay(chainId),
    [chainId],
  );

  // ---- Derived state (no setState-in-effect anywhere) ----
  //
  // Success without a parsable paymentId is definitive (paymentId derives
  // synchronously from the receipt): the flow stays in "creating" and
  // `error` explains — it never advances on a missing ID.
  const createdPaymentId =
    create.isSuccess && create.paymentId !== undefined
      ? create.paymentId
      : undefined;

  const phase: ProtectPhase = !started
    ? "idle"
    : fund.isSuccess && createdPaymentId !== undefined
      ? "done"
      : approval.isApproveSuccess && createdPaymentId !== undefined
        ? "funding"
        : createdPaymentId !== undefined
          ? "approving"
          : "creating";

  const start = useCallback(
    (input: ProtectPaymentInput) => {
      if (started) return;
      const { rawAmount, ...params } = input;
      pendingRef.current = { params, rawAmount };
      firedApproveRef.current = null;
      firedFundRef.current = null;
      setAttempt(0);
      setStarted(true);
      create.createPayment(params);
    },
    [started, create],
  );

  // ---- create → approve (exact amount, fired once per attempt) ----
  useEffect(() => {
    if (createdPaymentId === undefined) return;
    if (approval.isApproveSuccess || approval.isApproving) return;
    const pending = pendingRef.current;
    if (!pending) return;
    const key = `${createdPaymentId.toString()}:${attempt}`;
    if (firedApproveRef.current === key) return;
    firedApproveRef.current = key;
    approval.approve(pending.rawAmount);
  }, [createdPaymentId, attempt, approval]);

  // ---- approve → fund (fired once per attempt) ----
  useEffect(() => {
    if (createdPaymentId === undefined) return;
    if (!approval.isApproveSuccess) return;
    if (fund.isSuccess || fund.isPending) return;
    const key = `${createdPaymentId.toString()}:${attempt}`;
    if (firedFundRef.current === key) return;
    firedFundRef.current = key;
    fund.action(createdPaymentId);
  }, [createdPaymentId, attempt, approval.isApproveSuccess, fund]);

  const retry = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || !started) return;
    if (phase === "done" || phase === "idle") return;
    if (phase === "creating") {
      // Create never succeeded — safe to re-create directly.
      create.createPayment(pending.params);
      return;
    }
    // Approve/fund steps re-fire through the effects above: bumping the
    // attempt issues a fresh exactly-once key, so a retry NEVER re-creates
    // (create is only ever called from start/retry-creating) and never
    // re-approves when retrying fund (guarded by isApproveSuccess).
    setAttempt((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, phase]);

  const reset = useCallback(() => {
    pendingRef.current = null;
    firedApproveRef.current = null;
    firedFundRef.current = null;
    setAttempt(0);
    setStarted(false);
    create.reset();
    approval.resetApprove();
    fund.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missingIdError =
    phase === "creating" && create.isSuccess && create.paymentId === undefined
      ? "The agreement was created, but we could not read its payment ID. Check your wallet activity before trying again."
      : null;

  const error = useMemo(() => {
    if (phase === "creating") return missingIdError ?? create.error;
    if (phase === "approving") return approval.approveError;
    if (phase === "funding") return fund.error;
    return null;
  }, [
    phase,
    missingIdError,
    create.error,
    approval.approveError,
    fund.error,
  ]);

  const progressLabel = useMemo(() => {
    switch (phase) {
      case "creating":
        return "Creating your agreement…";
      case "approving":
        return `Approving ${tokenDisplay}…`;
      case "funding":
        return "Protecting funds…";
      case "done":
        return "Payment protected";
      default:
        return null;
    }
  }, [phase, tokenDisplay]);

  return {
    chainId,
    phase,
    createdPaymentId,
    start,
    retry,
    reset,
    isWorking: create.isPending || approval.isApproving || fund.isPending,
    error,
    progressLabel,
    createTxHash: create.txHash,
    approveTxHash: approval.approveTxHash,
    fundTxHash: fund.txHash,
    tokenBalance: approval.balance,
    isLoadingTokenBalance: approval.isLoadingBalance,
  };
}
