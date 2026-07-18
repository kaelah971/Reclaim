"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { getEscrowContractConfig, getEscrowChainId } from "@/lib/contracts/config";
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";
import { translateContractError } from "@/lib/contracts/errorTranslation";

// ---------------------------------------------------------------------------
// Shared return type for all action hooks
// ---------------------------------------------------------------------------

export interface EscrowActionReturn<TAction extends (...args: never[]) => void> {
  /** The write function to call with the appropriate parameters. */
  action: TAction;
  /** True while the transaction is pending or confirming. */
  isPending: boolean;
  /** True once the transaction has been confirmed on-chain. */
  isSuccess: boolean;
  /** User-friendly error message (or null). */
  error: string | null;
  /** Transaction hash of the most recent call. */
  txHash: `0x${string}` | undefined;
  /** Reset the hook to its initial state. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Internal shared machinery
//
// Every escrow write follows the same lifecycle:
//   local gates (wallet / network) → simulation → wallet signature →
//   submitted → confirmed, with duplicate-submission prevention and the
//   Celo attribution data suffix appended when configured.
// ---------------------------------------------------------------------------

type SimpleEscrowFunction =
  | "fundPayment"
  | "acceptPayment"
  | "requestRelease"
  | "approveRelease"
  | "cancelUnfunded";

type ReferenceEscrowFunction = "submitEvidenceHash" | "openDispute";

interface EscrowWriteCore {
  executeSimple: (
    functionName: SimpleEscrowFunction,
    paymentId: bigint,
  ) => void;
  executeReference: (
    functionName: ReferenceEscrowFunction,
    paymentId: bigint,
    reference: `0x${string}`,
  ) => void;
  isPending: boolean;
  isSuccess: boolean;
  error: string | null;
  txHash: `0x${string}` | undefined;
  reset: () => void;
}

function useEscrowWriteCore(): EscrowWriteCore {
  const contract = getEscrowContractConfig();
  const publicClient = usePublicClient();
  const { address: account, chainId } = useAccount();

  const {
    writeContract,
    data: hash,
    isPending,
    error: rawError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  const [localError, setLocalError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  /** Shared gates; returns the account when the write may proceed. */
  const passesGates = useCallback((): `0x${string}` | undefined => {
    if (inFlightRef.current || isPending || isConfirming) return undefined;

    setLocalError(null);

    if (!account) {
      setLocalError("Connect your wallet to continue.");
      return undefined;
    }
    if (chainId !== getEscrowChainId()) {
      setLocalError("Switch to Celo Sepolia to continue.");
      return undefined;
    }
    if (!publicClient) {
      setLocalError("Network client unavailable. Please try again.");
      return undefined;
    }
    return account;
  }, [account, chainId, isConfirming, isPending, publicClient]);

  const handleSimulationFailure = useCallback((simulationError: unknown) => {
    inFlightRef.current = false;
    setLocalError(translateContractError(simulationError));
  }, []);

  const executeSimple = useCallback(
    (functionName: SimpleEscrowFunction, paymentId: bigint) => {
      const gatedAccount = passesGates();
      if (!gatedAccount || !publicClient) return;

      inFlightRef.current = true;

      publicClient
        .simulateContract({
          ...contract,
          functionName,
          args: [paymentId] as const,
          account: gatedAccount,
        })
        .then(() => {
          writeContract(
            {
              ...contract,
              functionName,
              args: [paymentId] as const,
              dataSuffix: getAttributionDataSuffix(),
            },
            {
              onSettled: () => {
                inFlightRef.current = false;
              },
            },
          );
        })
        .catch(handleSimulationFailure);
    },
    [contract, handleSimulationFailure, passesGates, publicClient, writeContract],
  );

  const executeReference = useCallback(
    (
      functionName: ReferenceEscrowFunction,
      paymentId: bigint,
      reference: `0x${string}`,
    ) => {
      const gatedAccount = passesGates();
      if (!gatedAccount || !publicClient) return;

      inFlightRef.current = true;

      publicClient
        .simulateContract({
          ...contract,
          functionName,
          args: [paymentId, reference] as const,
          account: gatedAccount,
        })
        .then(() => {
          writeContract(
            {
              ...contract,
              functionName,
              args: [paymentId, reference] as const,
              dataSuffix: getAttributionDataSuffix(),
            },
            {
              onSettled: () => {
                inFlightRef.current = false;
              },
            },
          );
        })
        .catch(handleSimulationFailure);
    },
    [contract, handleSimulationFailure, passesGates, publicClient, writeContract],
  );

  const error = useMemo(
    () => localError ?? (rawError ? translateContractError(rawError) : null),
    [localError, rawError],
  );

  const reset = useCallback(() => {
    setLocalError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    executeSimple,
    executeReference,
    isPending: isPending || isConfirming,
    isSuccess: isConfirmed,
    error,
    txHash: hash,
    reset,
  };
}

function useSimpleEscrowAction(
  functionName: SimpleEscrowFunction,
): EscrowActionReturn<(paymentId: bigint) => void> {
  const core = useEscrowWriteCore();

  const action = useCallback(
    (paymentId: bigint) => {
      core.executeSimple(functionName, paymentId);
    },
    [core, functionName],
  );

  return {
    action,
    isPending: core.isPending,
    isSuccess: core.isSuccess,
    error: core.error,
    txHash: core.txHash,
    reset: core.reset,
  };
}

function useReferenceEscrowAction(
  functionName: ReferenceEscrowFunction,
): EscrowActionReturn<(paymentId: bigint, reference: `0x${string}`) => void> {
  const core = useEscrowWriteCore();

  const action = useCallback(
    (paymentId: bigint, reference: `0x${string}`) => {
      core.executeReference(functionName, paymentId, reference);
    },
    [core, functionName],
  );

  return {
    action,
    isPending: core.isPending,
    isSuccess: core.isSuccess,
    error: core.error,
    txHash: core.txHash,
    reset: core.reset,
  };
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Fund a created payment by transferring USDC into the escrow contract.
 * Must be called by the client (requires prior exact USDC approval).
 */
export function useFundPayment(): EscrowActionReturn<
  (paymentId: bigint) => void
> {
  return useSimpleEscrowAction("fundPayment");
}

/**
 * Accept a funded payment.  Must be called by the worker.
 */
export function useAcceptPayment(): EscrowActionReturn<
  (paymentId: bigint) => void
> {
  return useSimpleEscrowAction("acceptPayment");
}

/**
 * Submit a bytes32 evidence reference for an accepted payment.
 * Must be called by the worker. The reference is typically the keccak256
 * hash of an evidence manifest kept off-chain.
 */
export function useSubmitEvidenceHash(): EscrowActionReturn<
  (paymentId: bigint, evidenceReference: `0x${string}`) => void
> {
  return useReferenceEscrowAction("submitEvidenceHash");
}

/**
 * Request release of funds after evidence submission.
 * Must be called by the worker. Does not transfer funds.
 */
export function useRequestRelease(): EscrowActionReturn<
  (paymentId: bigint) => void
> {
  return useSimpleEscrowAction("requestRelease");
}

/**
 * Approve release and transfer the protected funds to the worker.
 * Must be called by the client.
 */
export function useApproveRelease(): EscrowActionReturn<
  (paymentId: bigint) => void
> {
  return useSimpleEscrowAction("approveRelease");
}

/**
 * Open a dispute with a bytes32 dispute reference, freezing the payment.
 * Called by either the client or the worker.
 */
export function useOpenDispute(): EscrowActionReturn<
  (paymentId: bigint, disputeReference: `0x${string}`) => void
> {
  return useReferenceEscrowAction("openDispute");
}

/**
 * Cancel an unfunded payment.  Must be called by the client while the
 * payment is still in the Created state.
 */
export function useCancelUnfunded(): EscrowActionReturn<
  (paymentId: bigint) => void
> {
  return useSimpleEscrowAction("cancelUnfunded");
}
