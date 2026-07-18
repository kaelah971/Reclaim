"use client";

import { useWalletState } from "@/hooks/wallet/useWalletState";
import { useCallback, useState } from "react";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import WalletAccountMenu from "./WalletAccountMenu";

export default function WalletButton() {
  const wallet = useWalletState();
  const { openWalletDialog } = useRequireWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleConnect = useCallback(() => {
    openWalletDialog();
  }, [openWalletDialog]);

  if (wallet.isConnected && wallet.address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-[--radius-pill] border border-border bg-input px-3 py-1.5 text-[14px] font-medium text-ink transition-colors hover:bg-border/50 min-h-[44px]"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              wallet.chainSupported ? "bg-success" : "bg-status-disputed-text"
            }`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
            {wallet.shortAddress}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {menuOpen && (
          <WalletAccountMenu
            wallet={wallet}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={wallet.isConnecting || wallet.isReconnecting}
      className="inline-flex items-center justify-center gap-2 rounded-[--radius-button] border border-border bg-page px-3 py-1.5 text-[14px] font-semibold text-ink transition-colors hover:bg-input focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[36px]"
    >
      {wallet.isConnecting || wallet.isReconnecting ? (
        <span className="flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="30 10"
            />
          </svg>
          Connecting…
        </span>
      ) : (
        <>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="11" cy="8.5" r="1.25" fill="currentColor" />
          </svg>
          Connect wallet
        </>
      )}
    </button>
  );
}
