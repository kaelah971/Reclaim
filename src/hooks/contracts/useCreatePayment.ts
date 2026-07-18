"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEventLogs } from "viem";
import { getEscrowContractConfig, getEscrowChainId } from "@/lib/contracts/config";
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
 */
export function useCreatePayment(): UseCreatePaymentReturn {
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
      if (chainId !== getEscrowChainId()) {
        setLocalError("Switch to Celo Sepolia to create a payment.");
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

      publicClient
        .simulateContract({
          ...contract,
          functionName: "createPayment",
          args,
          account,
        })
        .then(() => {
          writeContract(
            {
              ...contract,
              functionName: "createPayment",
              args,
              dataSuffix: getAttributionDataSuffix(),
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
      chainId,
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
