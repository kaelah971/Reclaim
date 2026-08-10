"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

export default function ForWorkersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <section className="ledger-field">
        <div className="ledger-content mx-auto max-w-[1440px] px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-20">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="max-w-3xl">
            <span className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              For workers
            </span>
            <h1 className="mt-3 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
              Let me prove I delivered and get paid fairly.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              You should be paid for work you completed. Reclaim ensures the funds exist before you start and gives you a clear path to release when you deliver.
            </p>
            </div>

            <div className="paper-stack relative hidden min-h-[340px] lg:block">
              <div className="document-card relative z-10 ml-auto mt-12 max-w-[520px] rounded-[--radius-card] p-6">
                <p className="text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
                  Worker room
                </p>
                <h2 className="mt-2 font-[family-name:var(--font-newsreader)] text-[26px] font-medium text-ink">
                  Funds are visible before work begins
                </h2>
                <div className="mt-6 rounded-[--radius-input] border border-border bg-input p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-muted">Escrow state</span>
                    <span className="font-[family-name:var(--font-ibm-plex-mono)] text-[13px] font-medium tabular-nums text-success">
                      100.00 USDC protected
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px] text-muted">
                  {["Accept terms", "Submit evidence", "Request release"].map((item) => (
                    <span key={item} className="rounded-[--radius-button] border border-border bg-surface px-3 py-2">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            How Reclaim protects you
          </h2>

          <div className="mt-8 space-y-8">
            {[
              {
                title: "Proof that funds exist before you start",
                description:
                  "Before you accept an agreement, the client defines the terms, and you can see the payment amount in USDC. Once the client deposits, the funds are visible in escrow. You know the money is there before you begin the work.",
              },
              {
                title: "Accepted terms you can rely on",
                description:
                  "You review and accept every term: deliverable, deadline, release rule, dispute window, and evidence expectation. After acceptance, the terms are locked. The client cannot change them unilaterally.",
              },
              {
                title: "Submit delivery evidence on your terms",
                description:
                  "After you deliver the work, you submit evidence that matches the evidence expectation you agreed to: files, links, messages, or a written record. Your evidence stays private and off-chain.",
              },
              {
                title: "Request release with a clear deadline",
                description:
                  "You request release after submitting delivery. If the client approves, the funds transfer to your wallet. If the client does not act within the defined window, the auto-release rule takes effect.",
              },
              {
                title: "Protected from unreasonable withholding",
                description:
                  "If a client withholds payment without cause, you have a neutral review path. The client must present a claim based on the agreed terms. AI organizes the evidence. Independent reviewers assess the case against what was actually agreed.",
              },
              {
                title: "Visible settlement and receipt",
                description:
                  "Whether the payment is released directly or through a review, the outcome is visible and verifiable on Celo. You receive a receipt that explains the result in plain language.",
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
              <strong>Reclaim does not side with either party.</strong> It gives you a visible record of what
              was agreed, proof of delivery, and a fair process if the client disputes. The agreement is shared
              and visible to both sides throughout.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-page py-16 text-center md:py-24">
        <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Work with confidence
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-muted">
          Prove delivery and receive a fair release.
        </p>
        <div className="mt-8">
          <Button
            variant="primary"
            size="lg"
            onClick={() => setDialogOpen(true)}
          >
            Ask a client to use Reclaim
          </Button>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Share Reclaim"
        primaryLabel="Got it"
        onPrimary={() => setDialogOpen(false)}
      >
        <p>Protected payment links will be enabled during product integration.</p>
      </Dialog>
    </>
  );
}
