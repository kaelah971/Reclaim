"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSignMessage } from "wagmi";
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
import { parseChainIdParam } from "@/components/payment/paymentLifecycle";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import type { ReceiptData } from "@/lib/receipt/types";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  getChainName,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import {
  readPartyEvidence,
  type PartyEvidence,
} from "@/lib/evidence/partyRead";

// ---------------------------------------------------------------------------
// /receipts/[receiptId] — PAYMENT RECEIPT (read-only, durable)
//
// The receipt of a payment in any escrow state, composed from durable
// verified sources only: on-chain escrow state + release/evidence tx proofs,
// verified evidence metadata, and the resolution agent's durable review
// packet.
//
// PUBLIC VIEW IS SANITIZED (P4.3D): the canonical
// GET /api/payments/[paymentId]/receipt endpoint returns hash-only evidence
// (title/claim/date/pastedText → null, QC free-text arrays → []). Plaintext
// delivery evidence is NEVER rendered publicly.
//
// PARTY VIEW (P4.4b): the connected client/worker may reveal delivery
// plaintext via the SAME P4.3D wallet-challenge flow used by the Room
// (src/lib/evidence/partyRead.ts → .../evidence/challenge +
// .../evidence/plaintext). Anonymous and unrelated wallets stay redacted.
// No second auth model is introduced here.
//
// CHAIN-AWARE (P4.4b): ?chainId= mirrors the room pattern. Absent preserves
// Sepolia default behavior; explicit 42220/11142220 threads into the receipt
// fetch + party challenge + explorer/token labels. Malformed or unsupported
// values fail closed (no silent fallback, no receipt data shown).
//
// READ-ONLY BY DESIGN: no mutation. Missing sources render as "Pending" —
// nothing is fabricated.
// ---------------------------------------------------------------------------

const accordStageLabels = [
  "Terms",
  "Funds",
  "Delivery",
  "Evidence",
  "Resolution",
  "Receipt",
] as const;

/**
 * Display token for a receipt chain: "USA₮" on Celo Mainnet (technical
 * contract symbol is USAT), legacy symbol (USDC) elsewhere. Mirrors the
 * new-payment display rule so the receipt, wizard and preflight agree.
 */
export function getReceiptTokenDisplay(chainId: number): string {
  const token = getPaymentTokenConfig(chainId);
  return chainId === CELO_MAINNET_CHAIN_ID ? token.name : token.symbol;
}

/**
 * Map a receipt amountHuman ("0.05 USAT" / "0.01 USDC") to its product
 * display form ("0.05 USA₮" on Mainnet). The numeric amount is authoritative
 * from the API; only the trailing technical symbol is translated.
 */
export function displayReceiptAmount(
  amountHuman: string | null | undefined,
  chainId: number,
): string | undefined {
  if (!amountHuman) return undefined;
  const display = getReceiptTokenDisplay(chainId);
  const parts = amountHuman.split(" ");
  if (parts.length < 2) return amountHuman;
  const numeric = parts.slice(0, -1).join(" ");
  return `${numeric} ${display}`;
}

/** Numeric portion of an amountHuman string ("0.05 USA₮" → "0.05"). */
function amountNumber(amountHuman: string | null | undefined): string | undefined {
  if (!amountHuman) return undefined;
  return amountHuman.split(" ")[0] ?? undefined;
}

/** Keep the ledger line honest for both terminal and in-progress receipts. */
function buildAccordStages(
  escrowState: string | undefined,
  finalState: string | undefined,
): AccordStage[] {
  const parsedState = Number(escrowState);
  const state = Number.isFinite(parsedState)
    ? parsedState
    : {
        Created: 0,
        Funded: 1,
        Accepted: 2,
        "Delivery submitted": 3,
        "Release requested": 4,
        Released: 5,
        Disputed: 6,
        Cancelled: 7,
        Resolved: 8,
      }[finalState ?? ""] ?? -1;
  const terminal =
    finalState === "Released" ||
    finalState === "Resolved" ||
    finalState === "Cancelled" ||
    state === 5 ||
    state === 7 ||
    state === 8;

  // Index of the current stage. Terminal states complete the whole line;
  // otherwise the contract state determines the next meaningful milestone.
  const activeIndex = terminal
    ? accordStageLabels.length
    : state === 0
      ? 1
      : state === 1 || state === 2
        ? 2
        : 4;

  return accordStageLabels.map((label, index) => ({
    label,
    state:
      index < activeIndex
        ? "completed"
        : index === activeIndex
          ? "active"
          : "pending",
  }));
}

function receiptActivityDate(
  finalState: string | undefined,
  releasedAt: string | null | undefined,
  resolvedAt: string | null | undefined,
  timestamps: {
    cancelledAt?: string | null;
    disputedAt?: string | null;
    resolvedAt?: string | null;
    releaseAt?: string | null;
  } | undefined,
): string | undefined {
  if (finalState === "Cancelled") return timestamps?.cancelledAt ?? undefined;
  if (finalState === "Disputed") return timestamps?.disputedAt ?? undefined;
  return (
    releasedAt ??
    resolvedAt ??
    timestamps?.resolvedAt ??
    timestamps?.releaseAt ??
    undefined
  );
}

export default function ReceiptDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
          <LoadingSkeleton />
        </div>
      }
    >
      <ReceiptDetailContent />
    </Suspense>
  );
}

function ReceiptDetailContent() {
  const params = useParams<{ receiptId: string }>();
  const searchParams = useSearchParams();
  const paymentIdStr = params?.receiptId ?? "";

  // ---- Chain resolution from ?chainId= (mirrors the room pattern) ----
  const chainIdRaw = searchParams?.get("chainId");
  const chainResolution = useMemo(
    () => parseChainIdParam(chainIdRaw),
    [chainIdRaw],
  );
  const isChainInvalid = chainResolution.status === "invalid";
  const chainInvalidRaw =
    chainResolution.status === "invalid" ? chainResolution.raw : "";
  const explicitChainId =
    chainResolution.status === "explicit" ? chainResolution.chainId : undefined;
  const activeChainId = explicitChainId ?? CELO_CHAIN_ID;
  // Preserve-or-propagate ?chainId=: only when explicitly present (keeps
  // default/Sepolia URLs byte-identical when absent).
  const chainQuery =
    explicitChainId !== undefined ? `?chainId=${explicitChainId}` : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!paymentIdStr || isChainInvalid) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/payments/${paymentIdStr}/receipt${chainQuery}`);
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
  }, [paymentIdStr, chainQuery, isChainInvalid]);

  // ---- Fail closed on malformed/unsupported ?chainId= ----
  if (isChainInvalid) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Unsupported network
          </h1>
          <p className="text-[15px] text-muted">
            This receipt link uses an unsupported network (chainId
            &ldquo;{chainInvalidRaw}&rdquo;). Supported networks are Celo
            (42220) and Celo Sepolia (11142220). Ask the sender for a link
            with a supported chainId.
          </p>
          <Link href="/receipts">
            <Button variant="secondary">Return to receipts</Button>
          </Link>
        </div>
      </div>
    );
  }

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
  const activityDate = receiptActivityDate(
    pp?.finalState,
    pp?.releasedAt,
    pp?.resolvedAt,
    audit?.timestamps,
  );

  if (!data?.found || !receipt) {
    return (
      <>
        <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
          <Notice variant="info">
            <p className="text-[14px] leading-relaxed">
              This settlement receipt is not available yet. It will appear once
              the payment can be verified on-chain.
            </p>
          </Notice>
          <div className="mt-8 flex justify-center gap-3">
            <Link href={`/receipts${chainQuery}`}>
              <Button variant="secondary">Return to receipts</Button>
            </Link>
            <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
              <Button>Return to Payment Room</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  // Chain-aware network label for escrow-chain transactions. The canonical
  // network comes from the verified receipt; the URL chain is the fallback
  // before the receipt loads (receipt is loaded here, so pp.network wins).
  const escrowNetworkLabel =
    pp?.network ?? getChainName(activeChainId);
  const tokenDisplay = getReceiptTokenDisplay(activeChainId);
  const amountDisplay = displayReceiptAmount(pp?.amountHuman, activeChainId);
  const amountNumeric = amountNumber(amountDisplay ?? pp?.amountHuman);

  const txRefs: TransactionRef[] = [
    {
      label: `Evidence submission (${escrowNetworkLabel})`,
      reference: ev?.submissionTxHash ?? undefined,
    },
    ...(pp?.finalState === "Released"
      ? [{ label: `Release transaction (${escrowNetworkLabel})`, reference: decision?.txHash ?? undefined }]
      : []),
    ...(links?.resolutionTransaction
      ? [{ label: `Resolution transaction (${escrowNetworkLabel})`, reference: links.resolutionTransaction }]
      : []),
    ...(links?.disputeTransaction
      ? [{ label: `Dispute transaction (${escrowNetworkLabel})`, reference: links.disputeTransaction }]
      : []),
    ...(links?.cancellationTransaction
      ? [{ label: `Cancellation transaction (${escrowNetworkLabel})`, reference: links.cancellationTransaction }]
      : []),
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
    pp?.financialOutcome ??
    (pp?.finalState === "Released" ? "Released to the worker" : pp?.finalState ?? "Awaiting integration");
  const outcomeVariant =
    pp?.finalState === "Released" ||
    pp?.finalState === "Resolved"
      ? "settled"
      : pp?.finalState === "Disputed"
        ? "disputed"
        : "pending";

  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <nav className="mb-6">
          <Link
            href={`/payments/${paymentIdStr}${chainQuery}`}
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
              outcomeVariant={outcomeVariant}
              settlementDate={activityDate}
              paymentRef={`Payment #${pp?.paymentId ?? paymentIdStr} · ${pp?.network ?? ""}`}
              verificationStatus="Verified on-chain"
            />

            {/* Plain-language outcome */}
            <div className="mt-8 rounded-[--radius-card] border border-border bg-page p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Outcome
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink">
                {pp?.financialOutcome === "Refunded to client"
                  ? "The dispute was resolved with the protected amount returned to the client."
                  : pp?.financialOutcome === "Partially resolved"
                    ? "The dispute was resolved with the protected amount split between the client and worker."
                    : pp?.financialOutcome === "Cancelled"
                      ? "The payment was cancelled before it was funded."
                      : pp?.financialOutcome === "Disputed — funds remain locked"
                        ? "The payment is disputed and funds remain locked while awaiting a resolution."
                        : pp?.financialOutcome === "Resolved"
                          ? "The payment is resolved on-chain; allocation details are pending transaction proof."
                          : pp?.financialOutcome === "Released to worker" &&
                              pp?.finalState === "Resolved"
                            ? "The dispute was resolved with the protected amount released to the worker."
                            : pp?.finalState === "Released"
                              ? "The protected amount was released to the worker after the client approved the release. The resolution agent prepared the case; a person made the final decision."
                              : "The payment has not reached a final settlement outcome."
                }
              </p>
              <p className="mt-2 text-[13px] text-muted">
                {receipt.productModel}
              </p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <AllocationBreakdown
                protectedAmount={amountNumeric}
                asset={tokenDisplay}
                clientAllocation={
                  pp?.finalState === "Released"
                    ? "0.00"
                    : pp?.finalState === "Resolved"
                      ? decision?.clientAmountHuman
                        ? (amountNumber(displayReceiptAmount(decision.clientAmountHuman, activeChainId) ?? decision.clientAmountHuman) ?? undefined)
                        : undefined
                      : undefined
                }
                workerAllocation={
                  pp?.finalState === "Released"
                    ? amountNumeric
                    : pp?.finalState === "Resolved"
                      ? decision?.workerAmountHuman
                        ? (amountNumber(displayReceiptAmount(decision.workerAmountHuman, activeChainId) ?? decision.workerAmountHuman) ?? undefined)
                        : undefined
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
              <AccordLine
                stages={buildAccordStages(pp?.escrowState, pp?.finalState)}
              />
            </div>

            {/* Evidence record — PUBLIC view is hash-only (P4.3D). Plaintext
                title/claim/date/pastedText arrive as null from the sanitized
                receipt and render as "—". Parties use the private section
                below (same wallet-challenge flow as the Room). */}
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

            {/* Party-authenticated private delivery evidence (P4.4b). */}
            <PartyEvidenceSection
              paymentIdStr={paymentIdStr}
              activeChainId={activeChainId}
              client={pp?.client}
              worker={pp?.worker}
            />

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
                <Row
                  label={pp?.finalState === "Resolved" ? "Resolution tx" : "Release tx"}
                  value={decision?.txHash ?? null}
                  mono
                  breakAll
                />
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
                  pp?.financialOutcome === "Refunded to client"
                    ? "Refunded to the client — dispute resolved"
                    : pp?.financialOutcome === "Partially resolved"
                      ? "Partially resolved"
                      : pp?.financialOutcome === "Released to worker" &&
                          pp?.finalState === "Resolved"
                        ? "Released to the worker — dispute resolved"
                        : pp?.finalState === "Released"
                          ? "Released — approved by the client"
                          : pp?.finalState === "Cancelled"
                            ? "Cancelled — unfunded payment"
                            : pp?.finalState === "Disputed"
                              ? "Disputed — awaiting resolution"
                              : pp?.finalState
                }
                reviewerCount={undefined}
                reviewNote={
                  pp?.finalState === "Released"
                    ? "The agent prepared the case. A person made the final decision."
                    : pp?.finalState === "Resolved"
                      ? "The escrow owner resolved the dispute on-chain."
                      : pp?.finalState === "Disputed"
                        ? "Funds remain in escrow until the dispute is resolved."
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
                    <AuditLink label={`Release transaction (${escrowNetworkLabel})`} href={links.releaseTransaction} />
                  ) : null}
                  {links.evidenceSubmissionTransaction ? (
                    <AuditLink label={`Evidence submission (${escrowNetworkLabel})`} href={links.evidenceSubmissionTransaction} />
                  ) : null}
                  {links.x402SettlementTransaction ? (
                    <AuditLink label="x402 QC settlement (Mainnet)" href={links.x402SettlementTransaction} />
                  ) : null}
                  {links.disputeTransaction ? (
                    <AuditLink label={`Dispute transaction (${escrowNetworkLabel})`} href={links.disputeTransaction} />
                  ) : null}
                  {links.resolutionTransaction ? (
                    <AuditLink label={`Resolution transaction (${escrowNetworkLabel})`} href={links.resolutionTransaction} />
                  ) : null}
                  {links.cancellationTransaction ? (
                    <AuditLink label={`Cancellation transaction (${escrowNetworkLabel})`} href={links.cancellationTransaction} />
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

// ---------------------------------------------------------------------------
// Party-authenticated private delivery evidence (P4.4b).
//
// Reuses the SAME P4.3D wallet-challenge flow as the Room
// (readPartyEvidence → .../evidence/challenge + .../evidence/plaintext).
// No second auth model: challenge, signature recovery, live on-chain
// client/worker check, expiry and single-use consume all live server-side.
//
// Anonymous and unrelated wallets stay redacted — the reveal control is only
// offered to the connected client/worker, and plaintext is only rendered
// after a successful authenticated read. Signatures, challenges and nonces
// are never rendered.
// ---------------------------------------------------------------------------

function PartyEvidenceSection({
  paymentIdStr,
  activeChainId,
  client,
  worker,
}: {
  paymentIdStr: string;
  activeChainId: number;
  client?: string | null;
  worker?: string | null;
}) {
  const wallet = useWalletState();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<"idle" | "loading" | "revealed" | "error">("idle");
  const [evidence, setEvidence] = useState<PartyEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address = wallet.address;
  const isParty = useMemo(() => {
    if (!wallet.isConnected || !address || (!client && !worker)) return false;
    const lower = address.toLowerCase();
    return (
      (client != null && client.toLowerCase() === lower) ||
      (worker != null && worker.toLowerCase() === lower)
    );
  }, [wallet.isConnected, address, client, worker]);

  const handleReveal = useCallback(async () => {
    if (!address || !isParty) return;
    setStatus("loading");
    setError(null);
    try {
      const result = await readPartyEvidence({
        paymentId: paymentIdStr,
        chainId: activeChainId,
        wallet: address,
        signMessage: (message: string) => signMessageAsync({ message }),
      });
      setEvidence(result);
      setStatus("revealed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal the delivery evidence.");
      setStatus("error");
    }
  }, [address, isParty, paymentIdStr, activeChainId, signMessageAsync]);

  // Anonymous or unrelated — stay redacted, no reveal control, no fetch.
  if (!isParty) {
    return (
      <div
        data-testid="party-evidence-locked"
        className="mt-8 rounded-[--radius-card] border border-border bg-page p-5"
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Private delivery evidence
        </h3>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Delivery plaintext is visible only to the client and worker of this
          payment. Connect the client or worker wallet and sign a short-lived
          challenge to reveal it here. The public receipt stays hash-only.
        </p>
      </div>
    );
  }

  if (status === "revealed" && evidence) {
    return (
      <div
        data-testid="party-evidence-plaintext"
        className="mt-8 rounded-[--radius-card] border border-border bg-page p-5"
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Private delivery evidence
        </h3>
        <dl className="mt-4 space-y-2 text-[14px]">
          <Row label="Title" value={evidence.title} />
          <Row label="Claim" value={evidence.claim} />
          <Row label="Description" value={evidence.description} />
          <Row label="Pasted text" value={evidence.pastedText} />
          <Row label="Date" value={evidence.date} />
          <Row label="External ref" value={evidence.externalRef} mono breakAll />
          <Row label="Evidence type" value={evidence.evidenceType} />
          <Row label="File hash" value={evidence.fileHash} mono breakAll />
          <Row label="Reference" value={evidence.evidenceReference} mono breakAll />
        </dl>
      </div>
    );
  }

  return (
    <div
      data-testid="party-evidence-gate"
      className="mt-8 rounded-[--radius-card] border border-border bg-page p-5"
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Private delivery evidence
      </h3>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        You are a party to this payment. Reveal the delivery plaintext with a
        short-lived wallet signature. Nothing is written on-chain.
      </p>
      {error ? (
        <div className="mt-3">
          <Notice variant="warning">
            <p className="text-[13px] leading-relaxed">{error}</p>
          </Notice>
        </div>
      ) : null}
      <div className="mt-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleReveal}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Revealing…" : "Reveal delivery evidence"}
        </Button>
      </div>
    </div>
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
