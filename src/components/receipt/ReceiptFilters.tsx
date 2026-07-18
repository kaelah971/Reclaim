"use client";

import { useState } from "react";

export type ReceiptFilterValue = "all" | "released" | "client-outcome" | "worker-outcome" | "split" | "recent";

const filters: { value: ReceiptFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "released", label: "Released" },
  { value: "client-outcome", label: "Client outcome" },
  { value: "worker-outcome", label: "Worker outcome" },
  { value: "split", label: "Split" },
  { value: "recent", label: "Recent" },
];

const emptyStateMessages: Record<ReceiptFilterValue, { title: string; description: string }> = {
  all: {
    title: "No settlement receipts yet.",
    description: "Receipts appear after a protected payment is released or resolved.",
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
  className?: string;
}

export default function ReceiptFilters({ className = "" }: ReceiptFiltersProps) {
  const [active, setActive] = useState<ReceiptFilterValue>("all");
  const msg = emptyStateMessages[active];

  return (
    <div className={className}>
      <div className="flex overflow-x-auto gap-1 pb-2" role="tablist" aria-label="Receipt filters">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={active === f.value}
            onClick={() => setActive(f.value)}
            className={`shrink-0 rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium transition-colors ${
              active === f.value
                ? "bg-primary text-page"
                : "text-muted hover:text-ink hover:bg-input"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
        <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
          {msg.title}
        </h3>
        <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
          {msg.description}
        </p>
      </div>
    </div>
  );
}



