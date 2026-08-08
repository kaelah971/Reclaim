"use client";

import { useConnection, useDisconnect } from "wagmi";
import { isSupportedChain } from "@/lib/web3/chains";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const { address, chainId, connector, isConnecting, isReconnecting, isConnected } =
    useConnection();
  const { mutate: disconnect } = useDisconnect();

  // ---------------------------------------------------------------------
  // Live chain reconciliation
  //
  // The wagmi connection chainId is hydrated from a persisted cookie and
  // can be stale (e.g. 42220 from a previous Celo Mainnet session). The
  // wallet's REAL chain is read from the connector (eth_chainId) and is
  // authoritative once resolved. While wagmi is still reconnecting, the
  // hydrated chainId must never be presented as authoritative.
  // ---------------------------------------------------------------------
  const [liveChainId, setLiveChainId] = useState<number | undefined>();

  useEffect(() => {
    if (!isConnected || !connector) return;
    let cancelled = false;
    connector
      .getChainId()
      .then((live) => {
        if (!cancelled) setLiveChainId(live);
      })
      .catch(() => {
        if (!cancelled) setLiveChainId(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [connector, isConnected, chainId]);

  const resolvedChainId =
    !isConnected || isReconnecting
      ? undefined
      : liveChainId !== undefined
        ? liveChainId
        : chainId;

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
