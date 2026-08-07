"use client";

import { formatAgentBudget, computeBudgetPercent } from "./agent-mappings";

interface AgentBudgetCardProps {
  approvedAtomic: string;
  spentAtomic: string;
  reservedAtomic: string;
  remainingAtomic: string;
  caseWalletAddress: string;
}

export default function AgentBudgetCard({
  approvedAtomic,
  spentAtomic,
  reservedAtomic,
  remainingAtomic,
  caseWalletAddress,
}: AgentBudgetCardProps) {
  const budget = formatAgentBudget(approvedAtomic, spentAtomic, reservedAtomic, remainingAtomic);
  const spentPct = computeBudgetPercent(spentAtomic, approvedAtomic);

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Case Budget
      </h3>

      {/* Budget rows */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-muted">
            Approved
          </dt>
          <dd className="mt-0.5 text-[16px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
            {budget.approved}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-muted">
            Spent
          </dt>
          <dd className="mt-0.5 text-[16px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
            {budget.spent}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-muted">
            Reserved
          </dt>
          <dd className="mt-0.5 text-[16px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
            {budget.reserved}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-muted">
            Remaining
          </dt>
          <dd className="mt-0.5 text-[16px] font-[family-name:var(--font-ibm-plex-mono)] font-semibold tabular-nums text-success">
            {budget.remaining}
          </dd>
        </div>
      </dl>

      {/* Budget bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span>Spent</span>
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
            {spentPct}%
          </span>
        </div>
        <div className="mt-1 h-2 w-full rounded-full bg-border">
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-500"
            style={{ width: `${Math.min(spentPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Wallet address */}
      <div className="mt-4 border-t border-border pt-4">
        <span className="text-[12px] uppercase tracking-[0.08em] text-muted">
          Case Wallet
        </span>
        <p
          className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink break-all"
          title={caseWalletAddress}
        >
          {caseWalletAddress}
        </p>
      </div>
    </div>
  );
}
