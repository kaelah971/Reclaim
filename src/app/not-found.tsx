import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <span className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">
        Reclaim
      </span>
      <h1 className="mt-4 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
        This page is not part of the record.
      </h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
        The link may be incomplete, expired, or not available yet.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex h-12 items-center rounded-[--radius-button] bg-primary px-5 text-[15px] font-semibold text-page transition-colors hover:bg-utility"
        >
          Return home
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex h-12 items-center rounded-[--radius-button] border border-border bg-page px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-input"
        >
          Go to dashboard
        </Link>
        <Link
          href="/payments"
          className="inline-flex h-12 items-center rounded-[--radius-button] border border-border bg-page px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-input"
        >
          View payments
        </Link>
      </div>
    </div>
  );
}
