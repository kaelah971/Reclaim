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
  requestNetworkSwitch: (targetChainId?: number) => void;
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

/**
 * Resolve the pending network-switch target. Only supported Celo chains are
 * accepted; anything else (including an omitted argument) fails closed to
 * the default escrow chain (Sepolia) so the dialog can never target a wrong
 * or unsupported network.
 */
export function resolveSwitchTarget(targetChainId?: number): number {
  return targetChainId !== undefined && isSupportedChain(targetChainId)
    ? targetChainId
    : celoChain.id;
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
  // Pending switch target for the SwitchNetworkContent dialog. Defaults to
  // the Sepolia escrow chain; callers may pass a supported chain ID via
  // requestNetworkSwitch to retarget it (e.g. Celo Mainnet for new payments).
  const [pendingChainId, setPendingChainId] = useState<number>(celoChain.id);
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
    setPendingChainId(celoChain.id);
    pendingActionRef.current = null;
  }, []);

  const runPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setMode(null);
    setLastError(null);
    setPendingChainId(celoChain.id);
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
      setPendingChainId(celoChain.id);
      setMode(wallet.isConnected ? "switch" : "connect");
    },
    [wallet.isConnected, wallet.chainSupported]
  );

  const openWalletDialog = useCallback(() => {
    pendingActionRef.current = null;
    setLastError(null);
    setPendingChainId(celoChain.id);
    setMode("connect");
  }, []);

  const requestNetworkSwitch = useCallback((targetChainId?: number) => {
    pendingActionRef.current = null;
    setLastError(null);
    setPendingChainId(resolveSwitchTarget(targetChainId));
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
      { chainId: pendingChainId },
      {
        onSuccess: () => {
          runPendingAction();
        },
        onError: (error) => {
          setLastError(translateSwitchError(error));
        },
      }
    );
  }, [switchChain, runPendingAction, pendingChainId]);

  const networkStatus: SupportedNetworkState = !wallet.isConnected
    ? "unknown"
    : wallet.chainSupported
      ? "supported"
      : "unsupported";

  // Auto-dismiss the switch gate when the wallet's chain becomes supported
  // (e.g. after wagmi SSR cookie hydration resolves to real connection).
  // Pending action is cleared — user must explicitly retry the action.
  const effectiveMode: WalletDialogMode | null =
    mode === "switch" && wallet.isConnected && wallet.chainSupported
      ? null
      : mode;

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
        open={effectiveMode !== null}
        mode={effectiveMode ?? "connect"}
        options={walletOptions}
        currentChainId={wallet.chainId}
        requiredChainId={pendingChainId}
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
