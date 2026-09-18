"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import {
  getEscrowContractConfig,
  type EscrowChainReference,
} from "@/lib/contracts/config";
import { celoChain } from "@/lib/web3/chains";
import {
  parsePaymentData,
  type PaymentData,
  type RawPaymentStruct,
} from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// P4.1a — explicit chain plumbing.
//
// Every read accepts an explicit supported chain (Chain object or numeric
// chainId) and threads it into getEscrowContractConfig so the wagmi read
// targets address+abi+chainId explicitly. The default (`celoChain` = Sepolia
// alias) preserves backward-compatible behavior for callers that have not
// been migrated; migrated callers (production / new-payment) must pass
// 42220 explicitly. Unsupported chains fail closed via
// getEscrowContractConfig's "not deployed on chain X" throw — there is no
// hidden Mainnet→Sepolia fallback.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// usePaymentCount
// ---------------------------------------------------------------------------

export interface UsePaymentCountReturn {
  data: bigint | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function usePaymentCount(
  chain: EscrowChainReference = celoChain,
): UsePaymentCountReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "paymentCount",
  });

  return { data, isLoading, isError, error, refetch };
}

// ---------------------------------------------------------------------------
// usePayment
// ---------------------------------------------------------------------------

export interface UsePaymentReturn {
  data: PaymentData | null;
  isLoading: boolean;
  isError: boolean;
  /** True when the contract reports the payment does not exist. */
  notFound: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch a single payment by its ID via `getPayment`.
 *
 * The contract reverts with `PaymentNotFound` for unknown IDs; that revert
 * is surfaced as `notFound: true` with `data: null` (not as a generic error).
 */
export function usePayment(
  paymentId: bigint | undefined,
  chain: EscrowChainReference = celoChain,
): UsePaymentReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "getPayment",
    args: paymentId !== undefined ? [paymentId] : undefined,
    query: {
      enabled: paymentId !== undefined,
      retry: (failureCount, err) =>
        !isPaymentNotFoundError(err) && failureCount < 2,
    },
  });

  const notFound =
    paymentId === undefined || (isError && isPaymentNotFoundError(error));

  const parsed = useMemo<PaymentData | null>(() => {
    if (!data) return null;
    return parsePaymentData(data as RawPaymentStruct);
  }, [data]);

  return {
    data: parsed,
    isLoading,
    isError: isError && !notFound,
    notFound,
    error,
    refetch,
  };
}

function isPaymentNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { message?: string; shortMessage?: string };
  const text = `${err.shortMessage ?? ""} ${err.message ?? ""}`;
  return text.includes("PaymentNotFound");
}

// ---------------------------------------------------------------------------
// useClientPaymentIds
// ---------------------------------------------------------------------------

export interface UsePaymentIdsReturn {
  data: readonly bigint[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch all payment IDs for a given client address.
 */
export function useClientPaymentIds(
  address: string | undefined,
  chain: EscrowChainReference = celoChain,
): UsePaymentIdsReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "getClientPaymentIds",
    args: address !== undefined ? [address as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  return { data, isLoading, isError, error, refetch };
}

// ---------------------------------------------------------------------------
// useWorkerPaymentIds
// ---------------------------------------------------------------------------

/**
 * Fetch all payment IDs for a given worker address.
 */
export function useWorkerPaymentIds(
  address: string | undefined,
  chain: EscrowChainReference = celoChain,
): UsePaymentIdsReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "getWorkerPaymentIds",
    args: address !== undefined ? [address as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  return { data, isLoading, isError, error, refetch };
}

// ---------------------------------------------------------------------------
// useIsPaused
// ---------------------------------------------------------------------------

export interface UseIsPausedReturn {
  data: boolean | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Check whether the escrow contract is currently paused.
 */
export function useIsPaused(
  chain: EscrowChainReference = celoChain,
): UseIsPausedReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "paused",
  });

  return { data, isLoading, isError, error, refetch };
}

// ---------------------------------------------------------------------------
// useEscrowToken
// ---------------------------------------------------------------------------

export interface UseEscrowTokenReturn {
  data: `0x${string}` | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Read the ERC-20 token address the escrow contract accepts.
 */
export function useEscrowToken(
  chain: EscrowChainReference = celoChain,
): UseEscrowTokenReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(chain),
    functionName: "escrowToken",
  });

  return { data, isLoading, isError, error, refetch };
}
