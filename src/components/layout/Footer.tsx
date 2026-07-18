import Link from "next/link";
import { productName } from "@/lib/tokens";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-[1440px] px-4 py-12 md:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-lg font-[family-name:var(--font-newsreader)] font-medium text-ink">
              {productName}
            </span>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Protected cUSD payments for clients and independent digital
              workers.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
              Product
            </h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link
                  href="/how-it-works"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  How it works
                </Link>
              </li>
              <li>
                <Link
                  href="/for-clients"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  For clients
                </Link>
              </li>
              <li>
                <Link
                  href="/for-workers"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  For workers
                </Link>
              </li>
              <li>
                <Link
                  href="/developers"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  Developers
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
              App
            </h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link
                  href="/dashboard"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/payments"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  Payments
                </Link>
              </li>
              <li>
                <Link
                  href="/receipts"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  Receipts
                </Link>
              </li>
              <li>
                <Link
                  href="/refund-scan"
                  className="text-[15px] text-ink hover:text-gold transition-colors"
                >
                  Refund scan
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
              Built on
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              Celo network &middot; cUSD stablecoin &middot; x402 agentic
              payments
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-center text-[13px] text-muted">
          &copy; {new Date().getFullYear()} {productName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
