interface ReviewResultProps {
  finalRuling?: string;
  voteBreakdown?: string;
  splitPercentages?: string;
  reviewerCount?: number;
  reviewNote?: string;
  className?: string;
}

export default function ReviewResult({
  finalRuling,
  voteBreakdown,
  splitPercentages,
  reviewerCount,
  reviewNote,
  className = "",
}: ReviewResultProps) {
  if (!finalRuling && !voteBreakdown && !reviewerCount) return null;

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Review result
      </h3>

      <div className="mt-4 space-y-3">
        {finalRuling && (
          <div>
            <dt className="text-[13px] text-muted">Final ruling</dt>
            <dd className="mt-0.5 text-[15px] font-medium text-ink">
              {finalRuling}
            </dd>
          </div>
        )}
        {voteBreakdown && (
          <div>
            <dt className="text-[13px] text-muted">Vote breakdown</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{voteBreakdown}</dd>
          </div>
        )}
        {splitPercentages && (
          <div>
            <dt className="text-[13px] text-muted">Split</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {splitPercentages}
            </dd>
          </div>
        )}
        {reviewerCount !== undefined && (
          <div>
            <dt className="text-[13px] text-muted">Reviewer count</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {reviewerCount}
            </dd>
          </div>
        )}
        {reviewNote && (
          <div className="border-t border-border pt-3">
            <dt className="text-[13px] text-muted">Review note</dt>
            <dd className="mt-1 text-[14px] leading-relaxed text-muted">
              {reviewNote}
            </dd>
          </div>
        )}
      </div>
    </div>
  );
}
