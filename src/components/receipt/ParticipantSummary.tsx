interface ParticipantSummaryProps {
  clientWallet?: string;
  workerWallet?: string;
  reviewerRefs?: readonly string[];
  className?: string;
}

export default function ParticipantSummary({
  clientWallet,
  workerWallet,
  reviewerRefs,
  className = "",
}: ParticipantSummaryProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Participants
      </h3>

      <dl className="mt-4 space-y-3">
        {clientWallet && (
          <div>
            <dt className="text-[13px] text-muted">Client</dt>
            <dd className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {clientWallet}
            </dd>
          </div>
        )}
        {workerWallet && (
          <div>
            <dt className="text-[13px] text-muted">Worker</dt>
            <dd className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {workerWallet}
            </dd>
          </div>
        )}
        {reviewerRefs && reviewerRefs.length > 0 && (
          <div>
            <dt className="text-[13px] text-muted">
              Reviewers ({reviewerRefs.length})
            </dt>
            {reviewerRefs.map((ref, i) => (
              <dd
                key={i}
                className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] text-ink"
              >
                {ref}
              </dd>
            ))}
          </div>
        )}
      </dl>
    </div>
  );
}
