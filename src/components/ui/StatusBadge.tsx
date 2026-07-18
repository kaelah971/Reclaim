type BadgeVariant = "protected" | "disputed" | "pending" | "settled" | "submitted" | "missing" | "verified";

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  protected: "bg-status-protected-bg text-status-protected-text",
  disputed: "bg-status-disputed-bg text-status-disputed-text",
  pending: "bg-status-pending-bg text-status-pending-text",
  settled: "bg-status-settled-bg text-status-settled-text",
  submitted: "bg-status-protected-bg text-status-protected-text",
  missing: "bg-status-disputed-bg text-status-disputed-text",
  verified: "bg-status-settled-bg text-status-settled-text",
};

export default function StatusBadge({ variant, label, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[--radius-pill] px-3 py-1 text-[13px] font-medium leading-none ${variantStyles[variant]} ${className}`}
    >
      {label}
    </span>
  );
}

export { type BadgeVariant };
