import Link from "next/link";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import AccordLine from "@/components/shared/AccordLine";
import type { AccordStage } from "@/components/shared/AccordLine";

const previewStages: AccordStage[] = [
  { label: "Terms", state: "completed" },
  { label: "Funds", state: "completed", statusLabel: "Protected", statusVariant: "protected" },
  { label: "Delivery", state: "active", statusLabel: "Due", statusVariant: "pending" },
  { label: "Evidence", state: "pending" },
  { label: "Resolution", state: "pending" },
  { label: "Receipt", state: "pending" },
];

const howItWorksSteps = [
  { label: "Define terms", description: "Both sides see the deliverable, the deadline, and the release rule before any money moves." },
  { label: "Protect funds", description: "cUSD is held in escrow under the agreed terms." },
  { label: "Deliver work", description: "The worker submits the agreed deliverable and delivery evidence." },
  { label: "Submit proof", description: "Evidence is organized and connected to the terms of the agreement." },
  { label: "Resolve fairly", description: "If there is a disagreement, AI prepares the case and reviewers decide the outcome." },
  { label: "Record settlement", description: "The settlement is executed on Celo and a plain-language receipt is issued." },
];

const trustItems = [
  { label: "Terms agreed" },
  { label: "Funds protected" },
  { label: "Evidence recorded" },
  { label: "Settlement visible" },
  { label: "Mobile ready" },
];

const x402Actions = [
  {
    title: "Terms Risk Check",
    price: "0.01 cUSD",
    description: "Before you deposit, check the terms for missing deadlines, vague deliverables, and unclear release rules.",
  },
  {
    title: "Evidence Strength Check",
    price: "0.01 cUSD",
    description: "Review the evidence against the agreed terms to identify missing proof or weak documentation.",
  },
  {
    title: "Dispute Packet",
    price: "0.03 cUSD",
    description: "Generate a neutral, reviewer-ready case packet with claims, timeline, evidence inventory, and unresolved questions.",
  },
];

const devSurfaces = [
  "Protected payment links",
  "Checkout component",
  "Escrow lifecycle API",
  "x402 Terms Risk Check",
  "x402 Evidence Strength Check",
  "x402 Dispute Packet",
  "Settlement receipts",
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 pb-20 pt-16 md:px-6 md:pb-28 md:pt-24">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <h1 className="text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
                Pay with proof.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted font-[family-name:var(--font-georama)]">
                Protect cUSD payments with clear terms, delivery evidence, fair review, and on-chain settlement.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/payments/new">
                  <Button size="lg">Protect a payment</Button>
                </Link>
                <Link href="/how-it-works">
                  <Button variant="secondary" size="lg">
                    See how it works
                  </Button>
                </Link>
              </div>
            </div>

            {/* Payment Room preview */}
            <div className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card] md:p-8">
              <div className="flex items-center justify-between mb-5">
                <span className="text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
                  Payment Room preview
                </span>
                <StatusBadge variant="protected" label="Funds protected" />
              </div>

              <div className="space-y-4">
                <div>
                  <span className="text-[13px] uppercase tracking-[0.1em] text-muted">Amount</span>
                  <p className="mt-1 text-2xl font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
                    100.00 cUSD
                  </p>
                </div>

                <div>
                  <span className="text-[13px] uppercase tracking-[0.1em] text-muted">Deliverable</span>
                  <p className="mt-1 text-[15px] text-ink">
                    Landing page Figma file with mobile design
                  </p>
                </div>

                <div className="flex gap-6 text-[13px]">
                  <div>
                    <span className="text-muted">Deadline</span>
                    <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
                      18 Jul 2026
                    </p>
                  </div>
                  <div>
                    <span className="text-muted">Release rule</span>
                    <p className="mt-0.5 text-ink">
                      Approval or 48-hour auto-release
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-[13px] uppercase tracking-[0.1em] text-muted">Evidence expected</span>
                  <p className="mt-1 text-[15px] text-ink">
                    Final files, revision record, agreed message thread
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <AccordLine stages={previewStages} />
              </div>

              <div className="mt-6 rounded-[--radius-button] border border-border bg-input px-4 py-3 text-center text-[15px] text-muted">
                Next: Awaiting delivery
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[15px] font-medium text-ink">
            {trustItems.map((item) => (
              <span key={item.label} className="flex items-center gap-2">
                <svg
                  className="shrink-0 text-success"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 8L6.5 11.5L13 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            A wallet transfer proves money moved.
          </h2>
          <p className="mt-4 text-xl leading-relaxed text-muted font-[family-name:var(--font-newsreader)] italic">
            It does not prove what was promised.
          </p>
          <p className="mt-6 text-[15px] leading-relaxed text-muted max-w-xl mx-auto">
            A client can pay a freelancer who never delivers. A freelancer can deliver work and have payment withheld. Reclaim turns a payment into a shared agreement that both sides can see, prove, and resolve.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-page border-y border-border">
        <div className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
          <h2 className="text-center text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            How it works
          </h2>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {howItWorksSteps.map((step, i) => (
              <div
                key={step.label}
                className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card]"
              >
                <span className="text-sm font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-gold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  {step.label}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {step.description}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-14">
            <AccordLine
              stages={[
                { label: "Terms", state: "completed" },
                { label: "Funds", state: "completed" },
                { label: "Delivery", state: "completed" },
                { label: "Evidence", state: "completed" },
                { label: "Resolution", state: "completed" },
                { label: "Receipt", state: "completed" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Client and worker */}
      <section className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div className="rounded-[--radius-card] border border-border bg-surface p-8 shadow-[--shadow-card]">
            <span className="text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
              For clients
            </span>
            <h3 className="mt-3 text-[22px] leading-tight font-[family-name:var(--font-newsreader)] font-medium text-ink">
              Pay only under terms both sides can see.
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Define the deliverable, deadline, and release rule. Funds stay protected until the work is approved. If something goes wrong, the case is prepared clearly for review.
            </p>
            <Link href="/for-clients" className="mt-5 inline-flex text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
              Learn more &rarr;
            </Link>
          </div>

          <div className="rounded-[--radius-card] border border-border bg-surface p-8 shadow-[--shadow-card]">
            <span className="text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
              For workers
            </span>
            <h3 className="mt-3 text-[22px] leading-tight font-[family-name:var(--font-newsreader)] font-medium text-ink">
              Prove delivery and receive a fair release.
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              See that funds are protected before you begin. Submit evidence of delivery, request release, and rely on a neutral review process if the client withholds payment.
            </p>
            <Link href="/for-workers" className="mt-5 inline-flex text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
              Learn more &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* Payment Room explanation */}
      <section className="border-y border-border bg-page">
        <div className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
          <h2 className="text-center text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            One shared Payment Room
          </h2>
          <p className="mt-4 text-center text-lg leading-relaxed text-muted max-w-2xl mx-auto">
            Everything both parties need to see in one place: the agreement, the money state, the evidence, and what happens next.
          </p>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Agreement",
                description: "Deliverable, deadline, release rule, dispute window, and evidence expectation. Visible to both sides before any funds are deposited.",
              },
              {
                title: "Money state",
                description: "Amount, cUSD, escrow status, and relevant deadlines. A sticky strip keeps the payment state visible throughout the Payment Room.",
              },
              {
                title: "Evidence",
                description: "Delivery proof connected to the terms. Evidence remains private and off-chain. A verification reference is recorded on Celo.",
              },
              {
                title: "Dispute",
                description: "If the parties disagree, the payment is frozen. AI organizes the claims and evidence into a neutral case packet for human review.",
              },
              {
                title: "Settlement",
                description: "Reviewers vote. The contract executes the outcome: funds release to the worker, return to the client, or split as decided.",
              },
              {
                title: "Receipt",
                description: "A plain-language document explains the final outcome, participating wallets, relevant actions, and a Celo verification link.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[--radius-card] border border-border bg-surface p-6"
              >
                <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI section */}
      <section className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            AI prepares the case. People decide. The contract settles.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Reclaim uses AI to organize claims, build timelines, separate positions, and identify missing evidence. It does not decide who wins.
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Organise claims",
                description: "Distinguish the client claim from the worker claim and structure the disagreement clearly.",
              },
              {
                title: "Build timeline",
                description: "Map what happened and when across the full lifecycle of the payment.",
              },
              {
                title: "Flag gaps",
                description: "Identify missing evidence, contradictions, and unresolved questions for reviewers to consider.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[--radius-card] border border-border bg-surface p-6 text-left"
              >
                <h3 className="text-[15px] font-semibold text-ink">
                  {item.title}
                </h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* x402 section */}
      <section className="border-y border-border bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
          <h2 className="text-center text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Paid protection actions
          </h2>
          <p className="mt-4 text-center text-lg leading-relaxed text-muted max-w-2xl mx-auto">
            Every x402 action produces a concrete output you can use to protect a payment. You pay only when you need it.
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {x402Actions.map((action) => (
              <div
                key={action.title}
                className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card]"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                    {action.title}
                  </h3>
                  <span className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-gold">
                    {action.price}
                  </span>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">
                  {action.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Developer section */}
      <section className="mx-auto max-w-[1440px] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Built for integration
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Reclaim is designed as a plug-and-play protected payment layer for apps, marketplaces, and agentic commerce.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {devSurfaces.map((surface) => (
              <span
                key={surface}
                className="rounded-[--radius-pill] border border-border bg-input px-4 py-2 text-[14px] font-medium text-ink"
              >
                {surface}
              </span>
            ))}
          </div>

          <div className="mt-8">
            <Link href="/developers">
              <Button variant="secondary">Explore developer options</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-primary">
        <div className="mx-auto max-w-[1440px] px-4 py-20 text-center md:px-6 md:py-28">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-page md:text-[44px]">
            Protect the agreement behind the payment.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gold-on-dark max-w-xl mx-auto">
            Clear terms. Protected funds. One shared record from agreement through settlement.
          </p>
          <div className="mt-8">
            <Link href="/payments/new">
              <Button
                size="lg"
                className="bg-page text-primary hover:bg-hero"
              >
                Protect a payment
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
