"use client";

import { useCallback, useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";
import { useProviderWalletChain } from "@/hooks/wallet/useProviderWalletChain";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";
import Button from "./Button";

// ---------------------------------------------------------------------------
// SwitchToSepoliaButton — real network action for Sepolia-only escrow
// screens (evidence submission, payment-room escrow actions).
//
// Only rendered when the wallet is connected and the DIRECT provider chain
// (eth_chainId) is resolved to something other than Celo Sepolia 11142220.
// Clicking calls wagmi switchChain({ chainId: 11142220 }); the provider's
// "chainChanged" event then re-reads eth_chainId and the app reconciles to
// 11142220. When the provider is already on Sepolia the button renders
// nothing — MetaMask is never asked to switch unnecessarily.
// ---------------------------------------------------------------------------

export default function SwitchToSepoliaButton({
  size = "sm",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const { isConnected } = useConnection();
  const providerChainId = useProviderWalletChain();
  const { switchChain, isPending } = useSwitchChain();
  const [switchError, setSwitchError] = useState<string | null>(null);

  const handleSwitch = useCallback(() => {
    setSwitchError(null);
    switchChain(
      { chainId: CELO_CHAIN_ID },
      {
        onSuccess: () => setSwitchError(null),
        onError: () => setSwitchError("Network switch was rejected or failed."),
      },
    );
  }, [switchChain]);

  if (!isConnected) return null;
  // Only act when the provider chain is RESOLVED and not Sepolia.
  if (providerChainId === undefined || providerChainId === CELO_CHAIN_ID) return null;

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <Button
        variant="primary"
        size={size}
        onClick={handleSwitch}
        disabled={isPending}
      >
        {isPending ? "Switching…" : "Switch to Celo Sepolia"}
      </Button>
      {switchError && (
        <span className="text-[13px] text-status-disputed-text">{switchError}</span>
      )}
    </div>
  );
}
