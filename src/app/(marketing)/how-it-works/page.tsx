import Link from "next/link";
import Button from "@/components/ui/Button";
import AccordLine from "@/components/shared/AccordLine";
import type { AccordStage } from "@/components/shared/AccordLine";

const lifecycleSteps = [
  {
    step: "01",
    title: "Define the payment",
    description:
      "The client creates a protected payment: amount, worker wallet, deliverable, deadline, release rule, dispute window, and evidence expectation. Both sides can see the terms before any funds are deposited.",
  },
  {
    step: "02",
    title: "Review the terms",
    description:
      "The worker reviews every term. At this stage, the worker can accept or reject. Rejections require the client to adjust the terms. An optional x402 Terms Risk Check can flag missing deadlines or unclear deliverables.",
  },
  {
    step: "03",
    title: "Deposit cUSD",
    description:
      "Once terms are clear, the client deposits the full payment amount into escrow on Celo. The funds are protected under the exact terms both sides reviewed. The client cannot withdraw unilaterally while the agreement is active.",
  },
  {
    step: "04",
    title: "Accept the agreement",
    description:
      "After funds are protected, the worker formally accepts the agreement. At this point the terms, amount, and protection rules are locked. Both parties share one Payment Room with the same record.",
  },
  {
    step: "05",
    title: "Submit delivery evidence",
    description:
      "The worker delivers the work and submits evidence: files, links, messages, or a written record of completion. Evidence remains private and off-chain. A verification reference is recorded on Celo for later settlement verification.",
  },
  {
    step: "06",
    title: "Approve or dispute",
    description:
      "The client reviews the delivery against the terms. If the work meets the agreement, the client approves release and the funds transfer to the worker. If something is wrong, the client opens a dispute. The payment is frozen while the case is reviewed.",
  },
  {
    step: "07",
    title: "Review the case",
    description:
      "If disputed, both sides submit claims and evidence. AI organizes the case into a neutral packet: timelines, evidence inventory, contradictions, and unresolved questions. Independent reviewers assess the case against the original terms. AI does not decide the outcome.",
  },
  {
    step: "08",
    title: "Settle and record",
    description:
      "Reviewers vote: client wins, worker wins, or split. The contract executes the outcome on Celo. Both sides receive a plain-language receipt explaining what happened, who received what, and how to verify the settlement on-chain.",
  },
];

const afterSettlementStages: AccordStage[] = [
  { label: "Terms", state: "completed" },
  { label: "Funds", state: "completed" },
  { label: "Delivery", state: "completed" },
  { label: "Evidence", state: "completed" },
  { label: "Resolution", state: "completed" },
  { label: "Receipt", state: "completed" },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
              How Reclaim protects a payment
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted">
              Every protected payment follows the same lifecycle: from defining what the work is, through delivery and evidence, to settlement and a readable receipt.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-3xl space-y-14">
          {lifecycleSteps.map((item, i) => (
            <div key={item.step} className="flex gap-5 md:gap-8">
              <div className="shrink-0">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-gold">
                  {item.step}
                </span>
                {i < lifecycleSteps.length - 1 && (
                  <div className="mx-auto mt-2 h-10 w-[1.5px] bg-border" aria-hidden="true" />
                )}
              </div>
              <div className="pb-8">
                <h2 className="text-xl font-[family-name:var(--font-georama)] font-semibold text-ink">
                  {item.title}
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-page">
        <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
              What each side is responsible for
            </h2>

            <div className="mt-10 grid gap-8 md:grid-cols-2">
              <div className="rounded-[--radius-card] border border-border bg-surface p-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                  Client
                </h3>
                <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink">
                  <li>Define the deliverable, deadline, release rule, and evidence expectation clearly.</li>
                  <li>Deposit cUSD into escrow under the agreed terms.</li>
                  <li>Review delivery evidence against the terms.</li>
                  <li>Approve release or open a dispute within the dispute window.</li>
                </ul>
              </div>
              <div className="rounded-[--radius-card] border border-border bg-surface p-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                  Worker
                </h3>
                <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink">
                  <li>Read every term before accepting.</li>
                  <li>Deliver the agreed work by the deadline.</li>
                  <li>Submit delivery evidence that matches the evidence expectation in the terms.</li>
                  <li>Request release after submitting delivery.</li>
                  <li>Respond to a dispute with counter-evidence if needed.</li>
                </ul>
              </div>
            </div>

            <h2 className="mt-14 text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
              What Reclaim protects
            </h2>
            <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink">
              <li>&#x2022; Funds are held in escrow under terms both sides reviewed.</li>
              <li>&#x2022; The agreement is shared and visible. Neither side can change it unilaterally after acceptance.</li>
              <li>&#x2022; Evidence is organized against the terms so a dispute is legible, not a shouting match.</li>
              <li>&#x2022; AI prepares a neutral case. It does not decide the outcome.</li>
              <li>&#x2022; Independent reviewers assess the case against the original agreement.</li>
              <li>&#x2022; The contract settles the outcome on Celo. The result is transparent and verifiable.</li>
            </ul>

            <h2 className="mt-14 text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
              What Reclaim does not guarantee
            </h2>
            <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-muted">
              <li>&#x2022; Reclaim does not inspect the quality of the work. It provides terms, evidence comparison, and a fair review path.</li>
              <li>&#x2022; Reclaim does not replace legal advice. The product provides a payment-protection record, not a legal ruling.</li>
              <li>&#x2022; Reclaim does not intervene in merits. Reviewers assess claims against agreed terms and submitted evidence.</li>
            </ul>

            <h2 className="mt-14 text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
              Privacy and evidence
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted max-w-2xl">
              Delivery evidence remains private and off-chain. Files, messages, and working documents are not stored on Celo.
              A verification reference is recorded to allow settlement verification without exposing private content.
            </p>

            <div className="mt-14">
              <AccordLine stages={afterSettlementStages} />
            </div>

            <p className="mt-10 text-center text-[15px] leading-relaxed text-muted">
              At the end of every protected payment, both parties receive a plain-language receipt that explains the final outcome, who received what, relevant transaction references, and how to verify the settlement on Celo.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 text-center md:px-6 md:py-24">
        <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
          Ready to protect a payment?
        </h2>
        <p className="mt-3 text-lg leading-relaxed text-muted">
          Clear terms. Protected funds. One shared record.
        </p>
        <div className="mt-6">
          <Link href="/payments/new">
            <Button size="lg">Protect a payment</Button>
          </Link>
        </div>
      </section>
    </>
  );
}
