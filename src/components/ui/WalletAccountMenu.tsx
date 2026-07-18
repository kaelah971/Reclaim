"use client";

import { useEffect, useRef } from "react";
import { CELO_NETWORK_NAME } from "@/lib/web3/chains";
import { useWalletGate } from "@/providers/WalletGateProvider";

interface WalletMenuData {
  address: string | undefined;
  shortAddress: string;
  chainId: number | undefined;
  chainSupported: boolean;
  disconnect: () => void;
}

interface WalletAccountMenuProps {
  wallet: WalletMenuData;
  onClose: () => void;
}

export default function WalletAccountMenu({
  wallet,
  onClose,
}: WalletAccountMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { requestNetworkSwitch } = useWalletGate();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const copyAddress = () => {
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
    }
  };

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-2 w-72 rounded-[--radius-card] border border-border bg-surface shadow-[--shadow-modal] z-50 overflow-hidden"
      role="menu"
    >
      <div className="p-4 border-b border-border">
        <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
          Connected wallet
        </span>
        <p className="mt-1 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] font-medium text-ink break-all">
          {wallet.address}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              wallet.chainSupported ? "bg-success" : "bg-status-disputed-text"
            }`}
            aria-hidden="true"
          />
          <span className="text-[13px] text-muted">
            {wallet.chainSupported
              ? CELO_NETWORK_NAME
              : `Chain ID: ${wallet.chainId} — unsupported`}
          </span>
        </div>
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={copyAddress}
          className="flex w-full items-center gap-3 rounded-[--radius-button] px-3 py-2.5 text-[14px] text-ink hover:bg-input transition-colors"
          role="menuitem"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="3.5"
              width="10"
              height="10"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M1.5 12.5V3C1.5 2.17 2.17 1.5 3 1.5H12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          Copy address
        </button>

        {!wallet.chainSupported && (
          <button
            type="button"
            onClick={() => {
              onClose();
              requestNetworkSwitch();
            }}
            className="flex w-full items-center gap-3 rounded-[--radius-button] px-3 py-2.5 text-[14px] text-gold hover:bg-input transition-colors"
            role="menuitem"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 2V10M8 2L5 5M8 2L11 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 13H13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {`Switch to ${CELO_NETWORK_NAME}`}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            wallet.disconnect();
            onClose();
          }}
          className="flex w-full items-center gap-3 rounded-[--radius-button] px-3 py-2.5 text-[14px] text-muted hover:bg-input transition-colors"
          role="menuitem"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 3H3.5C2.67 3 2 3.67 2 4.5V12.5C2 13.33 2.67 14 3.5 14H6M10.5 11L14 8L10.5 5M14 8H6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Disconnect
        </button>
      </div>
    </div>
  );
}
