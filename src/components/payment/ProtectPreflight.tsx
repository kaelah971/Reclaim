"use client";

export interface PreflightTerms {
  title: string;
  deliverable: string;
  deliveryFormat: string;
  deadline: string;
  releaseRuleLabel: string;
  disputeWindow: string;
  evidenceExpectation: string;
}

interface ProtectPreflightProps {
  amount: string;
  tokenDisplay: string;
  worker: string;
  networkDisplay: string;
  terms: PreflightTerms;
}

// ---------------------------------------------------------------------------
// ProtectPreflight — STEP 3 review summary (P4.2b).
//
// "You are protecting [amount] USA₮ / For [worker] / On Celo / Terms
// summary" plus the "What happens next?" explainer. Presentational only;
// orchestration lives in useProtectPaymentFlow.
// ---------------------------------------------------------------------------

export const WHAT_HAPPENS_NEXT_STEPS: ReadonlyArray<{
  title: string;
  detail: string;
}> = [
  {
    title: "Funds are locked in the protection contract",
    detail: "The money leaves your wallet but is not sent to the freelancer yet.",
  },
  {
    title: "The freelancer sees the payment is protected",
    detail: "They can accept the agreement knowing the funds are set aside.",
  },
  {
    title: "They accept and submit the work",
    detail: "Delivery and handover notes are shared with you for review.",
  },
  {
    title: "They request release when delivery is submitted",
    detail: "You get a clear request to review — nothing moves on its own.",
  },
  {
    title: "You release after you review",
    detail: "The locked funds move to the freelancer only when you approve.",
  },
  {
    title: "A dispute path stays available",
    detail: "If you disagree, either side can open a dispute instead of releasing.",
  },
];

export default function ProtectPreflight({
  amount,
  tokenDisplay,
  worker,
  networkDisplay,
  terms,
}: ProtectPreflightProps) {
  return (
    <div className="space-y-8">
      <section
        aria-label="Protection summary"
        className="rounded-[--radius-card] border border-border bg-surface p-6"
      >
        <p className="text-[20px] leading-snug text-ink">
          You are protecting{" "}
          <strong className="font-[family-name:var(--font-ibm-plex-mono)] font-semibold tabular-nums">
            {amount} {tokenDisplay}
          </strong>
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-muted">For</dt>
            <dd className="mt-0.5 break-all text-[15px] font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {worker}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">On</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{networkDisplay}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Terms summary
          </h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-[13px] text-muted">Agreement</dt>
              <dd className="mt-0.5 text-[15px] text-ink">{terms.title}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[13px] text-muted">Deliverable</dt>
              <dd className="mt-0.5 text-[15px] text-ink">
                {terms.deliverable}
              </dd>
            </div>
            {terms.deliveryFormat && (
              <div>
                <dt className="text-[13px] text-muted">Delivery format</dt>
                <dd className="mt-0.5 text-[15px] text-ink">
                  {terms.deliveryFormat}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-[13px] text-muted">Delivery date</dt>
              <dd className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
                {terms.deadline}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">How money is released</dt>
              <dd className="mt-0.5 text-[15px] text-ink">
                {terms.releaseRuleLabel}
              </dd>
            </div>
            {terms.disputeWindow && (
              <div>
                <dt className="text-[13px] text-muted">Review window</dt>
                <dd className="mt-0.5 text-[15px] text-ink">
                  {terms.disputeWindow} hours
                </dd>
              </div>
            )}
            {terms.evidenceExpectation && (
              <div className="sm:col-span-2">
                <dt className="text-[13px] text-muted">
                  What delivery includes
                </dt>
                <dd className="mt-0.5 text-[15px] text-ink">
                  {terms.evidenceExpectation}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <section aria-label="What happens next?">
        <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
          What happens next?
        </h3>
        <ol className="mt-4 space-y-3">
          {WHAT_HAPPENS_NEXT_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/50 text-[12px] font-semibold text-gold font-[family-name:var(--font-ibm-plex-mono)] tabular-nums"
              >
                {index + 1}
              </span>
              <div>
                <p className="text-[15px] font-medium text-ink">{step.title}</p>
                <p className="text-[14px] text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
