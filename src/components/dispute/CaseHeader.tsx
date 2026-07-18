import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

interface CaseHeaderProps {
  disputeId?: string;
  paymentRef?: string;
  amount?: string;
  asset?: string;
  status?: string;
  statusVariant?: BadgeVariant;
  reviewDeadline?: string;
  currentPhase?: string;
  className?: string;
}

export default function CaseHeader({
  disputeId,
  paymentRef,
  amount,
  asset = "cUSD",
  status,
  statusVariant = "pending",
  reviewDeadline,
  currentPhase,
  className = "",
}: CaseHeaderProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {disputeId && (
          <div>
            <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
              Dispute
            </span>
            <p className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {disputeId}
            </p>
          </div>
        )}
        {paymentRef && (
          <div>
            <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
              Payment
            </span>
            <p className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {paymentRef}
            </p>
          </div>
        )}
        {amount && (
          <div>
            <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
              Amount
            </span>
            <p className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {amount} {asset}
            </p>
          </div>
        )}
        {status && (
          <div className="flex items-center gap-2">
            <StatusBadge variant={statusVariant} label={status} />
          </div>
        )}
        {reviewDeadline && (
          <div>
            <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
              Review deadline
            </span>
            <p className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {reviewDeadline}
            </p>
          </div>
        )}
        {currentPhase && (
          <div>
            <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
              Phase
            </span>
            <p className="mt-0.5 text-[15px] font-medium text-ink">
              {currentPhase}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
