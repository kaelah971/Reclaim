"use client";

interface TransactionRef {
  label: string;
  reference?: string;
}

interface TransactionReferenceProps {
  items: readonly TransactionRef[];
  className?: string;
}

export default function TransactionReference({
  items,
  className = "",
}: TransactionReferenceProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        On-chain references
      </h3>

      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-3"
          >
            <dt className="text-[14px] text-muted shrink-0">{item.label}</dt>
            <dd className="text-right">
              {item.reference ? (
                <div className="flex items-center gap-2">
                  <code className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink max-w-[200px] truncate">
                    {item.reference}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(item.reference || "");
                    }}
                    className="shrink-0 text-muted hover:text-ink transition-colors"
                    aria-label={`Copy ${item.label}`}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                    >
                      <rect
                        x="3"
                        y="3"
                        width="9"
                        height="9"
                        rx="1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M1 11V2.5C1 1.67 1.67 1 2.5 1H11"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ) : (
                <span className="text-[13px] text-muted">Pending</span>
              )}
            </dd>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { TransactionRef };
