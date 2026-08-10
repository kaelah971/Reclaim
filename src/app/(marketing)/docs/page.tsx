import Link from "next/link";
import AccordLine from "@/components/shared/AccordLine";
import Button from "@/components/ui/Button";

const howItWorksSteps = [
  { label: "Define terms", description: "Both sides see the deliverable, the deadline, and the release rule before any money moves." },
  { label: "Protect funds", description: "USDC is held in escrow under the agreed terms." },
  { label: "Deliver work", description: "The worker submits the agreed deliverable and delivery evidence." },
  { label: "Submit proof", description: "Evidence is organized and connected to the terms of the agreement." },
  { label: "Resolve fairly", description: "If there is a disagreement, AI prepares the case and reviewers decide the outcome." },
  { label: "Record settlement", description: "The settlement is executed on Celo and a plain-language receipt is issued." },
];

const paymentRoomItems = [
  {
    title: "Agreement",
    description: "Deliverable, deadline, release rule, dispute window, and evidence expectation. Visible to both sides before any funds are deposited.",
  },
  {
    title: "Money state",
    description: "Amount, USDC, escrow status, and relevant deadlines. A sticky strip keeps the payment state visible throughout the Payment Room.",
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
];

const casePreparationItems = [
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
];

export default function DocsPage() {
  return (
    <>
      <section className="ledger-field border-b border-border">
        <div className="ledger-content mx-auto max-w-[1440px] px-4 py-14 md:px-6 md:py-20">
          <div className="max-w-3xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold">
              Reclaim docs
            </p>
            <h1 className="mt-4 text-[42px] leading-[1.05] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[58px]">
              The protected payment guide
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted md:text-lg">
              A concise guide to the payment lifecycle, the shared Payment Room,
              and how disputed cases are prepared for human review.
            </p>
            <div className="mt-7">
              <Link href="/payments/new">
                <Button size="lg">Protect a payment</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-page">
        <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
          <h2 className="text-center text-[28px] leading-[1.2] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            How it works
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {howItWorksSteps.map((step, index) => (
              <article key={step.label} className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card]">
                <span className="font-[family-name:var(--font-ibm-plex-mono)] text-sm tabular-nums text-gold">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-lg font-semibold text-ink">{step.label}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{step.description}</p>
              </article>
            ))}
          </div>
          <div className="mt-12">
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

      <section className="border-b border-border bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-[28px] leading-[1.2] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
              One shared Payment Room
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Everything both parties need to see in one place: the agreement, the money state, the evidence, and what happens next.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {paymentRoomItems.map((item) => (
              <article key={item.title} className="rounded-[--radius-card] border border-border bg-surface p-6">
                <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-[28px] leading-[1.2] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            AI prepares the case. People decide. The contract settles.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-lg leading-relaxed text-muted">
            Reclaim uses AI to organize claims, build timelines, separate positions, and identify missing evidence. It does not decide who wins.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {casePreparationItems.map((item) => (
              <article key={item.title} className="rounded-[--radius-card] border border-border bg-surface p-6 text-left">
                <h3 className="text-[15px] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{item.description}</p>
              </article>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/payments/new">
              <Button size="lg">Protect a payment</Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
