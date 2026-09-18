"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { parseChainIdParam } from "@/components/payment/paymentLifecycle";

// ---------------------------------------------------------------------------
// /payments/[paymentId]/review — HUMAN review of the prepared case
//
// Displays the resolution agent's durable review packet (review_packet_prepared)
// and the REAL human decision controls supported by the contract model:
//   - client  : approveRelease (release escrow to the worker) / openDispute
//   - worker  : openDispute (requestRelease remains in the Payment Room)
//
// The agent prepares the case; a PERSON makes the final decision. Decision
// buttons only open a confirmation step and route to the EXISTING wallet
// flows — nothing is signed or executed from this page.
// ---------------------------------------------------------------------------

interface ReviewPacketData {
  found: boolean;
  paymentId?: string;
  agentId?: string;
  packetEventId?: string;
  packetCreatedAt?: string;
  packet?: {
    schemaVersion?: string;
    preparedBy?: { agentId?: string; objective?: string };
    disclaimer?: string;
    case?: {
      escrowChainId?: string;
      escrowContractAddress?: string;
      escrowPaymentId?: string;
      state?: string;
      client?: string;
      worker?: string;
      amountAtomic?: string;
    };
    evidence?: {
      evidenceReference?: string;
      title?: string | null;
      evidenceType?: string | null;
      description?: string | null;
      fileCount?: number;
      availability?: string;
      substantiveEvidence?: boolean;
      caseVersionHash?: string | null;
      evidenceVersionHash?: string | null;
      relatedClaim?: string | null;
      pastedText?: string | null;
      evidenceDate?: string | null;
      externalRef?: string | null;
      fileHash?: string | null;
    };
    qualityCheck?: {
      toolId?: string;
      executionRequestHash?: string;
      readiness?: string;
      missingEvidence?: string[];
      ambiguities?: string[];
      reviewerQuestions?: string[];
      recommendedImprovements?: string[];
      settlementTxHash?: string | null;
      paymentReference?: string | null;
      resultReference?: string | null;
    };
    qcInconsistency?: string[];
    decision?: string;
  };
}

type ConfirmKind = "approve" | "dispute" | null;

export default function ReviewPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ReviewContent />
    </Suspense>
  );
}

function ReviewContent() {
  const params = useParams<{ paymentId: string }>();
  const searchParams = useSearchParams();
  const paymentIdStr = params?.paymentId ?? "";
  // Preserve-or-propagate ?chainId=: only when explicitly present in the URL
  // (keeps default/Sepolia links byte-identical when absent).
  const chainIdRaw = searchParams?.get("chainId");
  const chainResolution = useMemo(
    () => parseChainIdParam(chainIdRaw),
    [chainIdRaw],
  );
  const explicitChainId =
    chainResolution.status === "explicit"
      ? chainResolution.chainId
      : undefined;
  const chainQuery =
    explicitChainId !== undefined ? `?chainId=${explicitChainId}` : "";
  const wallet = useWalletState();
  const { data: payment, isLoading } = usePayment(
    paymentIdStr ? BigInt(paymentIdStr) : undefined,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packetData, setPacketData] = useState<ReviewPacketData | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!paymentIdStr) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/payments/${paymentIdStr}/review-packet${chainQuery}`,
        );
        if (!res.ok) throw new Error(`Failed to load review packet (HTTP ${res.status})`);
        const data = (await res.json()) as ReviewPacketData;
        if (!cancelled) setPacketData(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load review packet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [paymentIdStr, chainQuery]);

  const packet = packetData?.packet;
  const qc = packet?.qualityCheck;
  const qcPacket = packet;
  const evidence = packet?.evidence;
  const escrow = packet?.case;

  const isClient =
    wallet.isConnected &&
    wallet.address !== undefined &&
    payment?.client?.toLowerCase() === wallet.address.toLowerCase();
  const isWorker =
    wallet.isConnected &&
    wallet.address !== undefined &&
    payment?.worker?.toLowerCase() === wallet.address.toLowerCase();

  if (loading || isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{error}</p>
        </Notice>
        <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
          <Button variant="secondary" className="mt-4">
            Return to Payment Room
          </Button>
        </Link>
      </div>
    );
  }

  if (!packetData?.found || !packet) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            No review packet has been prepared for this payment yet.
          </p>
        </Notice>
        <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
          <Button variant="secondary" className="mt-4">
            Return to Payment Room
          </Button>
        </Link>
      </div>
    );
  }

  const humanDecision = "The agent prepared this case. A person makes the final decision.";

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
      <nav className="mb-6">
        <Link
          href={`/payments/${paymentIdStr}${chainQuery}`}
          className="text-[13px] text-muted hover:text-ink transition-colors"
        >
          &larr; Back to Payment Room
        </Link>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Case review — Payment #{paymentIdStr}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Prepared by Resolution Agent{" "}
            <span className="font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
              {packetData.agentId}
            </span>
          </p>
        </div>
        <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
          <Button variant="secondary" size="sm">
            Return to Payment Room
          </Button>
        </Link>
      </div>

      <Notice variant="info" className="mt-6">
        <p className="text-[14px] leading-relaxed">{humanDecision}</p>
        <p className="mt-1 text-[13px] text-muted">
          The contract protects the payment. The agent prepares the resolution. People make the
          final decision.
        </p>
      </Notice>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Case identity */}
        <section className="rounded-[--radius-card] border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Case
          </h2>
          <dl className="mt-4 space-y-2 text-[14px]">
            <Row label="Chain" value={escrow?.escrowChainId} mono />
            <Row label="Escrow" value={escrow?.escrowContractAddress} mono breakAll />
            <Row label="Payment" value={`#${escrow?.escrowPaymentId}`} />
            <Row label="State" value={escrow?.state} />
            <Row label="Client" value={escrow?.client} mono breakAll />
            <Row label="Worker" value={escrow?.worker} mono breakAll />
            <Row label="Amount (atomic USDC)" value={escrow?.amountAtomic} mono />
          </dl>
        </section>

        {/* Evidence */}
        <section className="rounded-[--radius-card] border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Evidence
          </h2>
          <dl className="mt-4 space-y-2 text-[14px]">
            <Row label="Title" value={evidence?.title ?? "—"} />
            <Row label="Type" value={evidence?.evidenceType ?? "—"} />
            <Row label="Description" value={evidence?.description ?? "—"} />
            {evidence?.relatedClaim ? (
              <Row label="Related claim" value={evidence.relatedClaim} />
            ) : null}
            {evidence?.evidenceDate ? (
              <Row label="Date" value={evidence.evidenceDate} />
            ) : null}
            {evidence?.pastedText ? (
              <Row label="Pasted text" value={evidence.pastedText} />
            ) : null}
            {evidence?.externalRef ? (
              <Row label="External ref" value={evidence.externalRef} mono breakAll />
            ) : null}
            {evidence?.fileHash ? (
              <Row label="File hash" value={evidence.fileHash} mono breakAll />
            ) : null}
            <Row label="Availability" value={evidence?.availability ?? "—"} />
            <Row label="Files" value={String(evidence?.fileCount ?? 0)} />
            <Row label="Reference" value={evidence?.evidenceReference ?? "—"} mono breakAll />
            <Row label="Case version hash" value={evidence?.caseVersionHash ?? "—"} mono breakAll />
            <Row label="Evidence version hash" value={evidence?.evidenceVersionHash ?? "—"} mono breakAll />
          </dl>
        </section>
      </div>

      {/* Quality check */}
      <section className="mt-6 rounded-[--radius-card] border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Evidence Quality Check
        </h2>
        {Array.isArray(qcPacket?.qcInconsistency) && qcPacket.qcInconsistency.length > 0 && (
          <div className="mt-3 rounded-[--radius] border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
            <p className="font-semibold">QC may be stale relative to verified evidence</p>
            <ul className="mt-1 list-disc pl-5">
              {qcPacket.qcInconsistency.map((inc, i) => (
                <li key={i}>{inc}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[12px] uppercase tracking-[0.08em] text-muted">Readiness</p>
            <p className="mt-0.5 text-[16px] font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {qc?.readiness ?? "—"}
            </p>
            {Array.isArray(qc?.missingEvidence) && qc!.missingEvidence.length > 0 && (
              <p className="mt-2 text-[13px] text-muted">
                Missing evidence: {qc!.missingEvidence.join(", ")}
              </p>
            )}
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-[0.08em] text-muted">Ambiguities</p>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ink">
              {(qc?.ambiguities ?? []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
              Reviewer questions
            </p>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ink">
              {(qc?.reviewerQuestions ?? []).map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
              Recommended improvements
            </p>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ink">
              {(qc?.recommendedImprovements ?? []).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[12px] uppercase tracking-[0.08em] text-muted">x402 QC provenance</p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            Tool: {qc?.toolId ?? "evidence-quality-check"} · Request:{" "}
            {qc?.executionRequestHash ?? "—"}
          </p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            Settlement tx: {qc?.settlementTxHash ?? "—"}
          </p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            Payment reference: {qc?.paymentReference ?? "—"}
          </p>
        </div>
      </section>

      {/* Human decision */}
      <section className="mt-6 rounded-[--radius-card] border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Human decision
        </h2>
        <p className="mt-2 text-[14px] text-muted">
          {humanDecision} This page only prepares your decision — the actual wallet action is
          executed from the existing flows, after your confirmation.
        </p>

        {!wallet.isConnected && (
          <p className="mt-3 text-[13px] text-muted">
            Connect the client or worker wallet to see the decision options.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isClient && (
            <Button
              variant="primary"
              onClick={() => setConfirm("approve")}
              disabled={confirm !== null}
            >
              Approve release
            </Button>
          )}
          {(isClient || isWorker) && (
            <Button
              variant="secondary"
              onClick={() => setConfirm("dispute")}
              disabled={confirm !== null}
            >
              Open dispute
            </Button>
          )}
        </div>

        {!isClient && !isWorker && wallet.isConnected && (
          <p className="mt-3 text-[13px] text-muted">
            Only the payment client or worker can make the final decision.
          </p>
        )}
      </section>

      {/* Confirmation step — NO action is executed here */}
      {confirm === "approve" && (
        <div className="mt-6 rounded-[--radius-card] border border-border bg-page p-6">
          <h3 className="text-[16px] font-semibold text-ink">Confirm: approve release</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Releasing funds pays the worker the protected amount{" "}
            {escrow?.amountAtomic ? `${escrow.amountAtomic} atomic USDC` : ""} from escrow. This is
            a final human decision — the agent does not make it for you.
          </p>
          <p className="mt-2 text-[13px] text-muted">
            The release transaction is executed from the Payment Room using your wallet. Nothing is
            signed on this page.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
              <Button variant="primary">Continue in Payment Room</Button>
            </Link>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirm === "dispute" && (
        <div className="mt-6 rounded-[--radius-card] border border-border bg-page p-6">
          <h3 className="text-[16px] font-semibold text-ink">Confirm: open dispute</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Opening a dispute freezes the escrowed funds for adjudication. This is a final human
            decision — the agent does not make it for you.
          </p>
          <p className="mt-2 text-[13px] text-muted">
            The dispute is opened from the dispute flow using your wallet. Nothing is signed on this
            page.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
              <Button variant="primary">Continue to dispute flow</Button>
            </Link>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  breakAll = false,
}: {
  label: string;
  value: string | undefined;
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
