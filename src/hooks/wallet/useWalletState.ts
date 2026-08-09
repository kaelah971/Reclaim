"use client";

import { useConnection, useDisconnect } from "wagmi";
import { isSupportedChain } from "@/lib/web3/chains";
import { useCallback, useMemo } from "react";
import { useProviderWalletChain } from "./useProviderWalletChain";

export type WalletConnectionState =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected";

export interface WalletState {
  address: string | undefined;
  shortAddress: string;
  connectionState: WalletConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  chainId: number | undefined;
  chainSupported: boolean;
  disconnect: () => void;
}

export function shortenAddress(address: string | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useWalletState(): WalletState {
  const { address, isConnecting, isReconnecting, isConnected } = useConnection();
  const { mutate: disconnect } = useDisconnect();

  // Authoritative chain: direct EIP-1193 provider read (eth_chainId).
  // The hydrated/store chainId is NEVER used as chain truth — while the
  // provider chain is unresolved (or wagmi is reconnecting) chainId is
  // undefined rather than a stale hydrated value.
  const providerChainId = useProviderWalletChain();

  const resolvedChainId = !isConnected || isReconnecting ? undefined : providerChainId;

  const chainSupported = isConnected && isSupportedChain(resolvedChainId);

  const connectionState: WalletConnectionState = useMemo(() => {
    if (isConnecting) return "connecting";
    if (isReconnecting) return "reconnecting";
    if (isConnected) return "connected";
    return "disconnected";
  }, [isConnected, isConnecting, isReconnecting]);

  const handleDisconnect = useCallback(() => {
    disconnect({});
  }, [disconnect]);

  return {
    address,
    shortAddress: shortenAddress(address),
    connectionState,
    isConnected,
    isConnecting,
    isReconnecting,
    chainId: resolvedChainId,
    chainSupported,
    disconnect: handleDisconnect,
  };
}
