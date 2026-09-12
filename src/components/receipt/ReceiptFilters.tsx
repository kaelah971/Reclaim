"use client";

import type { ReactNode } from "react";

export type ReceiptFilterValue = "all" | "released" | "client-outcome" | "worker-outcome" | "split" | "recent";

export const RECEIPT_FILTERS: { value: ReceiptFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "released", label: "Released" },
  { value: "client-outcome", label: "Client outcome" },
  { value: "worker-outcome", label: "Worker outcome" },
  { value: "split", label: "Split" },
  { value: "recent", label: "Recent" },
];

const emptyStateMessages: Record<ReceiptFilterValue, { title: string; description: string }> = {
  all: {
    title: "No payment receipts yet.",
    description: "Receipts appear when a protected payment can be verified on-chain.",
  },
  released: {
    title: "No released payments.",
    description: "Receipts for payments released to the worker will appear here.",
  },
  "client-outcome": {
    title: "No client-outcome settlements.",
    description: "Receipts where the client won the dispute will appear here.",
  },
  "worker-outcome": {
    title: "No worker-outcome settlements.",
    description: "Receipts where the worker won the dispute will appear here.",
  },
  split: {
    title: "No split settlements.",
    description: "Receipts with a split outcome will appear here.",
  },
  recent: {
    title: "No recent receipts.",
    description: "Receipts from the past 30 days will appear here.",
  },
};

interface ReceiptFiltersProps {
  value: ReceiptFilterValue;
  onChange: (value: ReceiptFilterValue) => void;
  className?: string;
  /** Render the receipt list when there are eligible receipts. */
  children?: ReactNode;
}

export default function ReceiptFilters({
  value,
  onChange,
  className = "",
  children,
}: ReceiptFiltersProps) {
  const msg = emptyStateMessages[value];

  return (
    <div className={className}>
      <div className="flex overflow-x-auto gap-1 pb-2" role="tablist" aria-label="Receipt filters">
        {RECEIPT_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={value === f.value}
            onClick={() => onChange(f.value)}
            className={`shrink-0 rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium transition-colors ${
              value === f.value
                ? "bg-primary text-page"
                : "text-muted hover:text-ink hover:bg-input"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {children ?? (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              {msg.title}
            </h3>
            <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
              {msg.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
