import EmptyState from "@/components/ui/EmptyState";
import ReviewerPrinciples from "@/components/review/ReviewerPrinciples";
import ReviewFilters from "@/components/review/ReviewFilters";
import Notice from "@/components/ui/Notice";

export default function ReviewsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Review protected-payment cases
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Assigned cases will appear here when reviewer access is enabled.
        </p>
      </div>

      <div className="mt-8">
        <EmptyState
          title="No assigned cases."
          description="When you are selected as a reviewer for a disputed payment, the case will appear here with the structured evidence packet and voting controls."
        />
      </div>

      <ReviewFilters className="mt-10" />

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <div className="rounded-[--radius-card] border border-border bg-surface p-6">
          <ReviewerPrinciples />
        </div>

        <div className="rounded-[--radius-card] border border-border bg-surface p-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Reviewer access
          </h3>
          <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-muted">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              Connect your Celo wallet to register as a reviewer.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              Receive a structured evidence packet and AI-organised case summary.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              Review against the agreed terms within the review deadline.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              Submit your vote: client wins, worker wins, or split.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              View the settlement outcome on your reviewer dashboard.
            </li>
          </ul>
        </div>
      </div>

      <Notice variant="info" className="mt-8">
        <p className="text-[14px] leading-relaxed">
          <strong>Reviewer rewards.</strong> Reviewer reward routing is planned for a later phase. During the initial launch, reviews are part of the protected-payment process. Rewards, reputation, and accuracy scores will be introduced in a future update.
        </p>
      </Notice>
    </div>
  );
}
