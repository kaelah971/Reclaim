"use client";

import { useConnection, useDisconnect } from "wagmi";
import { isSupportedChain } from "@/lib/web3/chains";
import { useCallback, useMemo } from "react";

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
  const { address, chainId, isConnecting, isReconnecting, isConnected } =
    useConnection();
  const { mutate: disconnect } = useDisconnect();

  const chainSupported = isConnected && isSupportedChain(chainId);

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
    chainId,
    chainSupported,
    disconnect: handleDisconnect,
  };
}
