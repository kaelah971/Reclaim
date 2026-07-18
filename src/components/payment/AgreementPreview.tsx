import { PAYMENT_TOKEN_SYMBOL } from "@/lib/web3/tokens";

interface AgreementPreviewProps {
  amount?: string;
  worker?: string;
  deliverable?: string;
  deliveryFormat?: string;
  deadline?: string;
  releaseRule?: string;
  disputeWindow?: string;
  evidenceExpectation?: string;
  fee?: string;
  className?: string;
}

const releaseRuleLabels: Record<string, string> = {
  "buyer-approval": "Buyer approval required",
  "auto-release": "Buyer approval or timed auto-release",
  manual: "Manual release only",
};

export default function AgreementPreview({
  amount,
  worker,
  deliverable,
  deliveryFormat,
  deadline,
  releaseRule,
  disputeWindow,
  evidenceExpectation,
  fee,
  className = "",
}: AgreementPreviewProps) {
  const hasContent = amount || worker || deliverable || deliveryFormat || deadline;

  return (
    <div
      className={`rounded-[--radius-card] border border-dashed border-border bg-page p-6 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Agreement preview
        </h3>
        <span className="text-[12px] text-muted">Draft</span>
      </div>

      {!hasContent ? (
        <p className="text-[15px] text-muted">
          Fill out the payment and work-agreement fields to preview the terms here.
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {amount && (
            <div>
              <dt className="text-[13px] text-muted">Amount</dt>
              <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
                {amount} {PAYMENT_TOKEN_SYMBOL}
              </dd>
            </div>
          )}
          {worker && (
            <div>
              <dt className="text-[13px] text-muted">Worker</dt>
              <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] text-ink text-ellipsis overflow-hidden">
                {worker}
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
              <dd className="mt-0.5 text-[15px] text-ink">
                {releaseRuleLabels[releaseRule] || releaseRule}
              </dd>
            </div>
          )}
          {disputeWindow && (
            <div>
              <dt className="text-[13px] text-muted">Dispute window</dt>
              <dd className="mt-0.5 text-[15px] text-ink">
                {disputeWindow} hours
              </dd>
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
      )}
    </div>
  );
}
