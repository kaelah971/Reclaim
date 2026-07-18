"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { erc20Abi } from "viem";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { getEscrowContractAddress, getEscrowChainId } from "@/lib/contracts/config";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import { translateContractError } from "@/lib/contracts/errorTranslation";

// ---------------------------------------------------------------------------
// useTokenApproval
// ---------------------------------------------------------------------------

export interface UseTokenApprovalReturn {
  /** Current USDC allowance the escrow contract has for the connected wallet. */
  allowance: bigint | undefined;
  /** True while the allowance read is in flight. */
  isLoadingAllowance: boolean;
  /** Connected wallet's raw USDC balance (6 decimals). */
  balance: bigint | undefined;
  /** True while the balance read is in flight. */
  isLoadingBalance: boolean;
  /** Call to request an approve transaction for the given exact amount. */
  approve: (amount: bigint) => void;
  /** True while the approve transaction is pending. */
  isApproving: boolean;
  /** True after the approve transaction has been confirmed on-chain. */
  isApproveSuccess: boolean;
  /** User-friendly error message (or null). */
  approveError: string | null;
  /** Transaction hash of the most recent approve call. */
  approveTxHash: `0x${string}` | undefined;
  /** Manually refetch the allowance. */
  refetchAllowance: () => void;
  /** Manually refetch the balance. */
  refetchBalance: () => void;
  /** Clear approval errors. */
  resetApprove: () => void;
}

/**
 * Manage USDC token approval for the ProtectedPaymentEscrow contract.
 *
 * Reads the wallet's real USDC allowance and balance, and exposes an
 * `approve` function that requests approval for the exact amount only
 * (never unlimited). The approve call is simulated before the wallet
 * signature is requested and duplicate submissions are prevented.
 */
export function useTokenApproval(): UseTokenApprovalReturn {
  const wallet = useWalletState();
  const token = getPaymentTokenConfig();
  const escrowAddress = getEscrowContractAddress();
  const publicClient = usePublicClient();
  const { chainId } = useAccount();

  // ---- Allowance read ----
  const {
    data: allowance,
    isLoading: isLoadingAllowance,
    refetch: refetchAllowance,
  } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      wallet.address !== undefined
        ? [wallet.address as `0x${string}`, escrowAddress]
        : undefined,
    query: {
      enabled: Boolean(wallet.address),
    },
  });

  // ---- Balance read ----
  const {
    data: balance,
    isLoading: isLoadingBalance,
    refetch: refetchBalance,
  } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args:
      wallet.address !== undefined
        ? [wallet.address as `0x${string}`]
        : undefined,
    query: {
      enabled: Boolean(wallet.address),
    },
  });

  // ---- Approve write ----
  const {
    writeContract,
    data: hash,
    isPending: isApproving,
    error: rawError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  const [localError, setLocalError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const approve = useCallback(
    (amount: bigint) => {
      if (inFlightRef.current || isApproving || isConfirming) return;

      setLocalError(null);

      const account = wallet.address as `0x${string}` | undefined;
      if (!account) {
        setLocalError("Connect your wallet to approve USDC.");
        return;
      }
      if (chainId !== getEscrowChainId()) {
        setLocalError("Switch to Celo Sepolia to approve USDC.");
        return;
      }
      if (!publicClient) {
        setLocalError("Network client unavailable. Please try again.");
        return;
      }

      inFlightRef.current = true;

      publicClient
        .simulateContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [escrowAddress, amount],
          account,
        })
        .then(() => {
          writeContract(
            {
              address: token.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [escrowAddress, amount],
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
      chainId,
      escrowAddress,
      isApproving,
      isConfirming,
      publicClient,
      token.address,
      wallet.address,
      writeContract,
    ],
  );

  const approveError = useMemo(
    () => localError ?? (rawError ? translateContractError(rawError) : null),
    [localError, rawError],
  );

  const resetApprove = useCallback(() => {
    setLocalError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    allowance,
    isLoadingAllowance,
    balance,
    isLoadingBalance,
    approve,
    isApproving: isApproving || isConfirming,
    isApproveSuccess: isConfirmed,
    approveError,
    approveTxHash: hash,
    refetchAllowance,
    refetchBalance,
    resetApprove,
  };
}
