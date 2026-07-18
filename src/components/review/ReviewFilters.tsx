"use client";

import { useState } from "react";

export type ReviewFilterValue = "assigned" | "in-review" | "submitted" | "resolved";

const filters: { value: ReviewFilterValue; label: string }[] = [
  { value: "assigned", label: "Assigned" },
  { value: "in-review", label: "In review" },
  { value: "submitted", label: "Submitted" },
  { value: "resolved", label: "Resolved" },
];

const emptyStateMessages: Record<ReviewFilterValue, { title: string; description: string }> = {
  assigned: {
    title: "No cases currently assigned.",
    description: "Cases assigned to you for review will appear here.",
  },
  "in-review": {
    title: "No cases are currently in review.",
    description: "Cases you are actively reviewing will appear here.",
  },
  submitted: {
    title: "No reviews submitted.",
    description: "Cases where you have submitted your review will appear here.",
  },
  resolved: {
    title: "No resolved cases.",
    description: "Cases that have been settled after review will appear here.",
  },
};

interface ReviewFiltersProps {
  className?: string;
}

export default function ReviewFilters({ className = "" }: ReviewFiltersProps) {
  const [active, setActive] = useState<ReviewFilterValue>("assigned");
  const msg = emptyStateMessages[active];

  return (
    <div className={className}>
      <div className="flex overflow-x-auto gap-1 pb-2" role="tablist" aria-label="Review filters">
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

export { emptyStateMessages };
