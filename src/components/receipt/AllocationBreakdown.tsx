interface AllocationBreakdownProps {
  protectedAmount?: string;
  asset?: string;
  clientAllocation?: string;
  workerAllocation?: string;
  platformFee?: string;
  reviewerReward?: string;
  className?: string;
}

export default function AllocationBreakdown({
  protectedAmount,
  asset = "cUSD",
  clientAllocation,
  workerAllocation,
  platformFee,
  reviewerReward,
  className = "",
}: AllocationBreakdownProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Allocation
      </h3>

      <dl className="mt-4 space-y-3">
        {protectedAmount && (
          <div className="flex justify-between">
            <dt className="text-[15px] text-muted">Protected amount</dt>
            <dd className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {protectedAmount} {asset}
            </dd>
          </div>
        )}
        {clientAllocation !== undefined && (
          <div className="flex justify-between">
            <dt className="text-[15px] text-muted">Client allocation</dt>
            <dd className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {clientAllocation} {asset}
            </dd>
          </div>
        )}
        {workerAllocation !== undefined && (
          <div className="flex justify-between">
            <dt className="text-[15px] text-muted">Worker allocation</dt>
            <dd className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {workerAllocation} {asset}
            </dd>
          </div>
        )}
        {platformFee && (
          <div className="flex justify-between border-t border-border pt-3">
            <dt className="text-[15px] text-muted">Platform fee</dt>
            <dd className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {platformFee} {asset}
            </dd>
          </div>
        )}
        {reviewerReward && (
          <div className="flex justify-between">
            <dt className="text-[15px] text-muted">Reviewer reward</dt>
            <dd className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {reviewerReward} {asset}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
