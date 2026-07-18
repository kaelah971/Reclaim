"use client";

import Link from "next/link";
import { useEffect, useRef, useCallback } from "react";
import WalletButton from "../ui/WalletButton";

interface NavItem {
  label: string;
  href: string;
}

interface MobileNavigationProps {
  items: readonly NavItem[];
  ctaLabel?: string;
  ctaHref?: string;
  showWallet?: boolean;
  onClose: () => void;
}

export default function MobileNavigation({
  items,
  ctaLabel,
  ctaHref,
  showWallet,
  onClose,
}: MobileNavigationProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[60] md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <div
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className="absolute right-0 top-0 h-full w-[300px] max-w-[85vw] bg-surface shadow-[--shadow-modal]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 h-16">
          <span className="text-lg font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Menu
          </span>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-[--radius-button] text-ink hover:bg-input"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1L17 17M17 1L1 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="flex flex-col p-4 gap-1" aria-label="Mobile navigation">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[--radius-button] px-4 py-3 text-[15px] font-medium text-ink hover:bg-input transition-colors"
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-4 flex flex-col gap-3">
          {showWallet && <WalletButton />}
          {ctaLabel && ctaHref && (
            <Link
              href={ctaHref}
              className="inline-flex h-12 items-center justify-center rounded-[--radius-button] bg-primary px-5 text-[15px] font-semibold text-page transition-colors hover:bg-utility"
              onClick={onClose}
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
