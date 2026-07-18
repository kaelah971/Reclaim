"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import StatusBadge, { type BadgeVariant } from "@/components/ui/StatusBadge";
import PaymentRoomLayout from "@/components/payment/PaymentRoomLayout";
import MoneyStateStrip from "@/components/payment/MoneyStateStrip";
import AgreementSummary from "@/components/payment/AgreementSummary";
import PaymentTimeline, {
  type TimelineEntryData,
} from "@/components/payment/PaymentTimeline";
import EvidenceMap, {
  type EvidenceItemData,
} from "@/components/payment/EvidenceMap";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { useTokenApproval } from "@/hooks/contracts/useTokenApproval";
import {
  useFundPayment,
  useAcceptPayment,
  useRequestRelease,
  useApproveRelease,
  useOpenDispute,
  useCancelUnfunded,
} from "@/hooks/contracts/useEscrowActions";
import { useWalletState, shortenAddress } from "@/hooks/wallet/useWalletState";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { formatUSDC, type PaymentData, type PaymentState, PAYMENT_STATE_LABELS } from "@/lib/contracts/types";
import { getCeloExplorerTxUrl } from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserRole = "client" | "worker" | "viewer";

function getUserRole(
  payment: PaymentData,
  address: string | undefined,
): UserRole {
  if (!address) return "viewer";
  const lower = address.toLowerCase();
  if (payment.client.toLowerCase() === lower) return "client";
  if (payment.worker.toLowerCase() === lower) return "worker";
  return "viewer";
}

function mapStateToBadgeVariant(state: PaymentState): BadgeVariant {
  switch (state) {
    case "Created":
      return "pending";
    case "Funded":
    case "Accepted":
    case "DeliverySubmitted":
    case "ReleaseRequested":
      return "protected";
    case "Released":
      return "settled";
    case "Disputed":
      return "disputed";
    case "Cancelled":
      return "missing";
    default:
      return "pending";
  }
}

function unixToDateStr(ts: bigint): string {
  if (ts <= BigInt(0)) return "";
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Transaction status helper component
// ---------------------------------------------------------------------------

interface TxStatusProps {
  isPending: boolean;
  isSuccess: boolean;
  error: string | null;
  txHash: `0x${string}` | undefined;
  onDismiss: () => void;
  label: string;
}

function TxStatus({
  isPending,
  isSuccess,
  error,
  txHash,
  onDismiss,
  label,
}: TxStatusProps) {
  if (error) {
    return (
      <Notice variant="warning">
        <p className="text-[14px] leading-relaxed">{error}</p>
        <button
          type="button"
          className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </Notice>
    );
  }

  if (isPending && !txHash) {
    return (
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
    );
  }

  if (isPending && txHash) {
    return (
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
            Confirming {label}…
          </span>
        </p>
        <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
          {txHash}
        </p>
      </Notice>
    );
  }

  if (isSuccess && txHash) {
    return (
      <Notice variant="success">
        <p className="text-[14px] leading-relaxed">{label} confirmed.</p>
        <a
          href={getCeloExplorerTxUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
        >
          View on Celo Explorer
        </a>
      </Notice>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PaymentRoomPage() {
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
  const token = getPaymentTokenConfig();

  // ---- Fetch payment data ----
  const {
    data: payment,
    isLoading,
    isError,
    notFound,
    error: readError,
    refetch: refetchPayment,
  } = usePayment(paymentId);

  // ---- Token approval ----
  const {
    allowance,
    isLoadingAllowance,
    balance,
    approve,
    isApproving,
    isApproveSuccess,
    approveError,
    approveTxHash,
    refetchAllowance,
    resetApprove,
  } = useTokenApproval();

  // ---- Escrow actions ----
  const fundPayment = useFundPayment();
  const acceptPayment = useAcceptPayment();
  const requestRelease = useRequestRelease();
  const approveRelease = useApproveRelease();
  const openDispute = useOpenDispute();
  const cancelUnfunded = useCancelUnfunded();

  // ---- Refetch on action success ----
  useEffect(() => {
    if (
      fundPayment.isSuccess ||
      acceptPayment.isSuccess ||
      requestRelease.isSuccess ||
      approveRelease.isSuccess ||
      openDispute.isSuccess ||
      cancelUnfunded.isSuccess ||
      isApproveSuccess
    ) {
      refetchPayment();
      refetchAllowance();
    }
  }, [
    fundPayment.isSuccess,
    acceptPayment.isSuccess,
    requestRelease.isSuccess,
    approveRelease.isSuccess,
    openDispute.isSuccess,
    cancelUnfunded.isSuccess,
    isApproveSuccess,
    refetchPayment,
    refetchAllowance,
  ]);

  // ---- Derived values ----
  const role = useMemo(
    () => (payment ? getUserRole(payment, wallet.address) : "viewer"),
    [payment, wallet.address],
  );

  const hasAllowance = useMemo(() => {
    if (allowance === undefined || !payment) return false;
    return allowance >= payment.amount;
  }, [allowance, payment]);

  // ---- Action wrappers with wallet gating ----
  const wrapAction = useCallback(
    (fn: () => void) => {
      requireWallet(fn);
    },
    [requireWallet],
  );

  // ---- Loading state ----
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

  // ---- Error state ----
  if (isError) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Error loading payment
          </h1>
          <p className="text-[15px] text-muted">
            {readError?.message ?? "Could not load payment data from the contract."}
          </p>
          <Button variant="secondary" onClick={() => refetchPayment()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // ---- Not found ----
  if (notFound || !payment) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Payment not found
          </h1>
          <p className="text-[15px] text-muted">
            Payment #{paymentIdStr} does not exist on the contract.
          </p>
          <Link href="/payments">
            <Button variant="secondary">Return to payments</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ---- Build timeline ----
  const timeline: TimelineEntryData[] = [
    {
      id: "created",
      label: "Payment created",
      date: unixToDateStr(payment.createdAt),
      actor: payment.client,
      statusVariant: "pending",
      statusLabel: "Created",
    },
  ];

  if (payment.fundedAt > BigInt(0)) {
    timeline.push({
      id: "funded",
      label: "Funds deposited",
      date: unixToDateStr(payment.fundedAt),
      actor: payment.client,
      statusVariant: "protected",
      statusLabel: "Funded",
    });
  }

  if (payment.acceptedAt > BigInt(0)) {
    timeline.push({
      id: "accepted",
      label: "Terms accepted",
      date: unixToDateStr(payment.acceptedAt),
      actor: payment.worker,
      statusVariant: "protected",
      statusLabel: "Accepted",
    });
  }

  if (payment.deliveryAt > BigInt(0)) {
    timeline.push({
      id: "evidence",
      label: "Evidence submitted",
      date: unixToDateStr(payment.deliveryAt),
      actor: payment.worker,
      description: payment.evidenceReference
        ? `Reference hash: ${payment.evidenceReference}`
        : undefined,
      statusVariant: "protected",
      statusLabel: "Submitted",
    });
  }

  if (payment.releaseRequestedAt > BigInt(0)) {
    timeline.push({
      id: "release-requested",
      label: "Release requested",
      date: unixToDateStr(payment.releaseRequestedAt),
      actor: payment.worker,
      statusVariant: "protected",
      statusLabel: "Pending",
    });
  }

  if (payment.releasedAt > BigInt(0)) {
    timeline.push({
      id: "released",
      label: "Funds released",
      date: unixToDateStr(payment.releasedAt),
      actor: payment.worker,
      statusVariant: "settled",
      statusLabel: "Settled",
    });
  }

  if (payment.state === "Disputed") {
    timeline.push({
      id: "disputed",
      label: "Dispute opened",
      description: payment.disputeReference
        ? `Reference: ${payment.disputeReference}`
        : undefined,
      statusVariant: "disputed",
      statusLabel: "Disputed",
    });
  }

  if (payment.state === "Cancelled") {
    timeline.push({
      id: "cancelled",
      label: "Payment cancelled",
      statusVariant: "missing",
      statusLabel: "Cancelled",
    });
  }

  // ---- Evidence map ----
  const evidenceItems: EvidenceItemData[] = [];
  if (payment.evidenceReference) {
    evidenceItems.push({
      id: "evidence-1",
      title: "Delivery evidence (hash)",
      type: "Evidence reference",
      owner: payment.worker,
      date: payment.state === "DeliverySubmitted" || payment.state === "ReleaseRequested"
        ? "Submitted on-chain"
        : undefined,
      status: "submitted",
      verificationRef: payment.evidenceReference,
    });
  }

  // ---- Primary action content ----
  let primaryActionContent: React.ReactNode;

  if (payment.state === "Released") {
    primaryActionContent = (
      <Notice variant="success">
        <p className="text-[14px] leading-relaxed">
          Payment released. Funds have been transferred to the worker.
        </p>
      </Notice>
    );
  } else if (payment.state === "Cancelled") {
    primaryActionContent = (
      <Notice variant="info">
        <p className="text-[14px] leading-relaxed">Payment has been cancelled.</p>
      </Notice>
    );
  } else if (payment.state === "Disputed") {
    primaryActionContent = (
      <Notice variant="warning">
        <p className="text-[14px] leading-relaxed">
          Funds frozen — case review not yet connected.
        </p>
        <p className="mt-1 text-[13px] text-muted">
          No funds can be released or cancelled while the dispute is open.
        </p>
        <p className="mt-2 text-[13px] text-muted">
          AI prepares the case. People decide. The contract settles.
        </p>
      </Notice>
    );
  } else if (payment.state === "Created" && role === "client") {
    const insufficientBalance = balance !== undefined && balance < payment.amount;

    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Fund your payment
        </h3>

        {insufficientBalance && (
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">
              Your USDC balance ({formatUSDC(balance as bigint)} USDC) is less
              than the protected amount ({formatUSDC(payment.amount)} USDC). Add
              Celo Sepolia USDC to your wallet before depositing.
            </p>
          </Notice>
        )}

        {!insufficientBalance && (
          <>
            {!hasAllowance && !isLoadingAllowance && (
              <div className="space-y-3">
                <p className="text-[14px] font-medium text-ink">
                  Step 1 — Approve the exact amount
                </p>
                <p className="text-[14px] text-muted">
                  The escrow contract needs permission to transfer{" "}
                  <span className="font-medium text-ink">
                    {formatUSDC(payment.amount)} {token.symbol}
                  </span>{" "}
                  from your wallet.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => wrapAction(() => approve(payment.amount))}
                  disabled={isApproving}
                >
                  {isApproving ? "Approving…" : `Approve ${token.symbol}`}
                </Button>
              </div>
            )}

            <TxStatus
              isPending={isApproving}
              isSuccess={isApproveSuccess}
              error={approveError}
              txHash={approveTxHash}
              onDismiss={() => {
                resetApprove();
                refetchAllowance();
              }}
              label={`${token.symbol} approval`}
            />

            {hasAllowance && (
              <div className="space-y-3">
                <p className="text-[14px] font-medium text-ink">
                  Step 2 — Deposit into escrow
                </p>
                <p className="text-[14px] text-muted">
                  Your funds are protected under these terms. Deposit{" "}
                  <span className="font-medium text-ink">
                    {formatUSDC(payment.amount)} {token.symbol}
                  </span>{" "}
                  into escrow.
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() =>
                    wrapAction(() => fundPayment.action(payment.id))
                  }
                  disabled={fundPayment.isPending}
                >
                  {fundPayment.isPending ? "Depositing…" : "Deposit funds"}
                </Button>
              </div>
            )}

            <TxStatus
              isPending={fundPayment.isPending}
              isSuccess={fundPayment.isSuccess}
              error={fundPayment.error}
              txHash={fundPayment.txHash}
              onDismiss={() => fundPayment.reset()}
              label="Deposit"
            />
          </>
        )}

        <div className="pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              wrapAction(() => cancelUnfunded.action(payment.id))
            }
            disabled={cancelUnfunded.isPending}
          >
            {cancelUnfunded.isPending
              ? "Cancelling…"
              : "Cancel unfunded payment"}
          </Button>
        </div>

        <TxStatus
          isPending={cancelUnfunded.isPending}
          isSuccess={cancelUnfunded.isSuccess}
          error={cancelUnfunded.error}
          txHash={cancelUnfunded.txHash}
          onDismiss={() => cancelUnfunded.reset()}
          label="Cancel"
        />
      </div>
    );
  } else if (payment.state === "Created" && role === "worker") {
    primaryActionContent = (
      <Notice variant="info">
        <p className="text-[14px] leading-relaxed">
          Waiting for the client to fund this payment.
        </p>
      </Notice>
    );
  } else if (payment.state === "Funded" && role === "worker") {
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Accept terms
        </h3>
        <p className="text-[14px] text-muted">
          Review the terms and accept this agreement to begin work.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => acceptPayment.action(payment.id))
          }
          disabled={acceptPayment.isPending}
        >
          {acceptPayment.isPending ? "Accepting…" : "Accept terms"}
        </Button>
        <TxStatus
          isPending={acceptPayment.isPending}
          isSuccess={acceptPayment.isSuccess}
          error={acceptPayment.error}
          txHash={acceptPayment.txHash}
          onDismiss={() => acceptPayment.reset()}
          label="Accept terms"
        />
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (payment.state === "Funded" && role === "client") {
    primaryActionContent = (
      <div className="space-y-4">
        <Notice variant="success">
          <p className="text-[14px] leading-relaxed">
            Funds protected. {formatUSDC(payment.amount)} USDC is held in
            escrow under the agreed terms.
          </p>
        </Notice>
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Waiting for the worker to accept the terms.
          </p>
        </Notice>
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (payment.state === "Accepted" && role === "worker") {
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Submit evidence
        </h3>
        <p className="text-[14px] text-muted">
          Submit your delivery evidence to move the payment forward.
        </p>
        <Link href={`/payments/${paymentIdStr}/evidence`}>
          <Button variant="primary" size="lg" className="w-full">
            Submit delivery evidence
          </Button>
        </Link>
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (payment.state === "Accepted" && role === "client") {
    primaryActionContent = (
      <div className="space-y-4">
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Waiting for the worker to submit delivery evidence.
          </p>
        </Notice>
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (
    payment.state === "DeliverySubmitted" &&
    role === "worker"
  ) {
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Request release
        </h3>
        <p className="text-[14px] text-muted">
          Request the client to release funds for this delivery.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => requestRelease.action(payment.id))
          }
          disabled={requestRelease.isPending}
        >
          {requestRelease.isPending ? "Requesting…" : "Request release"}
        </Button>
        <TxStatus
          isPending={requestRelease.isPending}
          isSuccess={requestRelease.isSuccess}
          error={requestRelease.error}
          txHash={requestRelease.txHash}
          onDismiss={() => requestRelease.reset()}
          label="Release request"
        />
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (
    payment.state === "DeliverySubmitted" &&
    role === "client"
  ) {
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Review delivery
        </h3>
        <p className="text-[14px] text-muted">
          Approve the release or open a dispute if the work is
          unsatisfactory.
        </p>
        <p className="text-[13px] text-muted">
          This sends the protected funds to the worker and completes the
          payment. Release {formatUSDC(payment.amount)} USDC to{" "}
          {shortenAddress(payment.worker)}.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => approveRelease.action(payment.id))
          }
          disabled={approveRelease.isPending}
        >
          {approveRelease.isPending ? "Approving…" : "Approve release"}
        </Button>
        <TxStatus
          isPending={approveRelease.isPending}
          isSuccess={approveRelease.isSuccess}
          error={approveRelease.error}
          txHash={approveRelease.txHash}
          onDismiss={() => approveRelease.reset()}
          label="Approve release"
        />
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="destructive" size="lg" className="w-full">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (
    payment.state === "ReleaseRequested" &&
    role === "client"
  ) {
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Approve release
        </h3>
        <p className="text-[14px] text-muted">
          The worker has requested release. Approve it or open a dispute.
        </p>
        <p className="text-[13px] text-muted">
          This sends the protected funds to the worker and completes the
          payment. Release {formatUSDC(payment.amount)} USDC to{" "}
          {shortenAddress(payment.worker)}.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => approveRelease.action(payment.id))
          }
          disabled={approveRelease.isPending}
        >
          {approveRelease.isPending ? "Approving…" : "Approve release"}
        </Button>
        <TxStatus
          isPending={approveRelease.isPending}
          isSuccess={approveRelease.isSuccess}
          error={approveRelease.error}
          txHash={approveRelease.txHash}
          onDismiss={() => approveRelease.reset()}
          label="Approve release"
        />
        <Link href={`/payments/${paymentIdStr}/dispute`}>
          <Button variant="destructive" size="lg" className="w-full">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (
    payment.state === "ReleaseRequested" &&
    role === "worker"
  ) {
    primaryActionContent = (
      <Notice variant="info">
        <p className="text-[14px] leading-relaxed">
          Waiting for the client to approve the release.
        </p>
      </Notice>
    );
  } else {
    primaryActionContent = (
      <Notice variant="info">
        <p className="text-[14px] leading-relaxed">
          No actions available in the current state.
        </p>
      </Notice>
    );
  }

  // ---- Render ----
  return (
    <PaymentRoomLayout
      moneyStrip={
        <MoneyStateStrip
          amount={formatUSDC(payment.amount)}
          asset={token.symbol}
          state={PAYMENT_STATE_LABELS[payment.state]}
          stateVariant={mapStateToBadgeVariant(payment.state)}
          deadline={payment.deliveryDeadline > BigInt(0)
            ? `Deadline: ${unixToDateStr(payment.deliveryDeadline)}`
            : undefined}
          nextParty={
            payment.state === "Created" && role === "client"
              ? "Action: fund escrow"
              : payment.state === "Created" && role === "worker"
                ? "Waiting for client"
                : payment.state === "Funded" && role === "worker"
                  ? "Action: accept terms"
                  : payment.state === "Funded" && role === "client"
                    ? "Waiting for worker"
                    : undefined
          }
        />
      }
      accordLine={
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span>Terms</span>
          <span className="text-border">&rarr;</span>
          <span>Funds</span>
          <span className="text-border">&rarr;</span>
          <span>Delivery</span>
          <span className="text-border">&rarr;</span>
          <span>Evidence</span>
          <span className="text-border">&rarr;</span>
          <span>Release</span>
          <span className="text-border">&rarr;</span>
          <span>Receipt</span>
        </div>
      }
      agreement={
        <div>
          <AgreementSummary
            clientWallet={payment.client}
            workerWallet={payment.worker}
            deliverable={payment.deliverableSummary}
            deliveryFormat={payment.deliveryFormat}
            deadline={
              payment.deliveryDeadline > BigInt(0)
                ? unixToDateStr(payment.deliveryDeadline)
                : undefined
            }
            releaseRule={payment.releaseRule}
            disputeWindow={
              payment.disputeWindowSeconds > BigInt(0)
                ? `${payment.disputeWindowSeconds.toString()} seconds`
                : undefined
            }
            evidenceExpectation={payment.evidenceExpectation || undefined}
          />
        </div>
      }
      primaryAction={
        <div className="space-y-4">
          {/* Role badge */}
          {role !== "viewer" && (
            <StatusBadge
              variant={role === "client" ? "pending" : "protected"}
              label={role === "client" ? "You: Client" : "You: Worker"}
            />
          )}
          {role === "viewer" && wallet.isConnected && (
            <StatusBadge variant="pending" label="Viewer" />
          )}
          {primaryActionContent}
        </div>
      }
      timeline={
        <PaymentTimeline entries={timeline} />
      }
      evidence={
        <EvidenceMap items={evidenceItems} />
      }
    />
  );
}
