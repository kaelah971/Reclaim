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

const x402Actions = [
  {
    title: "Terms Risk Check",
    price: "0.01 USDC",
    description: "Before you deposit, check the terms for missing deadlines, vague deliverables, and unclear release rules.",
  },
  {
    title: "Evidence Strength Check",
    price: "0.01 USDC",
    description: "Review the evidence against the agreed terms to identify missing proof or weak documentation.",
  },
  {
    title: "Dispute Packet",
    price: "0.03 USDC",
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
      <section className="ledger-field" data-testid="hero">
        <div className="ledger-content mx-auto max-w-[1440px] px-4 pb-20 pt-16 md:px-6 md:pb-28 md:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
            <div className="flex flex-col justify-center">
              <div className="mb-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                <span className="h-px w-10 bg-gold" aria-hidden="true" />
                Pay with proof.
              </div>
              <h1 className="max-w-[620px] text-[44px] leading-[1.02] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[68px]">
                Protected stablecoin payments for freelance work.
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted font-[family-name:var(--font-georama)] md:text-base">
                Pay with proof. Agree on the work and the price upfront, keep
                the payment protected while the work gets done, and release it
                when everyone is happy.
              </p>
              <ol
                className="mt-6 max-w-lg space-y-3 border-t border-border pt-5"
                aria-label="How protection works"
              >
                {[
                  [
                    "1. Protect the payment",
                    "Agree on the work, price, and deadline before anything moves.",
                  ],
                  [
                    "2. Freelancer delivers",
                    "The freelancer does the work and shares what was done.",
                  ],
                  [
                    "3. Release when the work is done",
                    "Approve the work and the payment is released.",
                  ],
                ].map(([title, detail]) => (
                  <li key={title} className="flex flex-col gap-0.5">
                    <p className="text-[15px] font-semibold text-ink font-[family-name:var(--font-georama)]">
                      {title}
                    </p>
                    <p className="text-[13px] leading-relaxed text-muted font-[family-name:var(--font-georama)]">
                      {detail}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/payments/new">
                  <Button size="lg">Protect a payment</Button>
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <Link
                  href="/how-it-works"
                  className="text-[15px] font-medium text-gold underline-offset-4 transition-colors hover:text-gold/80 hover:underline"
                >
                  See how it works
                </Link>
                <Link
                  href="/payments/1"
                  className="text-[15px] font-medium text-gold underline-offset-4 transition-colors hover:text-gold/80 hover:underline"
                >
                  Explore the live demo case
                </Link>
              </div>
              <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-muted font-[family-name:var(--font-georama)]">
                Take a look at a finished example to see what both sides see,
                from agreement through to the final record.
              </p>
            </div>

            {/* Payment Room preview */}
            <div className="paper-stack min-h-[650px] w-full min-w-0">
              <div className="ledger-content relative ml-auto w-full min-w-0 max-w-[620px]">
                <div
                  className="proof-card-stack mb-8 ml-auto"
                  aria-label="Payment proof document stack"
                >
                  <article className="document-card proof-card proof-card--terms">
                    <p className="proof-card__label">Agreement</p>
                    <p className="proof-card__title">Terms locked</p>
                    <p className="proof-card__detail">100.00 USDC | Release after approval</p>
                  </article>

                  <article className="document-card proof-card proof-card--evidence">
                    <p className="proof-card__label">Evidence</p>
                    <p className="proof-card__title">4 proof items recorded</p>
                    <p className="proof-card__detail">Final files | Revisions | Approval note</p>
                  </article>

                  <article className="document-card proof-card proof-card--receipt">
                    <p className="proof-card__label">Settlement</p>
                    <p className="proof-card__title">Receipt ready</p>
                    <p className="proof-card__detail">Readable record | Verified on Celo</p>
                  </article>
                </div>

                <div
                  className="document-card relative z-10 ml-auto w-full min-w-0 max-w-[560px] overflow-hidden rounded-[--radius-card] p-5 md:p-6"
                  data-testid="hero-preview"
                  aria-label="Example preview of a protected payment. Static preview, not interactive."
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <span className="inline-flex items-center rounded-[--radius-pill] border border-border bg-input px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                        Example
                      </span>
                      <p className="mt-2 text-sm font-[family-name:var(--font-newsreader)] text-ink">
                        A protected payment, previewed
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        Preview of sample details — not interactive
                      </p>
                    </div>
                    <StatusBadge variant="protected" label="Funds ready" />
                  </div>

                  <dl className="space-y-4">
                    <div>
                      <dt className="text-[11px] text-muted">Amount</dt>
                      <dd className="mt-1 font-[family-name:var(--font-ibm-plex-mono)] text-[13px] tabular-nums text-ink">
                        100.00 USDC
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Deadline</dt>
                      <dd className="mt-1 font-[family-name:var(--font-ibm-plex-mono)] text-[13px] tabular-nums text-ink">
                        18 Jul 2026
                      </dd>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[12px] text-muted">
                      {["Terms", "Release rule", "Evidence", "Receipt"].map((item) => (
                        <span
                          key={item}
                          className="rounded-[--radius-button] border border-border bg-surface px-3 py-2"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </dl>

                  <div className="mt-5">
                    <AccordLine stages={previewStages} />
                  </div>
                </div>

              </div>
            </div>
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

      {/* Final CTA — quiet repeat of the single primary action; the hero holds the one dominant CTA */}
      <section className="bg-primary" data-testid="final-cta">
        <div className="mx-auto max-w-[1440px] px-4 py-20 text-center md:px-6 md:py-28">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-page md:text-[44px]">
            Protect the agreement behind the payment.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gold-on-dark max-w-xl mx-auto">
            Clear terms. Protected funds. One shared record from agreement through settlement.
          </p>
          <div className="mt-8">
            <Link
              href="/payments/new"
              className="inline-flex items-center gap-2 text-[15px] font-medium text-gold-on-dark underline-offset-4 transition-colors hover:text-page hover:underline"
            >
              Protect a payment <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
