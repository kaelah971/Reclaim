import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

interface ClaimPanelProps {
  side: "client" | "worker";
  claimSummary?: string;
  requestedOutcome?: string;
  evidenceCount?: number;
  dateSubmitted?: string;
  statusVariant?: BadgeVariant;
  statusLabel?: string;
  className?: string;
}

export default function ClaimPanel({
  side,
  claimSummary,
  requestedOutcome,
  evidenceCount,
  dateSubmitted,
  statusVariant,
  statusLabel,
  className = "",
}: ClaimPanelProps) {
  const label = side === "client" ? "Client claim" : "Worker claim";

  if (!claimSummary && !requestedOutcome) {
    return (
      <div
        className={`rounded-[--radius-card] border border-dashed border-border bg-page p-6 ${className}`}
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          {label}
        </h3>
        <p className="mt-3 text-[15px] text-muted">
          {side === "client"
            ? "No client claim has been submitted."
            : "No worker claim has been submitted."}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          {label}
        </h3>
        {statusLabel && statusVariant && (
          <StatusBadge variant={statusVariant} label={statusLabel} />
        )}
      </div>

      {claimSummary && (
        <div className="mt-4">
          <h4 className="text-[14px] font-semibold text-ink">Summary</h4>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">
            {claimSummary}
          </p>
        </div>
      )}

      {requestedOutcome && (
        <div className="mt-3">
          <h4 className="text-[14px] font-semibold text-ink">
            Requested outcome
          </h4>
          <p className="mt-1 text-[15px] text-ink">{requestedOutcome}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted border-t border-border pt-3">
        {evidenceCount !== undefined && (
          <span>{evidenceCount} evidence item{evidenceCount !== 1 ? "s" : ""}</span>
        )}
        {dateSubmitted && (
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
            Submitted: {dateSubmitted}
          </span>
        )}
      </div>
    </div>
  );
}
