"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  getEscrowContractConfig,
  getEscrowChainId,
  type EscrowChainReference,
} from "@/lib/contracts/config";
import { celoChain, getChainName } from "@/lib/web3/chains";
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";
import { translateContractError } from "@/lib/contracts/errorTranslation";

// ---------------------------------------------------------------------------
// Chain-safety error messages
//
// P4.1a: every escrow write operates against an EXPLICIT supported chain.
// The default (`celoChain` = Sepolia alias) preserves backward-compatible
// behavior; production / new-payment callers must pass 42220 explicitly.
// The wallet's LIVE chain must equal the requested chain, and unsupported
// chains fail closed (no hidden Mainnet→Sepolia fallback).
// ---------------------------------------------------------------------------

/** Shown while wagmi is still reconciling the persisted (hydrated) connection. */
export const ESCROW_RECONNECTING_ERROR =
  "Wallet reconnecting. Try again in a moment.";

/** Shown when the wallet's LIVE chain does not match the escrow deployment chain. */
export const ESCROW_SWITCH_CHAIN_ERROR =
  "Switch to Celo Sepolia to continue.";

/**
 * Chain-parameterized switch-chain error for an explicit escrow chain.
 * Sepolia resolves to ESCROW_SWITCH_CHAIN_ERROR exactly; Mainnet resolves to
 * "Switch to Celo Mainnet to continue.".
 */
export function getEscrowSwitchChainError(
  chain: EscrowChainReference = celoChain,
): string {
  const chainId = getEscrowChainId(chain);
  return `Switch to ${getChainName(chainId)} to continue.`;
}

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
//   local gates (wallet / reconnecting) → live connector chain check →
//   simulation → wallet signature → submitted → confirmed, with
//   duplicate-submission prevention and the Celo attribution data suffix
//   appended when configured.
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

function useEscrowWriteCore(
  chain: EscrowChainReference = celoChain,
): EscrowWriteCore {
  // Explicit chain: numeric resolution keeps Chain objects and numbers
  // aligned. Unsupported chains fail closed via getEscrowContractConfig.
  const requestedChainId = getEscrowChainId(chain);
  const contract = useMemo(
    () => getEscrowContractConfig(requestedChainId),
    [requestedChainId],
  );
  const switchChainError = useMemo(
    () => getEscrowSwitchChainError(requestedChainId),
    [requestedChainId],
  );
  const publicClient = usePublicClient({ chainId: requestedChainId }) as
    | ReturnType<typeof usePublicClient>
    | null;
  const { address: account, chainId, connector, isReconnecting } = useAccount();

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

  /**
   * Reconcile stale chain errors with the LIVE connector chain. Once the
   * wallet is confirmed to be on the requested escrow chain, a previous
   * switch-chain error is stale and must not remain rendered.
   * Re-runs whenever the wagmi connection chainId changes (e.g. the user
   * switches networks in the wallet).
   */
  useEffect(() => {
    if (!connector || !account) return;
    let cancelled = false;
    connector
      .getChainId()
      .then((liveChainId) => {
        if (cancelled) return;
        if (liveChainId === requestedChainId) {
          setLocalError((prev) =>
            prev === switchChainError || prev === ESCROW_SWITCH_CHAIN_ERROR
              ? null
              : prev,
          );
        }
      })
      .catch(() => {
        // Unable to validate the live chain — leave any error in place.
      });
    return () => {
      cancelled = true;
    };
  }, [connector, account, chainId, requestedChainId, switchChainError]);

  /** Shared gates; returns the account when the write may proceed. */
  const passesGates = useCallback((): `0x${string}` | undefined => {
    if (inFlightRef.current || isPending || isConfirming) return undefined;

    setLocalError(null);

    if (!account) {
      setLocalError("Connect your wallet to continue.");
      return undefined;
    }
    if (isReconnecting) {
      setLocalError(ESCROW_RECONNECTING_ERROR);
      return undefined;
    }
    if (!publicClient) {
      setLocalError("Network client unavailable. Please try again.");
      return undefined;
    }
    return account;
  }, [account, isConfirming, isPending, isReconnecting, publicClient]);

  /**
   * Resolve the LIVE chain from the connected connector (reads eth_chainId
   * from the wallet provider). The hydrated/store chainId is never trusted
   * on its own — it can be stale (e.g. persisted from a previous mainnet
   * session). Escrow writes proceed only when the live chain matches the
   * REQUESTED escrow chain (chain-parameterized; Sepolia semantics preserved
   * when the requested chain is Sepolia).
   */
  const assertLiveEscrowChain = useCallback(async (): Promise<boolean> => {
    if (!connector) {
      setLocalError("Network client unavailable. Please try again.");
      return false;
    }
    try {
      const liveChainId = await connector.getChainId();
      if (liveChainId !== requestedChainId) {
        setLocalError(switchChainError);
        return false;
      }
      // Live chain confirmed — clear any stale chain error from a previous
      // attempt so it is never presented as current truth.
      setLocalError((prev) =>
        prev === switchChainError || prev === ESCROW_SWITCH_CHAIN_ERROR
          ? null
          : prev,
      );
      return true;
    } catch {
      setLocalError("Network client unavailable. Please try again.");
      return false;
    }
  }, [connector, requestedChainId, switchChainError]);

  const handleSimulationFailure = useCallback((simulationError: unknown) => {
    inFlightRef.current = false;
    setLocalError(translateContractError(simulationError));
  }, []);

  const executeSimple = useCallback(
    (functionName: SimpleEscrowFunction, paymentId: bigint) => {
      // A new attempt clears old transient errors before fresh validation.
      setLocalError(null);

      const gatedAccount = passesGates();
      if (!gatedAccount || !publicClient) return;

      inFlightRef.current = true;
      const dataSuffix = getAttributionDataSuffix();

      assertLiveEscrowChain()
        .then((onLiveChain) => {
          if (!onLiveChain) {
            inFlightRef.current = false;
            return;
          }
          return publicClient
            .simulateContract({
              ...contract,
              functionName,
              args: [paymentId] as const,
              account: gatedAccount,
              dataSuffix,
            })
            .then(() => {
              writeContract(
                {
                  ...contract,
                  functionName,
                  args: [paymentId] as const,
                  dataSuffix,
                },
                {
                  onSettled: () => {
                    inFlightRef.current = false;
                  },
                },
              );
            })
            .catch(handleSimulationFailure);
        })
        .catch(() => {
          inFlightRef.current = false;
        });
    },
    [
      assertLiveEscrowChain,
      contract,
      handleSimulationFailure,
      passesGates,
      publicClient,
      writeContract,
    ],
  );

  const executeReference = useCallback(
    (
      functionName: ReferenceEscrowFunction,
      paymentId: bigint,
      reference: `0x${string}`,
    ) => {
      // A new attempt clears old transient errors before fresh validation.
      setLocalError(null);

      const gatedAccount = passesGates();
      if (!gatedAccount || !publicClient) return;

      inFlightRef.current = true;
      const dataSuffix = getAttributionDataSuffix();

      assertLiveEscrowChain()
        .then((onLiveChain) => {
          if (!onLiveChain) {
            inFlightRef.current = false;
            return;
          }
          return publicClient
            .simulateContract({
              ...contract,
              functionName,
              args: [paymentId, reference] as const,
              account: gatedAccount,
              dataSuffix,
            })
            .then(() => {
              writeContract(
                {
                  ...contract,
                  functionName,
                  args: [paymentId, reference] as const,
                  dataSuffix,
                },
                {
                  onSettled: () => {
                    inFlightRef.current = false;
                  },
                },
              );
            })
            .catch(handleSimulationFailure);
        })
        .catch(() => {
          inFlightRef.current = false;
        });
    },
    [
      assertLiveEscrowChain,
      contract,
      handleSimulationFailure,
      passesGates,
      publicClient,
      writeContract,
    ],
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
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  const core = useEscrowWriteCore(chain);

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
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint, reference: `0x${string}`) => void> {
  const core = useEscrowWriteCore(chain);

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
 * Fund a created payment by transferring the escrow token into the escrow
 * contract (USDC on Sepolia, USA₮ on Mainnet).
 * Must be called by the client (requires prior exact approval).
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useFundPayment(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  return useSimpleEscrowAction("fundPayment", chain);
}

/**
 * Accept a funded payment.  Must be called by the worker.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useAcceptPayment(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  return useSimpleEscrowAction("acceptPayment", chain);
}

/**
 * Submit a bytes32 evidence reference for an accepted payment.
 * Must be called by the worker. The reference is typically the keccak256
 * hash of an evidence manifest kept off-chain.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useSubmitEvidenceHash(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<
  (paymentId: bigint, evidenceReference: `0x${string}`) => void
> {
  return useReferenceEscrowAction("submitEvidenceHash", chain);
}

/**
 * Request release of funds after evidence submission.
 * Must be called by the worker. Does not transfer funds.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useRequestRelease(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  return useSimpleEscrowAction("requestRelease", chain);
}

/**
 * Approve release and transfer the protected funds to the worker.
 * Must be called by the client.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useApproveRelease(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  return useSimpleEscrowAction("approveRelease", chain);
}

/**
 * Open a dispute with a bytes32 dispute reference, freezing the payment.
 * Called by either the client or the worker.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useOpenDispute(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<
  (paymentId: bigint, disputeReference: `0x${string}`) => void
> {
  return useReferenceEscrowAction("openDispute", chain);
}

/**
 * Cancel an unfunded payment.  Must be called by the client while the
 * payment is still in the Created state.
 * P4.1a: pass an explicit chain (default Sepolia for backward compat).
 */
export function useCancelUnfunded(
  chain: EscrowChainReference = celoChain,
): EscrowActionReturn<(paymentId: bigint) => void> {
  return useSimpleEscrowAction("cancelUnfunded", chain);
}
