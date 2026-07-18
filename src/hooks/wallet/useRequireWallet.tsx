"use client";

import {
  useWalletGate,
  type WalletGateContextValue,
  type SupportedNetworkState,
} from "@/providers/WalletGateProvider";
import { useWalletState, type WalletState } from "./useWalletState";
import type { WalletErrorCode } from "@/lib/web3/errors";

export interface RequireWalletAPI {
  requireWallet: (action: () => void) => void;
  openWalletDialog: () => void;
  requestNetworkSwitch: () => void;
  wallet: WalletState;
  networkStatus: SupportedNetworkState;
  lastError: WalletErrorCode | null;
}

export function useRequireWallet(): RequireWalletAPI {
  const gate: WalletGateContextValue = useWalletGate();
  const wallet = useWalletState();

  return {
    requireWallet: gate.requireWallet,
    openWalletDialog: gate.openWalletDialog,
    requestNetworkSwitch: gate.requestNetworkSwitch,
    wallet,
    networkStatus: gate.networkStatus,
    lastError: gate.lastError,
  };
}
