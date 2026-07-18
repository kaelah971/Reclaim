"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { keccak256, stringToHex } from "viem";
import Button from "@/components/ui/Button";
import DisputeForm, { buildDisputeManifest } from "@/components/payment/DisputeForm";
import X402PayButton from "@/components/payment/X402PayButton";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import Notice from "@/components/ui/Notice";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { useOpenDispute } from "@/hooks/contracts/useEscrowActions";
import { getCeloExplorerTxUrl } from "@/lib/web3/chains";
import { formatUSDC } from "@/lib/contracts/types";
import type { DisputeFormData } from "@/components/payment/DisputeForm";

export default function DisputePage() {
  const router = useRouter();
  const params = useParams<{ paymentId: string }>();
  const paymentIdStr = params?.paymentId;
  const paymentId = useMemo(() => {
    if (!paymentIdStr) return undefined;
    try {
      return BigInt(paymentIdStr);
    } catch {
      return undefined;
    }
  }, [paymentIdStr]);

  const { requireWallet } = useRequireWallet();
  const wallet = useWalletState();

  const { data: payment, isLoading, isError, notFound } = usePayment(paymentId);
  const { action: openDispute, isPending, isSuccess, error, txHash, reset } =
    useOpenDispute();

  const [lastReference, setLastReference] = useState<`0x${string}` | null>(null);

  // x402 brief preparation state
  const [briefReason, setBriefReason] = useState("");
  const [briefOutcome, setBriefOutcome] = useState("");
  const [briefData, setBriefData] = useState<unknown>(null);

  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        router.push(`/payments/${paymentIdStr}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, paymentIdStr, router]);

  const handleOpenDispute = useCallback(
    (data: DisputeFormData) => {
      if (!paymentId) return;
      requireWallet(() => {
        const manifest = buildDisputeManifest(data);
        const reference = keccak256(stringToHex(manifest));
        setLastReference(reference);
        openDispute(paymentId, reference);
      });
    },
    [paymentId, requireWallet, openDispute],
  );

  // Build x402 brief request from the inline form + on-chain payment data
  const buildDisputeBriefRequest = useCallback((): Record<string, unknown> | null => {
    if (!payment || !briefReason.trim() || !briefOutcome) return null;
    return {
      paymentId: payment.id.toString(),
      agreementTitle: payment.agreementLabel || "",
      clientAddress: payment.client,
      workerAddress: payment.worker,
      protectedAmount: formatUSDC(payment.amount),
      currentPaymentState: payment.state,
      agreedDeliverables: payment.deliverableSummary || "",
      deadline: payment.deliveryDeadline > BigInt(0)
        ? new Date(Number(payment.deliveryDeadline) * 1000).toISOString()
        : "",
      releaseTerms: payment.releaseRule || "",
      evidenceReferences: payment.evidenceReference
        ? [payment.evidenceReference]
        : [],
      disputeReason: briefReason.trim(),
      requestedOutcome: briefOutcome,
      relevantTimelineEntries: [
        {
          date: new Date(Number(payment.createdAt) * 1000).toISOString(),
          description: "Payment created on-chain.",
        },
        ...(payment.fundedAt > BigInt(0)
          ? [
              {
                date: new Date(Number(payment.fundedAt) * 1000).toISOString(),
                description: "Payment funded in escrow.",
              },
            ]
          : []),
        ...(payment.acceptedAt > BigInt(0)
          ? [
              {
                date: new Date(Number(payment.acceptedAt) * 1000).toISOString(),
                description: "Payment accepted by worker.",
              },
            ]
          : []),
      ],
    };
  }, [payment, briefReason, briefOutcome]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4">
          <svg
            className="animate-spin h-8 w-8 text-muted"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="30 10"
            />
          </svg>
          <p className="text-[15px] text-muted">Loading payment data…</p>
        </div>
      </div>
    );
  }

  if (isError || notFound || !payment) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Payment not found
          </h1>
          <p className="text-[15px] text-muted">
            Payment #{paymentIdStr} could not be loaded.
          </p>
          <Link href="/payments">
            <Button variant="secondary">Return to payments</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isParty =
    wallet.address &&
    (payment.client.toLowerCase() === wallet.address.toLowerCase() ||
      payment.worker.toLowerCase() === wallet.address.toLowerCase());

  if (!isParty) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Access restricted
          </h1>
          <p className="text-[15px] text-muted">
            Only the client or worker can open a dispute for this payment.
          </p>
          <Link href={`/payments/${paymentIdStr}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  const canDispute =
    payment.state === "Funded" ||
    payment.state === "Accepted" ||
    payment.state === "DeliverySubmitted" ||
    payment.state === "ReleaseRequested";

  if (!canDispute) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Cannot open dispute
          </h1>
          <p className="text-[15px] text-muted">
            A dispute can be opened once the payment is funded and before it is released or
            cancelled. Current state: {payment.state}.
          </p>
          <Link href={`/payments/${paymentIdStr}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Open a dispute
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Raise a formal disagreement for payment #{paymentIdStr}. The payment will be
            frozen while the case is reviewed.
          </p>
        </div>
        <Link href={`/payments/${paymentIdStr}`}>
          <Button variant="secondary" size="sm">
            Return to Payment Room
          </Button>
        </Link>
      </div>

      <div className="mt-8">
        {error && (
          <div className="mb-6">
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">{error}</p>
              <button
                type="button"
                className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                onClick={() => reset()}
              >
                Dismiss
              </button>
            </Notice>
          </div>
        )}

        {isPending && !txHash && (
          <div className="mb-6">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="30 10"
                    />
                  </svg>
                  Waiting for signature…
                </span>
              </p>
            </Notice>
          </div>
        )}

        {isPending && txHash && (
          <div className="mb-6">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="30 10"
                    />
                  </svg>
                  Confirming dispute…
                </span>
              </p>
              <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                {txHash}
              </p>
            </Notice>
          </div>
        )}

        {isSuccess && txHash && (
          <div className="mb-6">
            <Notice variant="success">
              <p className="text-[14px] leading-relaxed">
                Dispute opened successfully. Redirecting to Payment Room…
              </p>
              {lastReference && (
                <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                  Dispute reference: {lastReference}
                </p>
              )}
              <a
                href={getCeloExplorerTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
              >
                View on Celo Explorer
              </a>
            </Notice>
          </div>
        )}
      </div>

      <div className="rounded-[--radius-card] border border-border bg-surface p-6 md:p-8">
        <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
          Dispute details
        </h2>
        <p className="mt-1 text-[14px] text-muted">
          AI prepares the case. People decide. The contract settles.
        </p>
        <div className="mt-6">
          <DisputeForm onSubmit={handleOpenDispute} />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* x402 dispute brief preparation (paid service)                   */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="mt-10 border-t border-border pt-10">
        <div className="mb-6">
          <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
            AI dispute brief preparation
          </h2>
          <p className="mt-1 text-[14px] text-muted">
            Get a structured brief prepared from on-chain data before opening the
            dispute. This is a paid micro-service ($0.01 USDC) powered by x402.
          </p>
        </div>

        {/* Inline brief request form */}
        {!briefData && (
          <div className="mb-6 rounded-[--radius-card] border border-border bg-page p-5 space-y-4">
            <Textarea
              label="Dispute reason"
              placeholder="Explain the core issue — what part of the agreement was not met."
              value={briefReason}
              onChange={(e) => setBriefReason(e.target.value)}
            />

            <Select
              label="Requested outcome"
              value={briefOutcome}
              onChange={(e) => setBriefOutcome(e.target.value)}
            >
              <option value="">Select outcome</option>
              <option value="client-refund">
                Client refund — funds return to client
              </option>
              <option value="worker-release">
                Worker release — funds release to worker
              </option>
              <option value="split">
                Split settlement — funds divided between parties
              </option>
            </Select>

            <p className="text-[12px] text-muted">
              The brief is generated deterministically from your input and
              the on-chain payment data at payment #
              {paymentIdStr}.
            </p>
          </div>
        )}

        {/* x402 pay button / results */}
        <X402PayButton
          disputeRequest={buildDisputeBriefRequest() ?? {}}
          onBriefReady={(brief) => setBriefData(brief)}
          onError={() => setBriefData(null)}
        />
      </div>
    </div>
  );
}
