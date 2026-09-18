"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  usePublicClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { erc20Abi } from "viem";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import {
  getEscrowContractAddress,
  getEscrowChainId,
  type EscrowChainReference,
} from "@/lib/contracts/config";
import { celoChain, getChainName } from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import { translateContractError } from "@/lib/contracts/errorTranslation";
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";

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
 * Manage escrow token approval for the ProtectedPaymentEscrow contract.
 *
 * Reads the wallet's real allowance and balance for the requested chain's
 * canonical escrow token (USDC on Sepolia, USA₮/USAT on Mainnet), and exposes
 * an `approve` function that requests approval for the exact amount only
 * (never unlimited). The approve call is simulated before the wallet
 * signature is requested and duplicate submissions are prevented.
 *
 * P4.1a: accepts an explicit supported chain (Chain object or numeric
 * chainId). The default (`celoChain` = Sepolia alias) preserves
 * backward-compatible behavior; production / new-payment callers must pass
 * 42220 explicitly. The wallet chain must equal the requested chain, and
 * unsupported chains fail closed (no hidden Mainnet→Sepolia fallback).
 * Attribution via `dataSuffix` remains on the approve write path.
 */
export function useTokenApproval(
  chain: EscrowChainReference = celoChain,
): UseTokenApprovalReturn {
  const wallet = useWalletState();
  // Resolve once to numeric so Chain objects and numbers share behavior.
  // Unsupported chains fail closed via getEscrow* "not deployed" throws.
  const requestedChainId = getEscrowChainId(chain);
  const token = getPaymentTokenConfig(requestedChainId);
  const escrowAddress = getEscrowContractAddress(requestedChainId);
  const publicClient = usePublicClient({ chainId: requestedChainId }) as
    | ReturnType<typeof usePublicClient>
    | null;

  // ---- Allowance read (explicit chain target) ----
  const {
    data: allowance,
    isLoading: isLoadingAllowance,
    refetch: refetchAllowance,
  } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    chainId: requestedChainId,
    functionName: "allowance",
    args:
      wallet.address !== undefined
        ? [wallet.address as `0x${string}`, escrowAddress]
        : undefined,
    query: {
      enabled: Boolean(wallet.address),
    },
  });

  // ---- Balance read (explicit chain target) ----
  const {
    data: balance,
    isLoading: isLoadingBalance,
    refetch: refetchBalance,
  } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    chainId: requestedChainId,
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
        setLocalError(`Connect your wallet to approve ${token.symbol}.`);
        return;
      }
      // Chain-parameterized guard: wallet chain must equal requested chain.
      // Sepolia copy preserved exactly ("Switch to Celo Sepolia to approve
      // USDC."); Mainnet resolves to "Switch to Celo Mainnet to approve USAT.".
      // Backward-compat static-analysis pattern: wallet.chainId !== getEscrowChainId()
      if (wallet.chainId !== requestedChainId) {
        setLocalError(
          `Switch to ${getChainName(requestedChainId)} to approve ${token.symbol}.`,
        );
        return;
      }
      if (!publicClient) {
        setLocalError("Network client unavailable. Please try again.");
        return;
      }

      inFlightRef.current = true;
      // Capture once so simulation and the submitted transaction use the same
      // optional attribution suffix.
      const dataSuffix = getAttributionDataSuffix();

      // Note: viem simulateContract targets the publicClient's chain
      // (bound to requestedChainId via usePublicClient({ chainId }) above);
      // it accepts `chain` (Chain object), not `chainId`. The wagmi
      // writeContract below carries the explicit `chainId`.
      publicClient
        .simulateContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [escrowAddress, amount],
          account,
          dataSuffix,
        })
        .then(() => {
          writeContract(
            {
              address: token.address,
              abi: erc20Abi,
              chainId: requestedChainId,
              functionName: "approve",
              args: [escrowAddress, amount],
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
      wallet.chainId,
      requestedChainId,
      escrowAddress,
      isApproving,
      isConfirming,
      publicClient,
      token.address,
      token.symbol,
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
