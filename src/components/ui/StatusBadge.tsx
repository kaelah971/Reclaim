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
      className={`inline-flex items-center gap-1.5 rounded-[--radius-pill] border border-current/10 px-2.5 py-1 font-[family-name:var(--font-ibm-plex-mono)] text-[12px] font-medium leading-none tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] ${variantStyles[variant]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

export { type BadgeVariant };
