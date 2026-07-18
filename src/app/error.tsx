"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";

export default function ErrorPage({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void _error;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <span className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">
        Reclaim
      </span>
      <h1 className="mt-4 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
        This page could not be loaded.
      </h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
        Something interrupted the record. Try again, or return to your dashboard.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/dashboard"
          className="inline-flex h-12 items-center rounded-[--radius-button] border border-border bg-page px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-input"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
