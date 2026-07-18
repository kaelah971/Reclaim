"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { getEscrowContractConfig } from "@/lib/contracts/config";
import {
  parsePaymentData,
  type PaymentData,
  type RawPaymentStruct,
} from "@/lib/contracts/types";

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

export function usePaymentCount(): UsePaymentCountReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
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
export function usePayment(paymentId: bigint | undefined): UsePaymentReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
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
): UsePaymentIdsReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
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
): UsePaymentIdsReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
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
export function useIsPaused(): UseIsPausedReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
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
export function useEscrowToken(): UseEscrowTokenReturn {
  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...getEscrowContractConfig(),
    functionName: "escrowToken",
  });

  return { data, isLoading, isError, error, refetch };
}
