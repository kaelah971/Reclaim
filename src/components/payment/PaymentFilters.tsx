"use client";

interface PaymentFiltersProps {
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

const filters = [
  { value: "all", label: "All" },
  { value: "action", label: "Needs action" },
  { value: "active", label: "Active" },
  { value: "disputed", label: "Disputed" },
  { value: "completed", label: "Completed" },
];

export default function PaymentFilters({
  value,
  onChange,
  className = "",
}: PaymentFiltersProps) {
  return (
    <div className={className}>
      <div
        className="flex overflow-x-auto gap-1 pb-2"
        role="tablist"
        aria-label="Payment filters"
      >
        {filters.map((f) => (
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
    </div>
  );
}
