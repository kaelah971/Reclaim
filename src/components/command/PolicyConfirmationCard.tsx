"use client";

import Button from "@/components/ui/Button";
import type { PaymentPolicy } from "@/lib/command/paymentIntent";

// ---------------------------------------------------------------------------
// PolicyConfirmationCard — structured confirmation before any transaction
// (P6.1). Renders validated policy values only. NOTHING executes here: the
// user must explicitly click Protect, which hands into the existing
// review/protection flow. Edit details reuses the structured wizard.
// ---------------------------------------------------------------------------

interface PolicyConfirmationCardProps {
  policy: PaymentPolicy;
  deadlineLabel?: string;
  onProtect: () => void;
  onEdit: () => void;
}

export default function PolicyConfirmationCard({
  policy,
  deadlineLabel,
  onProtect,
  onEdit,
}: PolicyConfirmationCardProps) {
  const protectLabel = `Protect ${policy.amountHuman} ${policy.asset}`;
  const networkLabel =
    policy.chainId === 42220 ? "Celo" : "Celo Sepolia";
  const releaseLabel =
    policy.releaseMode === "agent_assisted"
      ? "Agent-assisted — client approval required"
      : "Client approval required";

  return (
    <section
      aria-label="Payment policy confirmation"
      className="rounded-[--radius-card] border border-border bg-surface p-6 md:p-8"
    >
      <h2 className="text-[20px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
        Review this protected payment
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        Reclaim understood your command as the policy below. Nothing moves
        until you confirm.
      </p>

      <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 text-[14px]">
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Payment
          </dt>
          <dd className="mt-1 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
            {policy.amountHuman} {policy.asset} → {policy.worker}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Purpose
          </dt>
          <dd className="mt-1 text-ink">{policy.title}</dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Deliverables
          </dt>
          <dd className="mt-1 text-ink">
            {policy.deliverables.length > 0
              ? policy.deliverables.join("; ")
              : policy.deliverableSummary}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Deadline
          </dt>
          <dd className="mt-1 font-[family-name:var(--font-ibm-plex-mono)] text-ink">
            {deadlineLabel ?? policy.deadlineDate}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Release
          </dt>
          <dd className="mt-1 text-ink">{releaseLabel}</dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Evidence
          </dt>
          <dd className="mt-1 text-ink">
            {policy.evidenceRequirements.length > 0
              ? policy.evidenceRequirements.join("; ")
              : "Delivery note / files / links as applicable"}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Network
          </dt>
          <dd className="mt-1 text-ink">{networkLabel}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onProtect}>
          {protectLabel}
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          Edit details
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-muted">
        Protect continues into the existing review flow — you approve the exact
        amount and lock the funds with your wallet. The assistant never sends
        transactions.
      </p>
    </section>
  );
}
