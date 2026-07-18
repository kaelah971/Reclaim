import Link from "next/link";
import Button from "@/components/ui/Button";

export default function ForClientsPage() {
  return (
    <>
      <section className="bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-3xl">
            <span className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              For clients
            </span>
            <h1 className="mt-3 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
              Hold my funds safely until I receive what was agreed.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Paying a remote worker should not mean hoping for the best. Reclaim protects your cUSD until the work is delivered and approved.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Why a direct wallet transfer creates ambiguity
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            A wallet transfer proves that money moved from one address to another. It does not prove what the
            payment was for, what was promised in return, or whether the work was completed. When you pay a
            freelancer directly, you are trusting an informal agreement. If they do not deliver, you have no
            clear path to recover your funds.
          </p>

          <h2 className="mt-14 text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            How Reclaim protects you
          </h2>

          <div className="mt-8 space-y-8">
            {[
              {
                title: "Define clear deliverables",
                description:
                  "Before any cUSD is deposited, you specify the exact deliverable, deadline, release rule, and the evidence you expect to receive. The worker sees every term and must accept before the agreement is locked.",
              },
              {
                title: "Protect your funds",
                description:
                  "Your cUSD is held in escrow under the terms both sides reviewed. You cannot be debited twice. The worker cannot withdraw the funds without your approval or a reviewed settlement.",
              },
              {
                title: "Review evidence against the terms",
                description:
                  "When the worker submits delivery, you review the evidence against what was agreed. If the work matches the terms, you approve release and the funds transfer to the worker.",
              },
              {
                title: "Open a dispute when something is wrong",
                description:
                  "If the delivery does not meet the agreed terms, you open a dispute within the dispute window. The payment is frozen. Both sides submit claims and evidence.",
              },
              {
                title: "Receive a readable outcome",
                description:
                  "AI organizes the case. Independent reviewers assess it against the original terms. The contract settles the outcome on Celo. You receive a plain-language receipt explaining the result and how to verify it.",
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

          <div className="mt-14 rounded-[--radius-card] border border-border bg-input p-6">
            <p className="text-[15px] leading-relaxed text-ink">
              <strong>Reclaim does not side with either party.</strong> It holds funds to the agreed terms
              and provides a fair process when the parties disagree. The agreement, evidence, and timeline
              are visible to both sides throughout.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-primary py-16 text-center md:py-24">
        <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-page md:text-[44px]">
          Protect your next payment
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-gold-on-dark">
          Pay only under terms both sides can see.
        </p>
        <div className="mt-8">
          <Link href="/payments/new">
            <Button size="lg" className="bg-page text-primary hover:bg-hero">
              Protect a payment
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}
