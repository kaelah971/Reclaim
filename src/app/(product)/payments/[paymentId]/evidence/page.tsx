"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { keccak256, stringToHex } from "viem";
import Button from "@/components/ui/Button";
import EvidenceForm, { buildEvidenceManifest } from "@/components/payment/EvidenceForm";
import Notice from "@/components/ui/Notice";
import Dialog from "@/components/ui/Dialog";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { useSubmitEvidenceHash } from "@/hooks/contracts/useEscrowActions";
import { getCeloExplorerTxUrl } from "@/lib/web3/chains";
import type { EvidenceFormData } from "@/components/payment/EvidenceForm";

export default function EvidencePage() {
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
  const { action: submitEvidence, isPending, isSuccess, error, txHash, reset } =
    useSubmitEvidenceHash();

  const [strengthDialogOpen, setStrengthDialogOpen] = useState(false);
  const [lastReference, setLastReference] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        router.push(`/payments/${paymentIdStr}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, paymentIdStr, router]);

  const handleAddEvidence = useCallback(
    (data: EvidenceFormData) => {
      if (!paymentId) return;
      requireWallet(() => {
        const manifest = buildEvidenceManifest(data);
        const reference = keccak256(stringToHex(manifest));
        setLastReference(reference);
        submitEvidence(paymentId, reference);
      });
    },
    [paymentId, requireWallet, submitEvidence],
  );

  const handleCheckStrength = useCallback(() => {
    requireWallet(() => {
      setStrengthDialogOpen(true);
    });
  }, [requireWallet]);

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

  const isWorker =
    wallet.address &&
    payment.worker.toLowerCase() === wallet.address.toLowerCase();

  if (!isWorker) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Access restricted
          </h1>
          <p className="text-[15px] text-muted">
            Only the assigned worker can submit evidence for this payment.
          </p>
          <Link href={`/payments/${paymentIdStr}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (payment.state !== "Accepted" && payment.state !== "DeliverySubmitted") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Cannot submit evidence
          </h1>
          <p className="text-[15px] text-muted">
            Evidence can be submitted after you accept the terms (and updated until release is
            requested). Current state: {payment.state}.
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
            Submit evidence
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {payment.state === "DeliverySubmitted"
              ? `Update your delivery evidence reference for payment #${paymentIdStr}.`
              : `Submit your delivery evidence reference for payment #${paymentIdStr}.`}
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
                  Confirming evidence submission…
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
                Evidence submitted successfully. Redirecting to Payment Room…
              </p>
              {lastReference && (
                <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                  Verification reference: {lastReference}
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
          Evidence form
        </h2>
        <p className="mt-1 text-[14px] text-muted">
          Files remain private and off-chain. Reclaim records a verification reference.
        </p>
        <div className="mt-6">
          <EvidenceForm
            onSubmit={handleAddEvidence}
            onCheckStrength={handleCheckStrength}
          />
        </div>
      </div>

      <Dialog
        open={strengthDialogOpen}
        onClose={() => setStrengthDialogOpen(false)}
        title="Evidence Strength Check"
        primaryLabel="Got it"
        onPrimary={() => setStrengthDialogOpen(false)}
      >
        <p>Evidence Strength Check will be enabled during x402 integration.</p>
      </Dialog>
    </div>
  );
}
