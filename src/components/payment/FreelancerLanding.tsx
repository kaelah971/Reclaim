"use client";

import WalletButton from "@/components/ui/WalletButton";
import StatusBadge from "@/components/ui/StatusBadge";
import { shortenAddress } from "@/hooks/wallet/useWalletState";
import type { PaymentData } from "@/lib/contracts/types";
import { getPaymentLifecycleLabel } from "./paymentLifecycle";

// ---------------------------------------------------------------------------
// FreelancerLanding — safe anonymous (read-only) room view (P4.3a).
//
// Shows only safe public details: Protected/agreement heading, amount/token,
// Celo network, shortened client/worker, lifecycle status, human terms, the
// exact "Your payment is protected in the Reclaim contract." sentence (only
// when funds are actually held — never for Created), a 5-step worker
// explainer, and Connect wallet. Never claims guaranteed funds.
// ---------------------------------------------------------------------------

interface FreelancerLandingProps {
  payment: PaymentData;
  amountLabel: string;
  tokenSymbol: string;
  networkName: string;
  className?: string;
}

const WORKER_STEPS = [
  "Connect your wallet to view this agreement.",
  "Review the deliverable, deadline, and release rule.",
  "Accept the terms to begin work.",
  "Deliver the work and submit your evidence.",
  "Request release so the client can review and release.",
] as const;

export default function FreelancerLanding({
  payment,
  amountLabel,
  tokenSymbol,
  networkName,
  className = "",
}: FreelancerLandingProps) {
  const lifecycleLabel = getPaymentLifecycleLabel(payment.state);
  const isFundedOrBeyond = payment.state !== "Created";
  const heading = isFundedOrBeyond ? "Protected payment" : "Payment agreement";

  return (
    <div className={`space-y-5 ${className}`}>
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[20px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            {heading}
          </h2>
          <StatusBadge
            variant={payment.state === "Created" ? "pending" : "protected"}
            label={lifecycleLabel}
          />
        </div>

        <p className="text-[15px] text-ink">
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium">
            {amountLabel} {tokenSymbol}
          </span>{" "}
          <span className="text-muted">on {networkName}</span>
        </p>

        <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-muted">Client</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {shortenAddress(payment.client)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Worker</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {shortenAddress(payment.worker)}
            </dd>
          </div>
        </dl>

        {payment.deliverableSummary && (
          <p className="text-[14px] leading-relaxed text-ink">
            <span className="text-muted">Work: </span>
            {payment.deliverableSummary}
          </p>
        )}
        {payment.releaseRule && (
          <p className="text-[14px] leading-relaxed text-ink">
            <span className="text-muted">Release: </span>
            {payment.releaseRule}
          </p>
        )}

        {isFundedOrBeyond ? (
          <p className="text-[14px] leading-relaxed text-ink">
            Your payment is protected in the Reclaim contract.
          </p>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            This agreement is not yet funded. Funds will be held in the Reclaim
            contract once the client deposits.
          </p>
        )}
      </div>

      <div className="rounded-[--radius-card] border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          How it works for you
        </h3>
        <ol className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink list-decimal list-inside">
          {WORKER_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="mt-4">
          <WalletButton />
        </div>
        <p className="mt-2 text-[13px] text-muted">
          Connect wallet to accept, submit evidence, or request release. The
          on-chain contract is the final authority on funds.
        </p>
      </div>
    </div>
  );
}

export { WORKER_STEPS };
