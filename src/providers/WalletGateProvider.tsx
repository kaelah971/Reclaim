"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConnect, useConnectors, useSwitchChain } from "wagmi";
import { celoChain, isSupportedChain } from "@/lib/web3/chains";
import {
  translateConnectError,
  translateSwitchError,
  type WalletErrorCode,
} from "@/lib/web3/errors";
import {
  useWalletState,
  type WalletConnectionState,
} from "@/hooks/wallet/useWalletState";
import WalletDialog, {
  type ConfiguredWalletOption,
  type WalletDialogMode,
} from "@/components/ui/WalletDialog";

export type SupportedNetworkState = "unknown" | "unsupported" | "supported";

export interface WalletGateContextValue {
  requireWallet: (action: () => void) => void;
  openWalletDialog: () => void;
  requestNetworkSwitch: () => void;
  walletStatus: WalletConnectionState;
  networkStatus: SupportedNetworkState;
  lastError: WalletErrorCode | null;
}

const WalletGateContext = createContext<WalletGateContextValue | null>(null);

export function useWalletGate(): WalletGateContextValue {
  const context = useContext(WalletGateContext);
  if (!context) {
    throw new Error("useWalletGate must be used within WalletGateProvider");
  }
  return context;
}

export default function WalletGateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const wallet = useWalletState();
  const connectors = useConnectors();
  const { mutate: connect, isPending: isConnectPending } = useConnect();
  const { mutate: switchChain, isPending: isSwitchPending } = useSwitchChain();

  const [mode, setMode] = useState<WalletDialogMode | null>(null);
  const [lastError, setLastError] = useState<WalletErrorCode | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const walletOptions: ConfiguredWalletOption[] = useMemo(() => {
    const options: ConfiguredWalletOption[] = [
      {
        id: "injected",
        label: "Browser wallet",
        description: "MetaMask or another injected wallet",
      },
    ];
    if (connectors.some((connector) => connector.id === "walletConnect")) {
      options.push({
        id: "walletConnect",
        label: "WalletConnect",
        description: "Scan a QR code to connect",
      });
    }
    return options;
  }, [connectors]);

  const closeDialog = useCallback(() => {
    setMode(null);
    setLastError(null);
    pendingActionRef.current = null;
  }, []);

  const runPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setMode(null);
    setLastError(null);
    action?.();
  }, []);

  const requireWallet = useCallback(
    (action: () => void) => {
      if (wallet.isConnected && wallet.chainSupported) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setLastError(null);
      setMode(wallet.isConnected ? "switch" : "connect");
    },
    [wallet.isConnected, wallet.chainSupported]
  );

  const openWalletDialog = useCallback(() => {
    pendingActionRef.current = null;
    setLastError(null);
    setMode("connect");
  }, []);

  const requestNetworkSwitch = useCallback(() => {
    pendingActionRef.current = null;
    setLastError(null);
    setMode("switch");
  }, []);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      const connector = connectors.find((candidate) =>
        optionId === "injected"
          ? candidate.type === "injected"
          : candidate.id === optionId
      );
      if (!connector) {
        setLastError("no-provider");
        return;
      }
      setLastError(null);
      connect(
        { connector },
        {
          onSuccess: (data) => {
            if (isSupportedChain(data.chainId)) {
              runPendingAction();
            } else {
              setMode("switch");
            }
          },
          onError: (error) => {
            setLastError(translateConnectError(error));
          },
        }
      );
    },
    [connect, connectors, runPendingAction]
  );

  const handleSwitchNetwork = useCallback(() => {
    setLastError(null);
    switchChain(
      { chainId: celoChain.id },
      {
        onSuccess: () => {
          runPendingAction();
        },
        onError: (error) => {
          setLastError(translateSwitchError(error));
        },
      }
    );
  }, [switchChain, runPendingAction]);

  const networkStatus: SupportedNetworkState = !wallet.isConnected
    ? "unknown"
    : wallet.chainSupported
      ? "supported"
      : "unsupported";

  const contextValue = useMemo<WalletGateContextValue>(
    () => ({
      requireWallet,
      openWalletDialog,
      requestNetworkSwitch,
      walletStatus: wallet.connectionState,
      networkStatus,
      lastError,
    }),
    [
      requireWallet,
      openWalletDialog,
      requestNetworkSwitch,
      wallet.connectionState,
      networkStatus,
      lastError,
    ]
  );

  return (
    <WalletGateContext.Provider value={contextValue}>
      {children}
      <WalletDialog
        open={mode !== null}
        mode={mode ?? "connect"}
        options={walletOptions}
        currentChainId={wallet.chainId}
        isConnecting={isConnectPending}
        isSwitching={isSwitchPending}
        error={lastError}
        onSelectOption={handleSelectOption}
        onSwitchNetwork={handleSwitchNetwork}
        onClose={closeDialog}
      />
    </WalletGateContext.Provider>
  );
}
