"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import ReceiptHeader from "@/components/receipt/ReceiptHeader";
import AllocationBreakdown from "@/components/receipt/AllocationBreakdown";
import ParticipantSummary from "@/components/receipt/ParticipantSummary";
import AgreementSummary from "@/components/payment/AgreementSummary";
import AccordLine from "@/components/shared/AccordLine";
import type { AccordStage } from "@/components/shared/AccordLine";
import ReviewResult from "@/components/receipt/ReviewResult";
import TransactionReference from "@/components/receipt/TransactionReference";
import type { TransactionRef } from "@/components/receipt/TransactionReference";
import VerificationSummary from "@/components/receipt/VerificationSummary";
import PrintReceiptButton from "@/components/receipt/PrintReceiptButton";
import type { ReceiptData } from "@/lib/receipt/types";

// ---------------------------------------------------------------------------
// /receipts/[receiptId] — FINAL SETTLEMENT RECEIPT (read-only, durable)
//
// The settlement receipt of a released payment, composed from durable
// verified sources only: on-chain escrow state + release/evidence tx proofs,
// verified evidence metadata, and the resolution agent's durable review
// packet (incl. recorded QC-vs-verified-evidence inconsistencies).
//
// READ-ONLY BY DESIGN: no wallet connection, no signing, no mutation.
// Missing sources render as "Pending" — nothing is fabricated.
// ---------------------------------------------------------------------------

const accordStages: AccordStage[] = [
  { label: "Terms", state: "completed" },
  { label: "Funds", state: "completed" },
  { label: "Delivery", state: "completed" },
  { label: "Evidence", state: "completed" },
  { label: "Resolution", state: "completed" },
  { label: "Receipt", state: "completed" },
];

export default function ReceiptDetailPage() {
  const params = useParams<{ receiptId: string }>();
  const paymentIdStr = params?.receiptId ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!paymentIdStr) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/payments/${paymentIdStr}/receipt`);
        if (!res.ok) throw new Error(`Failed to load receipt (HTTP ${res.status})`);
        const json = (await res.json()) as ReceiptData;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load receipt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [paymentIdStr]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{error}</p>
        </Notice>
        <Link href="/payments">
          <Button variant="secondary" className="mt-4">
            Return to payments
          </Button>
        </Link>
      </div>
    );
  }

  const receipt = data?.receipt;
  const pp = receipt?.protectedPayment;
  const agreement = receipt?.agreement;
  const ev = receipt?.evidence;
  const agent = receipt?.resolutionAgent;
  const qc = receipt?.qualityCheck;
  const decision = receipt?.humanDecision;
  const audit = receipt?.audit;
  const links = audit?.explorerLinks;

  if (!data?.found || !receipt) {
    return (
      <>
        <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
          <Notice variant="info">
            <p className="text-[14px] leading-relaxed">
              This settlement receipt is not available yet. Receipts appear
              after a protected payment is released.
            </p>
          </Notice>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/receipts">
              <Button variant="secondary">Return to receipts</Button>
            </Link>
            <Link href={`/payments/${paymentIdStr}`}>
              <Button>Return to Payment Room</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  const txRefs: TransactionRef[] = [
    {
      label: "Evidence submission (Sepolia)",
      reference: ev?.submissionTxHash ?? undefined,
    },
    {
      label: "Release transaction (Sepolia)",
      reference: decision?.txHash ?? undefined,
    },
    {
      label: "x402 QC settlement (Mainnet)",
      reference: qc?.settlementTxHash ?? undefined,
    },
    {
      label: "Evidence reference",
      reference: ev?.evidenceReference ?? undefined,
    },
    {
      label: "QC payment reference",
      reference: qc?.paymentReference ?? undefined,
    },
    {
      label: "QC result reference",
      reference: qc?.resultReference ?? undefined,
    },
  ];

  const outcome =
    pp?.finalState === "Released"
      ? "Released to the worker"
      : pp?.finalState ?? "Awaiting integration";

  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <nav className="mb-6">
          <Link
            href={`/payments/${paymentIdStr}`}
            className="text-[13px] text-muted hover:text-ink transition-colors"
          >
            &larr; Back to Payment Room
          </Link>
        </nav>

        <div className="mx-auto max-w-3xl">
          <article className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card] md:p-8 print:shadow-none print:border-0">
            <ReceiptHeader
              receiptTitle={`Settlement receipt — Payment #${pp?.paymentId ?? paymentIdStr}`}
              outcome={outcome}
              outcomeVariant={pp?.finalState === "Released" ? "settled" : "pending"}
              settlementDate={pp?.releasedAt ?? undefined}
              paymentRef={`Payment #${pp?.paymentId ?? paymentIdStr} · ${pp?.network ?? ""}`}
              verificationStatus="Verified on-chain"
            />

            {/* Plain-language outcome */}
            <div className="mt-8 rounded-[--radius-card] border border-border bg-page p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Outcome
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink">
                {pp?.finalState === "Released" ? (
                  <>
                    The protected amount was released to the worker after the
                    client approved the release. The resolution agent prepared
                    the case; a person made the final decision.
                  </>
                ) : (
                  "The settlement outcome will appear here once the payment is released."
                )}
              </p>
              <p className="mt-2 text-[13px] text-muted">
                {receipt.productModel}
              </p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <AllocationBreakdown
                protectedAmount={pp?.amountHuman?.split(" ")[0] ?? undefined}
                asset={pp?.asset ?? "USDC"}
                clientAllocation={
                  pp?.finalState === "Released"
                    ? "0.00"
                    : undefined
                }
                workerAllocation={
                  pp?.finalState === "Released"
                    ? pp?.amountHuman?.split(" ")[0] ?? undefined
                    : undefined
                }
              />
              <ParticipantSummary
                clientWallet={pp?.client ?? undefined}
                workerWallet={pp?.worker ?? undefined}
              />
            </div>

            <div className="mt-8">
              <AgreementSummary
                clientWallet={pp?.client}
                workerWallet={pp?.worker}
                deliverable={agreement?.deliverable ?? undefined}
                deliveryFormat={agreement?.deliveryFormat ?? undefined}
                deadline={agreement?.deadline ?? undefined}
                releaseRule={agreement?.releaseRule ?? undefined}
                disputeWindow={
                  agreement?.disputeWindowSeconds
                    ? `${agreement.disputeWindowSeconds} seconds`
                    : undefined
                }
                evidenceExpectation={agreement?.evidenceExpectation ?? undefined}
              />
            </div>

            <div className="mt-8">
              <AccordLine stages={accordStages} />
            </div>

            {/* Evidence record */}
            <div className="mt-8">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-4">
                Evidence record
              </h3>
              <dl className="space-y-2 text-[14px]">
                <Row label="Title" value={ev?.title ?? null} />
                {ev?.claim ? <Row label="Claim" value={ev.claim} /> : null}
                {ev?.date ? <Row label="Date" value={ev.date} /> : null}
                {ev?.pastedText ? <Row label="Pasted text" value={ev.pastedText} /> : null}
                <Row label="Availability" value={ev?.availability ?? null} />
                <Row label="Submitter" value={ev?.submitter ?? null} />
                {ev?.submittedAt ? (
                  <Row label="Submitted at" value={ev.submittedAt} mono />
                ) : null}
                <Row label="Reference" value={ev?.evidenceReference ?? null} mono breakAll />
              </dl>
            </div>

            {/* Resolution record — agent + x402 QC + human decision */}
            <div className="mt-8 rounded-[--radius-card] border border-border bg-surface p-6">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Resolution record
              </h3>
              <dl className="mt-4 space-y-2 text-[14px]">
                <Row label="Agent" value={agent?.agentId ?? null} mono breakAll />
                <Row label="Objective" value={agent?.objective ?? null} />
                <Row label="Statement" value={agent?.statement ?? null} />
                <Row label="QC tool" value={qc?.toolId ?? null} mono />
                <Row label="QC price" value={qc?.priceHuman ?? null} />
                <Row label="QC network" value={qc?.network ?? null} />
                <Row label="Facilitator" value={qc?.facilitatorUrl ?? null} mono breakAll />
                <Row label="QC request" value={qc?.executionRequestHash ?? null} mono breakAll />
                <Row label="Decision" value={decision?.decision ?? null} />
                <Row label="Decision authority" value={decision?.authority ?? null} />
                <Row label="Release tx" value={decision?.txHash ?? null} mono breakAll />
                <Row label="Final recipient" value={decision?.finalRecipient ?? null} mono breakAll />
                <Row label="Outcome" value={decision?.outcome ?? null} />
              </dl>
              {Array.isArray(qc?.inconsistencies) && qc!.inconsistencies.length > 0 && (
                <div className="mt-3 rounded-[--radius] border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
                  <p className="font-semibold">
                    QC ran before the verified facts were available
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {qc!.inconsistencies.map((inc, i) => (
                      <li key={i}>{inc}</li>
                    ))}
                  </ul>
                </div>
              )}
              {agent?.caseVersionHash || agent?.evidenceVersionHash ? (
                <dl className="mt-4 space-y-2 text-[14px]">
                  {agent?.caseVersionHash ? (
                    <Row label="Case version hash" value={agent.caseVersionHash} mono breakAll />
                  ) : null}
                  {agent?.evidenceVersionHash ? (
                    <Row label="Evidence version hash" value={agent.evidenceVersionHash} mono breakAll />
                  ) : null}
                </dl>
              ) : null}
            </div>

            {/* Review result (plain language) */}
            <div className="mt-8">
              <ReviewResult
                finalRuling={
                  pp?.finalState === "Released"
                    ? "Released — approved by the client"
                    : undefined
                }
                reviewerCount={undefined}
                reviewNote={
                  pp?.finalState === "Released"
                    ? "The agent prepared the case. A person made the final decision."
                    : undefined
                }
              />
            </div>

            <div className="mt-8">
              <TransactionReference items={txRefs} />
            </div>

            <div className="mt-8">
              <VerificationSummary />
            </div>

            {links ? (
              <div className="mt-8 border-t border-border pt-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-3">
                  Audit links
                </h3>
                <div className="space-y-1 text-[13px]">
                  {links.releaseTransaction ? (
                    <AuditLink label="Release transaction (Sepolia)" href={links.releaseTransaction} />
                  ) : null}
                  {links.evidenceSubmissionTransaction ? (
                    <AuditLink label="Evidence submission (Sepolia)" href={links.evidenceSubmissionTransaction} />
                  ) : null}
                  {links.x402SettlementTransaction ? (
                    <AuditLink label="x402 QC settlement (Mainnet)" href={links.x402SettlementTransaction} />
                  ) : null}
                  {links.escrowContract ? (
                    <AuditLink label="Escrow contract" href={links.escrowContract} />
                  ) : null}
                  {links.client ? <AuditLink label="Client wallet" href={links.client} /> : null}
                  {links.worker ? <AuditLink label="Worker wallet" href={links.worker} /> : null}
                </div>
              </div>
            ) : null}

            <div className="mt-8 border-t border-border pt-6">
              <PrintReceiptButton />
            </div>
          </article>
        </div>
      </div>
    </>
  );
}

function AuditLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block text-gold hover:text-gold/80 transition-colors break-all"
    >
      {label} — {href}
    </a>
  );
}

function Row({
  label,
  value,
  mono = false,
  breakAll = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[12px] uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd
        className={`text-right text-ink ${
          mono ? "font-[family-name:var(--font-ibm-plex-mono)] text-[13px]" : ""
        } ${breakAll ? "break-all" : ""}`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
