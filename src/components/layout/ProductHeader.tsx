"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useCallback } from "react";
import { navigation, primaryCta, productName } from "@/lib/tokens";
import MobileNavigation from "./MobileNavigation";
import WalletButton from "../ui/WalletButton";
import UnsupportedNetworkNotice from "../ui/UnsupportedNetworkNotice";
import { useWalletState } from "@/hooks/wallet/useWalletState";

export default function ProductHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const wallet = useWalletState();

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <>
      {wallet.isConnected && !wallet.chainSupported && (
        <UnsupportedNetworkNotice className="!rounded-none border-b-0" />
      )}

      <header className="sticky top-0 z-50 border-b espresso-header shadow-[0_8px_28px_rgba(35,28,21,0.16)]">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 md:px-6">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 text-lg font-[family-name:var(--font-newsreader)] font-medium tracking-tight text-page"
          >
            <span
              className="h-7 w-7 rounded-[--radius-button] border border-gold/35 bg-page/8"
              aria-hidden="true"
            />
            {productName}
          </Link>

          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="Product navigation"
          >
            {navigation.product.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[--radius-button] px-3 py-2 text-[14px] font-medium transition-colors ${
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href))
                    ? "bg-page/12 text-page shadow-[inset_0_0_0_1px_rgba(201,160,80,0.18)]"
                    : "text-page/70 hover:bg-page/10 hover:text-page"
                }`}
                aria-current={
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))
                    ? "page"
                    : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <Link
              href="/payments/new"
              className="hidden h-9 items-center rounded-[--radius-button] border border-gold/45 bg-gold px-4 text-[13px] font-semibold text-primary transition-colors hover:bg-gold-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-primary lg:inline-flex"
            >
              {primaryCta}
            </Link>

            <div className="hidden sm:block">
              <WalletButton />
            </div>

            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-[--radius-button] text-page transition-colors hover:bg-page/10 md:hidden"
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
          items={navigation.product}
          onClose={closeMobile}
          ctaLabel={primaryCta}
          ctaHref="/payments/new"
          showWallet
        />
      )}
    </>
  );
}
