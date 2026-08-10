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
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className="paper-stack absolute right-0 top-0 h-full w-[320px] max-w-[88vw] overflow-y-auto border-l border-border bg-page shadow-[--shadow-modal]"
      >
        <div className="relative z-10 flex h-16 items-center justify-between border-b border-border bg-surface px-4">
          <span className="text-xl font-[family-name:var(--font-newsreader)] font-medium tracking-[-0.02em] text-ink">
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

        <nav
          className="relative z-10 flex flex-col gap-1 bg-page p-4"
          aria-label="Mobile navigation"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[--radius-button] border border-transparent px-4 py-3 text-[15px] font-medium text-ink transition-colors hover:border-border hover:bg-surface"
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="relative z-10 flex flex-col gap-3 border-t border-border bg-surface p-4">
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
