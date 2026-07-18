"use client";

import { useWalletState } from "@/hooks/wallet/useWalletState";
import { useWalletGate } from "@/providers/WalletGateProvider";
import { CELO_NETWORK_NAME } from "@/lib/web3/chains";
import Button from "../ui/Button";
import Notice from "../ui/Notice";

interface UnsupportedNetworkNoticeProps {
  className?: string;
}

export default function UnsupportedNetworkNotice({
  className = "",
}: UnsupportedNetworkNoticeProps) {
  const wallet = useWalletState();
  const { requestNetworkSwitch } = useWalletGate();

  if (!wallet.isConnected || wallet.chainSupported) return null;

  return (
    <Notice variant="warning" className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14px] font-medium text-ink">
            Switch to {CELO_NETWORK_NAME} to continue.
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            You are connected to an unsupported network
            {wallet.chainId ? ` (Chain ID: ${wallet.chainId})` : ""}.
          </p>
        </div>
        <Button size="sm" onClick={requestNetworkSwitch}>
          Switch to Celo
        </Button>
      </div>
    </Notice>
  );
}
