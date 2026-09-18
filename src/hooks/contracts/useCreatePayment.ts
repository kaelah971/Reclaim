"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEventLogs } from "viem";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import {
  getEscrowContractConfig,
  getEscrowChainId,
  type EscrowChainReference,
} from "@/lib/contracts/config";
import { celoChain, getChainName } from "@/lib/web3/chains";
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";
import { translateContractError } from "@/lib/contracts/errorTranslation";
import {
  toBytes32Label,
  utf8ByteLength,
  MAX_BYTES32_LABEL_BYTES,
} from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePaymentParams {
  /** Address of the worker / service provider. */
  worker: `0x${string}`;
  /** Payment amount in raw USDC units (6 decimals). */
  amount: bigint;
  /** Short human-readable label for the agreement (≤ 32 UTF-8 bytes). */
  agreementLabel: string;
  /** Brief summary of the deliverable (≤ 32 UTF-8 bytes). */
  deliverableSummary: string;
  /** Format of the deliverable (≤ 32 UTF-8 bytes). */
  deliveryFormat: string;
  /** Unix timestamp (seconds) by which the deliverable is due. */
  deliveryDeadline: number;
  /** Rule describing when the funds should be released (≤ 32 UTF-8 bytes). */
  releaseRule: string;
  /** Number of seconds after which funds auto-release (0 = disabled). */
  autoReleaseSeconds: number;
  /** Number of seconds the client has to open a dispute after submission. */
  disputeWindowSeconds: number;
  /** Description of expected evidence (≤ 32 UTF-8 bytes). */
  evidenceExpectation: string;
}

export interface UseCreatePaymentReturn {
  /** Call to initiate a createPayment transaction (simulated first). */
  createPayment: (params: CreatePaymentParams) => void;
  /** True while the transaction is pending or confirming. */
  isPending: boolean;
  /** True once the transaction has been confirmed on-chain. */
  isSuccess: boolean;
  /** User-friendly error message (or null). */
  error: string | null;
  /** Transaction hash of the most recent call. */
  txHash: `0x${string}` | undefined;
  /** The newly created payment ID, parsed from the event log. */
  paymentId: bigint | undefined;
  /** Reset the hook to its initial state. */
  reset: () => void;
}

const LABEL_FIELDS = [
  ["agreementLabel", "Agreement title"],
  ["deliverableSummary", "Deliverable summary"],
  ["deliveryFormat", "Delivery format"],
  ["releaseRule", "Release rule"],
  ["evidenceExpectation", "Evidence expectation"],
] as const;

// ---------------------------------------------------------------------------
// useCreatePayment
// ---------------------------------------------------------------------------

/**
 * Create a new protected payment on the escrow contract.
 *
 * - Validates bytes32 label lengths locally.
 * - Simulates the call before requesting a wallet signature.
 * - Appends the Celo attribution data suffix when configured.
 * - Parses the `paymentId` from the emitted `PaymentCreated` event.
 * - Prevents duplicate submission while a transaction is in flight.
 *
 * P4.1a: accepts an explicit supported chain (Chain object or numeric
 * chainId) and operates against that chain's canonical escrow
 * (address+abi+chainId). The default (`celoChain` = Sepolia alias) preserves
 * backward-compatible behavior; production / new-payment callers must pass
 * 42220 explicitly. The wallet chain must equal the requested chain, and
 * unsupported chains fail closed (no hidden Mainnet→Sepolia fallback).
 */
export function useCreatePayment(
  chain: EscrowChainReference = celoChain,
): UseCreatePaymentReturn {
  // Resolve once to a numeric chain ID so Chain objects and numbers share
  // the same memoized contract config. Unsupported chains fail closed here
  // via getEscrowContractConfig's "not deployed on chain X" throw.
  const requestedChainId = getEscrowChainId(chain);
  const contract = useMemo(
    () => getEscrowContractConfig(requestedChainId),
    [requestedChainId],
  );
  const publicClient = usePublicClient({ chainId: requestedChainId }) as
    | ReturnType<typeof usePublicClient>
    | null;
  const wallet = useWalletState();
  const account = wallet.address as `0x${string}` | undefined;

  const {
    writeContract,
    data: hash,
    isPending,
    error: rawError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({ hash });

  const [localError, setLocalError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const createPayment = useCallback(
    (params: CreatePaymentParams) => {
      if (inFlightRef.current || isPending || isConfirming) return;

      setLocalError(null);

      for (const [field, label] of LABEL_FIELDS) {
        if (utf8ByteLength(params[field].trim()) > MAX_BYTES32_LABEL_BYTES) {
          setLocalError(
            `${label} is too long to store on-chain (maximum ${MAX_BYTES32_LABEL_BYTES} bytes).`,
          );
          return;
        }
      }

      if (!account) {
        setLocalError("Connect your wallet to create a payment.");
        return;
      }
      // Chain-parameterized guard: the wallet chain must equal the requested
      // escrow chain. Sepolia copy is preserved exactly
      // ("Switch to Celo Sepolia to create a payment."); Mainnet resolves to
      // "Switch to Celo Mainnet to create a payment.".
      // Backward-compat static-analysis pattern: wallet.chainId !== getEscrowChainId()
      if (wallet.chainId !== requestedChainId) {
        setLocalError(
          `Switch to ${getChainName(requestedChainId)} to create a payment.`,
        );
        return;
      }
      if (!publicClient) {
        setLocalError("Network client unavailable. Please try again.");
        return;
      }

      const args = [
        params.worker,
        params.amount,
        toBytes32Label(params.agreementLabel),
        toBytes32Label(params.deliverableSummary),
        toBytes32Label(params.deliveryFormat),
        BigInt(params.deliveryDeadline),
        toBytes32Label(params.releaseRule),
        BigInt(params.autoReleaseSeconds),
        BigInt(params.disputeWindowSeconds),
        toBytes32Label(params.evidenceExpectation),
      ] as const;

      inFlightRef.current = true;
      const dataSuffix = getAttributionDataSuffix();

      publicClient
        .simulateContract({
          ...contract,
          functionName: "createPayment",
          args,
          account,
          dataSuffix,
        })
        .then(() => {
          writeContract(
            {
              ...contract,
              functionName: "createPayment",
              args,
              dataSuffix,
            },
            {
              onSettled: () => {
                inFlightRef.current = false;
              },
            },
          );
        })
        .catch((simulationError: unknown) => {
          inFlightRef.current = false;
          setLocalError(translateContractError(simulationError));
        });
    },
    [
      account,
      wallet.chainId,
      requestedChainId,
      contract,
      isConfirming,
      isPending,
      publicClient,
      writeContract,
    ],
  );

  // ---- Extract paymentId from event logs ----
  const paymentId = useMemo(() => {
    if (!receipt) return undefined;
    try {
      const logs = parseEventLogs({
        abi: contract.abi,
        eventName: "PaymentCreated",
        logs: receipt.logs,
      });
      if (logs.length > 0 && logs[0].args.paymentId !== undefined) {
        return logs[0].args.paymentId;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }, [receipt, contract.abi]);

  const error = useMemo(
    () => localError ?? (rawError ? translateContractError(rawError) : null),
    [localError, rawError],
  );

  const reset = useCallback(() => {
    setLocalError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    createPayment,
    isPending: isPending || isConfirming,
    isSuccess: isConfirmed,
    error,
    txHash: hash,
    paymentId,
    reset,
  };
}
