"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useCallback } from "react";
import { navigation, productName, primaryCta } from "@/lib/tokens";
import MobileNavigation from "./MobileNavigation";
import WalletButton from "../ui/WalletButton";

export default function MarketingHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-page/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 md:px-6">
          <Link
            href="/"
            className="text-lg font-[family-name:var(--font-newsreader)] font-medium tracking-tight text-ink"
          >
            {productName}
          </Link>

          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="Main navigation"
          >
            {navigation.marketing.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[--radius-button] px-3 py-2 text-[15px] font-medium transition-colors ${
                  pathname === item.href
                    ? "text-ink bg-input"
                    : "text-muted hover:text-ink hover:bg-input"
                }`}
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden md:block">
              <WalletButton />
            </div>

            <Link
              href="/payments/new"
              className="hidden h-11 items-center rounded-[--radius-button] bg-primary px-5 text-[15px] font-semibold text-page transition-colors hover:bg-utility md:inline-flex"
            >
              {primaryCta}
            </Link>

            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-[--radius-button] text-ink md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
            >
              <svg
                width="22"
                height="16"
                viewBox="0 0 22 16"
                fill="none"
                aria-hidden="true"
              >
                <rect width="22" height="2" rx="1" fill="currentColor" />
                <rect y="7" width="22" height="2" rx="1" fill="currentColor" />
                <rect y="14" width="22" height="2" rx="1" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <MobileNavigation
          items={navigation.marketing}
          ctaLabel={primaryCta}
          ctaHref="/payments/new"
          onClose={closeMobile}
        />
      )}
    </>
  );
}
