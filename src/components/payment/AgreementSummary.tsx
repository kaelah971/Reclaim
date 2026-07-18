interface AgreementSummaryProps {
  clientWallet?: string;
  workerWallet?: string;
  deliverable?: string;
  deliveryFormat?: string;
  deadline?: string;
  releaseRule?: string;
  disputeWindow?: string;
  evidenceExpectation?: string;
  fee?: string;
  className?: string;
}

export default function AgreementSummary({
  clientWallet,
  workerWallet,
  deliverable,
  deliveryFormat,
  deadline,
  releaseRule,
  disputeWindow,
  evidenceExpectation,
  fee,
  className = "",
}: AgreementSummaryProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Agreement
      </h3>

      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {clientWallet && (
          <div>
            <dt className="text-[13px] text-muted">Client</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] text-ink text-ellipsis overflow-hidden">
              {clientWallet}
            </dd>
          </div>
        )}
        {workerWallet && (
          <div>
            <dt className="text-[13px] text-muted">Worker</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] text-ink text-ellipsis overflow-hidden">
              {workerWallet}
            </dd>
          </div>
        )}
        {deliverable && (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Deliverable</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{deliverable}</dd>
          </div>
        )}
        {deliveryFormat && (
          <div>
            <dt className="text-[13px] text-muted">Delivery format</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{deliveryFormat}</dd>
          </div>
        )}
        {deadline && (
          <div>
            <dt className="text-[13px] text-muted">Deadline</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {deadline}
            </dd>
          </div>
        )}
        {releaseRule && (
          <div>
            <dt className="text-[13px] text-muted">Release rule</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{releaseRule}</dd>
          </div>
        )}
        {disputeWindow && (
          <div>
            <dt className="text-[13px] text-muted">Dispute window</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{disputeWindow}</dd>
          </div>
        )}
        {evidenceExpectation && (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Evidence expectation</dt>
            <dd className="mt-0.5 text-[15px] text-ink">
              {evidenceExpectation}
            </dd>
          </div>
        )}
        {fee && (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Platform fee</dt>
            <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
              {fee}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
