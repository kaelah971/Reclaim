"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Button from "../ui/Button";
import Notice from "../ui/Notice";
import {
  CELO_CHAIN_ID,
  CELO_NETWORK_LABEL,
  CELO_NETWORK_NAME,
} from "@/lib/web3/chains";
import {
  walletErrorMessages,
  type WalletErrorCode,
} from "@/lib/web3/errors";

export type WalletDialogMode = "connect" | "switch";

export interface ConfiguredWalletOption {
  id: string;
  label: string;
  description: string;
}

interface WalletDialogProps {
  open: boolean;
  mode: WalletDialogMode;
  options: ConfiguredWalletOption[];
  currentChainId: number | undefined;
  isConnecting: boolean;
  isSwitching: boolean;
  error: WalletErrorCode | null;
  onSelectOption: (optionId: string) => void;
  onSwitchNetwork: () => void;
  onClose: () => void;
}

function detectInjectedProvider(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as { ethereum?: unknown }).ethereum);
}

function InjectedIcon() {
  return (
    <svg
      className="shrink-0"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4.5"
        width="18"
        height="15"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M3 9.75H21" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16.5" cy="12.75" r="1.875" fill="currentColor" />
    </svg>
  );
}

function WalletConnectIcon() {
  return (
    <svg
      className="shrink-0"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 11H16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8 14H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "h-8 w-8 text-gold"}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray="40 15"
      />
    </svg>
  );
}

export default function WalletDialog({
  open,
  mode,
  options,
  currentChainId,
  isConnecting,
  isSwitching,
  error,
  onSelectOption,
  onSwitchNetwork,
  onClose,
}: WalletDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [hasInjectedProvider, setHasInjectedProvider] = useState(() =>
    detectInjectedProvider()
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    const btn = dialogRef.current?.querySelector<HTMLElement>("button");
    btn?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, handleKeyDown]);

  const handleRetryDetection = useCallback(() => {
    setHasInjectedProvider(detectInjectedProvider());
  }, []);

  if (!open) return null;

  const errorContent = error ? walletErrorMessages[error] : null;
  const isBusy = mode === "connect" ? isConnecting : isSwitching;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "connect" ? "Connect wallet" : "Switch network"}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-sm rounded-[--radius-card] bg-surface shadow-[--shadow-modal] mx-4 mb-4 sm:mb-0 sm:mx-0 p-6"
      >
        {mode === "switch" ? (
          <SwitchNetworkContent
            currentChainId={currentChainId}
            isSwitching={isSwitching}
            errorContent={errorContent}
            onSwitchNetwork={onSwitchNetwork}
            onClose={onClose}
          />
        ) : (
          <>
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Connect your wallet
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              Your wallet opens your Payment Rooms, reviews and receipts.
            </p>

            {isBusy ? (
              <div className="mt-6 flex flex-col items-center gap-3 py-6">
                <Spinner />
                <p className="text-[15px] font-medium text-ink">
                  Waiting for wallet…
                </p>
                <p className="text-[13px] text-muted">
                  Confirm the connection request in your wallet.
                </p>
              </div>
            ) : errorContent ? (
              <div className="mt-6">
                <Notice variant="warning" className="!border-border">
                  <p className="text-[14px] font-medium">{errorContent.title}</p>
                  <p className="mt-1 text-[13px]">{errorContent.description}</p>
                </Notice>
                <div className="mt-4 flex gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSelectOption("injected")}
                  >
                    Retry
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : !hasInjectedProvider ? (
              <div className="mt-6">
                <Notice variant="warning" className="!border-border">
                  <p className="text-[14px] font-medium">
                    {walletErrorMessages["no-provider"].title}
                  </p>
                  <p className="mt-1 text-[13px]">
                    {walletErrorMessages["no-provider"].description}
                  </p>
                </Notice>
                <div className="mt-4 flex gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRetryDetection}
                  >
                    Retry
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 space-y-3">
                  {options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onSelectOption(option.id)}
                      className="flex w-full items-center gap-4 rounded-[--radius-card] border border-border bg-input px-5 py-4 text-left transition-colors hover:bg-border/30 min-h-[44px]"
                    >
                      {option.id === "walletConnect" ? (
                        <WalletConnectIcon />
                      ) : (
                        <InjectedIcon />
                      )}
                      <div>
                        <p className="text-[15px] font-medium text-ink">
                          {option.label}
                        </p>
                        <p className="text-[13px] text-muted">
                          {option.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                <Notice variant="info" className="mt-5 !border-border">
                  <p className="text-[13px] leading-relaxed">
                    Reclaim connects to your Celo-compatible wallet. Your
                    private key and seed phrase are never shared.
                  </p>
                </Notice>

                <div className="mt-4 flex justify-between items-center">
                  <p className="text-[13px] text-muted">
                    Supported: {CELO_NETWORK_LABEL}
                  </p>
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface SwitchNetworkContentProps {
  currentChainId: number | undefined;
  isSwitching: boolean;
  errorContent: { title: string; description: string } | null;
  onSwitchNetwork: () => void;
  onClose: () => void;
}

function SwitchNetworkContent({
  currentChainId,
  isSwitching,
  errorContent,
  onSwitchNetwork,
  onClose,
}: SwitchNetworkContentProps) {
  return (
    <>
      <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        Switch to Celo to continue.
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        This action requires the {CELO_NETWORK_NAME} network. Your entered
        details are preserved.
      </p>

      <div className="mt-5 rounded-[--radius-card] border border-border bg-input px-4 py-3">
        <dl className="space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Current network</dt>
            <dd className="font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {currentChainId !== undefined
                ? `Chain ID ${currentChainId}`
                : "Unknown"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Required network</dt>
            <dd className="font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {CELO_NETWORK_NAME} ({CELO_CHAIN_ID})
            </dd>
          </div>
        </dl>
      </div>

      {errorContent && (
        <Notice variant="warning" className="mt-4 !border-border">
          <p className="text-[14px] font-medium">{errorContent.title}</p>
          <p className="mt-1 text-[13px]">{errorContent.description}</p>
        </Notice>
      )}

      {isSwitching ? (
        <div className="mt-5 flex items-center gap-3">
          <Spinner className="h-5 w-5 text-gold" />
          <p className="text-[14px] text-muted">
            Confirm the network switch in your wallet…
          </p>
        </div>
      ) : (
        <div className="mt-5 flex gap-3">
          <Button size="sm" onClick={onSwitchNetwork}>
            {errorContent ? "Retry switch" : `Switch to ${CELO_NETWORK_NAME}`}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}
