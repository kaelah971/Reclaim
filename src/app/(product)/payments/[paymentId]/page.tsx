"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import SharePaymentLink from "@/components/payment/SharePaymentLink";
import FreelancerLanding from "@/components/payment/FreelancerLanding";
import WorkerGasNotice from "@/components/payment/WorkerGasNotice";
import SecureEvidenceViewer from "@/components/payment/SecureEvidenceViewer";
import WorkerDeliveryChat from "@/components/delivery/WorkerDeliveryChat";
import { useSubmitEvidenceFlow } from "@/hooks/evidence/useSubmitEvidenceFlow";import ReleasePreflight from "@/components/payment/ReleasePreflight";
import ReleasedSummary from "@/components/payment/ReleasedSummary";
import {
  getPaymentLifecycleLabel,
  parseChainIdParam,
  buildReceiptPath,
} from "@/components/payment/paymentLifecycle";
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
import { useSignMessage } from "wagmi";
import { useDeliveryEvaluation } from "@/hooks/review/useDeliveryEvaluation";
import DeliveryReviewCard from "@/components/review/DeliveryReviewCard";
import { deriveReleaseMode } from "@/lib/review/deliveryEvaluation";
import {
  usePaymentActionSync,
  PAYMENT_SYNCING_MESSAGE,
  PAYMENT_SYNC_TIMEOUT_MESSAGE,
} from "@/hooks/payment/usePaymentActionSync";
import { formatUSDC, type PaymentData, type PaymentState } from "@/lib/contracts/types";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  getCeloExplorerTxUrl,
  getCeloMainnetExplorerTxUrl,
  getChainName,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserRole = "client" | "worker" | "viewer";

// Roles are derived from canonical on-chain payment data (client/worker
// addresses as stored by the contract). The contract is the final authority
// on who may act — never trust URL params or client state for roles.
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

function explorerTxUrlForChain(chainId: number, txHash: string): string {
  return chainId === CELO_MAINNET_CHAIN_ID
    ? getCeloMainnetExplorerTxUrl(txHash)
    : getCeloExplorerTxUrl(txHash);
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
  chainId: number;
  /** True while receipt confirmed but canonical barrier not yet observed. */
  isSyncing?: boolean;
  /** True when bounded sync timed out (confirmed but still stale). */
  isTimedOut?: boolean;
  /** Safe canonical refresh (refetch only — never rebroadcast). */
  onRefresh?: () => void;
}

function TxStatus({
  isPending,
  isSuccess,
  error,
  txHash,
  onDismiss,
  label,
  chainId,
  isSyncing = false,
  isTimedOut = false,
  onRefresh,
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
    // Confirmed but RPC still stale → syncing / timeout states. The action
    // stays locked (caller disables on isSuccess); only a safe refetch is
    // offered — never a rebroadcast.
    if (isSyncing) {
      return (
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            {PAYMENT_SYNCING_MESSAGE}
          </p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {txHash}
          </p>
          <a
            href={explorerTxUrlForChain(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
          >
            View on Celo Explorer
          </a>
        </Notice>
      );
    }
    if (isTimedOut) {
      return (
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            {PAYMENT_SYNC_TIMEOUT_MESSAGE}
          </p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {txHash}
          </p>
          <a
            href={explorerTxUrlForChain(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
          >
            View on Celo Explorer
          </a>
          {onRefresh && (
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={onRefresh}>
                Refresh status
              </Button>
            </div>
          )}
        </Notice>
      );
    }
    return (
      <Notice variant="success">
        <p className="text-[14px] leading-relaxed">{label} confirmed.</p>
        <a
          href={explorerTxUrlForChain(chainId, txHash)}
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
// Page (Suspense wrapper for useSearchParams)
// ---------------------------------------------------------------------------

export default function PaymentRoomPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
          <div className="flex flex-col items-center justify-center gap-4">
            <p className="text-[15px] text-muted">Loading payment data…</p>
          </div>
        </div>
      }
    >
      <PaymentRoomContent />
    </Suspense>
  );
}

function PaymentRoomContent() {
  const params = useParams<{ paymentId: string }>();
  const searchParams = useSearchParams();
  const paymentIdStr = params?.paymentId;
  const paymentId = useMemo(() => {
    if (!paymentIdStr) return undefined;
    try {
      return BigInt(paymentIdStr);
    } catch {
      return undefined;
    }
  }, [paymentIdStr]);

  // ---- Chain resolution from ?chainId= (P4.3a) ----
  // Absent → preserve existing default behavior (Sepolia default chain).
  // Present → parse → validate via isSupportedChain/canonical mapping.
  // Malformed or unsupported → fail closed with an explicit notice (no
  // silent Sepolia fallback; no payment data is shown).
  const chainIdRaw = searchParams?.get("chainId");
  const chainResolution = useMemo(
    () => parseChainIdParam(chainIdRaw),
    [chainIdRaw],
  );
  const isChainInvalid = chainResolution.status === "invalid";
  const chainInvalidRaw =
    chainResolution.status === "invalid" ? chainResolution.raw : "";
  const explicitChainId =
    chainResolution.status === "explicit"
      ? chainResolution.chainId
      : undefined;
  // Preserve default (Sepolia) when absent; explicit 42220/11142220 threads
  // through every read + write below.
  const activeChainId = explicitChainId ?? CELO_CHAIN_ID;
  // Preserve-or-propagate ?chainId=: only when explicitly present in the URL
  // (keeps default/Sepolia links byte-identical when absent).
  const chainQuery =
    explicitChainId !== undefined ? `?chainId=${explicitChainId}` : "";
  const chainDisplayName = getChainName(activeChainId);

  const { requireWallet, requestNetworkSwitch } = useRequireWallet();
  const wallet = useWalletState();
  const token = getPaymentTokenConfig(activeChainId);

  // ---- Fetch payment data (explicit chain) ----
  const {
    data: payment,
    isLoading,
    isError,
    notFound,
    error: readError,
    refetch: refetchPayment,
  } = usePayment(paymentId, activeChainId);

  // ---- Token approval (explicit chain) ----
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
  } = useTokenApproval(activeChainId);

  // ---- Escrow actions (explicit chain; simulate-before-write +
  // attribution live inside these hooks — never bypassed) ----
  const fundPayment = useFundPayment(activeChainId);
  const acceptPayment = useAcceptPayment(activeChainId);
  const requestRelease = useRequestRelease(activeChainId);
  const approveRelease = useApproveRelease(activeChainId);
  const openDispute = useOpenDispute(activeChainId);
  const cancelUnfunded = useCancelUnfunded(activeChainId);

  // ---- Post-receipt canonical sync (P4.5F) ----
  // Each barrier polls refetchPayment() only (never rebroadcasts) until the
  // expected state is observed. Cancelled on unmount / payment / chain change.
  const fundSync = usePaymentActionSync({
    isSuccess: fundPayment.isSuccess,
    txHash: fundPayment.txHash,
    canonicalState: payment?.state,
    expectedState: "Funded",
    refetch: refetchPayment,
    paymentId: paymentIdStr,
    chainId: activeChainId,
  });
  const acceptSync = usePaymentActionSync({
    isSuccess: acceptPayment.isSuccess,
    txHash: acceptPayment.txHash,
    canonicalState: payment?.state,
    expectedState: "Accepted",
    refetch: refetchPayment,
    paymentId: paymentIdStr,
    chainId: activeChainId,
  });
  const requestSync = usePaymentActionSync({
    isSuccess: requestRelease.isSuccess,
    txHash: requestRelease.txHash,
    canonicalState: payment?.state,
    expectedState: "ReleaseRequested",
    refetch: refetchPayment,
    paymentId: paymentIdStr,
    chainId: activeChainId,
  });
  const releaseSync = usePaymentActionSync({
    isSuccess: approveRelease.isSuccess,
    txHash: approveRelease.txHash,
    canonicalState: payment?.state,
    expectedState: "Released",
    refetch: refetchPayment,
    paymentId: paymentIdStr,
    chainId: activeChainId,
  });

  // ---- Conversational delivery submission (P6.3, worker Accepted branch) ----
  // Primary conversational UX: WorkerDeliveryChat structures the delivery via
  // the parse API, then submit() runs the SAME manifest→hash→tx→receipt→
  // metadata lifecycle as the manual evidence form. No tx without explicit
  // worker clicks; the DeliverySubmitted+worker branch below is untouched.
  const conversationalEvidence = useSubmitEvidenceFlow(
    paymentId,
    paymentIdStr,
    activeChainId,
  );
  const conversationalSync = usePaymentActionSync({
    isSuccess: conversationalEvidence.isTxConfirmed,
    txHash: conversationalEvidence.txHash,
    canonicalState: payment?.state,
    expectedState: "DeliverySubmitted",
    refetch: refetchPayment,
    paymentId: paymentIdStr,
    chainId: activeChainId,
  });

  // ---- Refetch on action success (confirmed receipt → state refresh) ----
  // Immediate re-read; bounded polling above covers stale RPC reads.
  useEffect(() => {
    if (
      fundPayment.isSuccess ||
      acceptPayment.isSuccess ||
      requestRelease.isSuccess ||
      approveRelease.isSuccess ||
      openDispute.isSuccess ||
      cancelUnfunded.isSuccess ||
      conversationalEvidence.isSuccess ||
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
    conversationalEvidence.isSuccess,
    isApproveSuccess,
    refetchPayment,
    refetchAllowance,
  ]);

  // ---- Human-review packet availability (best-effort) ----
  const [hasReviewPacket, setHasReviewPacket] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function checkPacket() {
      if (!paymentIdStr) return;
      try {
        const res = await fetch(
          `/api/payments/${paymentIdStr}/review-packet${chainQuery}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { found?: boolean };
        if (!cancelled && data.found) setHasReviewPacket(true);
      } catch {
        // Best-effort — the link is hidden when the packet cannot be loaded.
      }
    }
    void checkPacket();
    return () => {
      cancelled = true;
    };
  }, [paymentIdStr, chainQuery]);

  // ---- Derived values (hooks must stay above all early returns) ----
  const role = useMemo(
    () => (payment ? getUserRole(payment, wallet.address) : "viewer"),
    [payment, wallet.address],
  );

  const hasAllowance = useMemo(() => {
    if (allowance === undefined || !payment) return false;
    return allowance >= payment.amount;
  }, [allowance, payment]);

  const isWrongNetwork =
    wallet.isConnected &&
    wallet.chainId !== undefined &&
    wallet.chainId !== activeChainId;

  // ---- Agent-assisted delivery review (P6.2, advisory only) ----
  // Manual release mode keeps the existing review flow (no evaluation).
  // agent_assisted fetches a party-scoped evaluation after delivery; the card
  // never triggers release — human wallet approval below still decides.
  const { signMessageAsync } = useSignMessage();
  const reviewReleaseMode = deriveReleaseMode(payment?.releaseRule);
  const isReviewEvaluable =
    payment?.state === "DeliverySubmitted" ||
    payment?.state === "ReleaseRequested";
  const reviewEnabled =
    reviewReleaseMode === "agent_assisted" &&
    isReviewEvaluable &&
    wallet.isConnected &&
    (role === "client" || role === "worker");
  const deliveryReview = useDeliveryEvaluation({
    paymentId: paymentIdStr ?? "",
    chainId: activeChainId,
    walletAddress: wallet.address,
    isConnected: wallet.isConnected,
    enabled: reviewEnabled,
    signMessage: (message: string) => signMessageAsync({ message }),
  });

  // ---- Action wrappers with wallet gating ----
  const wrapAction = useCallback(
    (fn: () => void) => {
      requireWallet(fn);
    },
    [requireWallet],
  );

  // ---- Fail closed on malformed/unsupported ?chainId= ----
  if (isChainInvalid) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Unsupported network
          </h1>
          <p className="text-[15px] text-muted">
            This payment link uses an unsupported network (chainId
            &ldquo;{chainInvalidRaw}&rdquo;). Supported networks are Celo
            (42220) and Celo Sepolia (11142220). Ask the sender for a link
            with a supported chainId.
          </p>
          <Link href="/payments">
            <Button variant="secondary">Return to payments</Button>
          </Link>
        </div>
      </div>
    );
  }

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

  const lifecycleLabel = getPaymentLifecycleLabel(payment.state);

  // ---- Build timeline (lifecycle-accurate labels) ----
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
      statusLabel: "Protected",
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
      statusLabel: "Delivered",
    });
  }

  if (payment.releaseRequestedAt > BigInt(0)) {
    timeline.push({
      id: "release-requested",
      label: "Release requested",
      date: unixToDateStr(payment.releaseRequestedAt),
      actor: payment.worker,
      statusVariant: "protected",
      statusLabel: "Release requested",
    });
  }

  if (payment.releasedAt > BigInt(0)) {
    timeline.push({
      id: "released",
      label: "Funds released",
      date: unixToDateStr(payment.releasedAt),
      actor: payment.worker,
      statusVariant: "settled",
      statusLabel: "Released",
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

  // ---- Wrong-network banner (explicit targetable switch) ----
  const wrongNetworkBanner = isWrongNetwork ? (
    <Notice variant="warning">
      <p className="text-[14px] leading-relaxed">
        Your wallet is on {wallet.chainId !== undefined ? getChainName(wallet.chainId) : "an unknown network"}. This
        payment lives on {chainDisplayName}.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3"
        onClick={() => requestNetworkSwitch(activeChainId)}
      >
        Switch to {chainDisplayName}
      </Button>
    </Notice>
  ) : null;

  // ---- Primary action content (role-gated; contract is final authority) ----
  let primaryActionContent: React.ReactNode;

  if (!wallet.isConnected) {
    // Anonymous → safe read-only freelancer landing. No privileged controls.
    primaryActionContent = (
      <FreelancerLanding
        payment={payment}
        amountLabel={formatUSDC(payment.amount)}
        tokenSymbol={token.symbol}
        networkName={chainDisplayName}
      />
    );
  } else if (role === "viewer") {
    // Connected but unrelated wallet → read-only, no privileged controls.
    primaryActionContent = (
      <div className="space-y-4">
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            You are viewing this payment as read-only. Only the client (
            {shortenAddress(payment.client)}) or the worker (
            {shortenAddress(payment.worker)}) can take action. The on-chain
            contract is the final authority.
          </p>
        </Notice>
        <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-3">
          <p className="text-[14px] text-muted">
            {formatUSDC(payment.amount)} {token.symbol} on {chainDisplayName} ·{" "}
            {lifecycleLabel}
          </p>
          <p className="text-[14px] leading-relaxed text-muted">
            Connect with the client or worker wallet to act on this payment.
          </p>
        </div>
      </div>
    );
  } else if (payment.state === "Released") {
    // Canonical settlement: ReleasedSummary renders "Payment released" for
    // clients and "Payment received" for the worker from the fresh on-chain
    // read. View receipt link targets the receipt route /receipts/${paymentIdStr}.
    const releasedAtLabel =
      payment.releasedAt > BigInt(0)
        ? new Date(Number(payment.releasedAt) * 1000).toISOString()
        : "";
    primaryActionContent = (
      <ReleasedSummary
        amountLabel={formatUSDC(payment.amount)}
        tokenSymbol={token.symbol}
        workerAddress={payment.worker}
        networkName={chainDisplayName}
        paymentId={paymentIdStr ?? ""}
        chainId={activeChainId}
        txHash={approveRelease.txHash}
        releasedAtLabel={releasedAtLabel}
        role={role === "client" || role === "worker" ? role : "viewer"}
        receiptHref={buildReceiptPath(paymentIdStr ?? "", explicitChainId) ?? `/receipts/${paymentIdStr}`}
        receiptLabel="View receipt"
        sharePaymentId={paymentIdStr ?? ""}
        shareChainId={activeChainId}
      />
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
              Your {token.symbol} balance ({formatUSDC(balance as bigint)} {token.symbol}) is less
              than the protected amount ({formatUSDC(payment.amount)} {token.symbol}). Add
              {activeChainId === CELO_MAINNET_CHAIN_ID
                ? ` ${token.symbol} on ${chainDisplayName}`
                : " Celo Sepolia USDC"}{" "}
              to your wallet before depositing.
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
              chainId={activeChainId}
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
                  disabled={fundPayment.isPending || fundPayment.isSuccess}
                >
                  {fundPayment.isPending
                    ? "Depositing…"
                    : fundPayment.isSuccess
                      ? "Deposit confirmed"
                      : "Deposit funds"}
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
              chainId={activeChainId}
              isSyncing={fundSync.isSyncing}
              isTimedOut={fundSync.isTimedOut}
              onRefresh={() => refetchPayment()}
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
          disabled={cancelUnfunded.isPending || cancelUnfunded.isSuccess}
        >
          {cancelUnfunded.isPending
            ? "Cancelling…"
            : cancelUnfunded.isSuccess
              ? "Cancel confirmed"
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
          chainId={activeChainId}
        />
      </div>
    );
  } else if (payment.state === "Created" && role === "worker") {
    primaryActionContent = (
      <div className="space-y-4">
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Waiting for the client to fund this payment.
          </p>
        </Notice>
        <WorkerGasNotice
          chainId={activeChainId}
          address={wallet.address as `0x${string}` | undefined}
        />
      </div>
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
        <WorkerGasNotice
          chainId={activeChainId}
          address={wallet.address as `0x${string}` | undefined}
        />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => acceptPayment.action(payment.id))
          }
          disabled={acceptPayment.isPending || acceptPayment.isSuccess}
        >
          {acceptPayment.isPending
            ? "Accepting…"
            : acceptPayment.isSuccess
              ? "Terms confirmed"
              : "Accept terms"}
        </Button>
        <TxStatus
          isPending={acceptPayment.isPending}
          isSuccess={acceptPayment.isSuccess}
          error={acceptPayment.error}
          txHash={acceptPayment.txHash}
          onDismiss={() => acceptPayment.reset()}
          label="Accept terms"
          chainId={activeChainId}
          isSyncing={acceptSync.isSyncing}
          isTimedOut={acceptSync.isTimedOut}
          onRefresh={() => refetchPayment()}
        />
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
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
            Funds protected. {formatUSDC(payment.amount)} {token.symbol} is held in
            escrow under the agreed terms.
          </p>
        </Notice>
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Waiting for the worker to accept the terms.
          </p>
        </Notice>
        <div className="rounded-[--radius-card] border border-border bg-surface p-6">
          <SharePaymentLink
            paymentId={paymentIdStr ?? ""}
            chainId={activeChainId}
          />
        </div>
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
          <Button variant="ghost" size="sm">
            Open dispute
          </Button>
        </Link>
      </div>
    );
  } else if (payment.state === "Accepted" && role === "worker") {
    primaryActionContent = (
      <div className="space-y-4">
        <WorkerDeliveryChat
          paymentIdStr={paymentIdStr ?? ""}
          chainId={activeChainId}
          workerAddress={payment.worker}
          deliverables={[payment.deliverableSummary, payment.deliveryFormat].filter(Boolean)}
          evidenceRequirements={payment.evidenceExpectation ? [payment.evidenceExpectation] : []}
          agreementLabel={payment.agreementLabel}
          protectedLabel={`${formatUSDC(payment.amount)} ${token.symbol} protected`}
          releaseMode={deriveReleaseMode(payment.releaseRule) === "manual" ? "manual" : "agent_assisted"}
          onSubmitDelivery={(data) => conversationalEvidence.submit(data)}
          submitState={{
            isPending: conversationalEvidence.isPending,
            isTxConfirmed: conversationalEvidence.isTxConfirmed,
            isSuccess: conversationalEvidence.isSuccess,
            txHash: conversationalEvidence.txHash,
            error: conversationalEvidence.error,
            metadataState: conversationalEvidence.metadataState,
            metadataError: conversationalEvidence.metadataError,
          }}
          onRequestPayment={() => wrapAction(() => requestRelease.action(payment.id))}
          requestState={{
            isPending: requestRelease.isPending,
            isSuccess: requestRelease.isSuccess,
            error: requestRelease.error,
            txHash: requestRelease.txHash,
          }}
          reviewStatus={deliveryReview.status}
        />
        <TxStatus
          isPending={conversationalEvidence.isPending}
          isSuccess={conversationalEvidence.isSuccess}
          error={conversationalEvidence.error}
          txHash={conversationalEvidence.txHash}
          onDismiss={() => conversationalEvidence.reset()}
          label="Delivery submission"
          chainId={activeChainId}
          isSyncing={conversationalSync.isSyncing}
          isTimedOut={conversationalSync.isTimedOut}
          onRefresh={() => refetchPayment()}
        />
        {conversationalEvidence.isTxConfirmed &&
          conversationalEvidence.metadataState === "idle" && (
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                Recording evidence details…
              </p>
            </Notice>
          )}
        {conversationalEvidence.metadataState === "error" && (
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">
              {conversationalEvidence.metadataError ??
                "Evidence metadata could not be persisted."}
            </p>
            <button
              type="button"
              className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
              onClick={() => conversationalEvidence.retryMetadata()}
            >
              Retry
            </button>
          </Notice>
        )}
        <WorkerGasNotice
          chainId={activeChainId}
          address={wallet.address as `0x${string}` | undefined}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/payments/${paymentIdStr}/evidence${chainQuery}`}>
            <Button variant="secondary" size="sm">
              Add evidence manually
            </Button>
          </Link>
          <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
            <Button variant="ghost" size="sm">
              Open dispute
            </Button>
          </Link>
        </div>
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
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
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
        {reviewReleaseMode === "agent_assisted" && (
          <DeliveryReviewCard
            status={deliveryReview.status}
            evaluation={deliveryReview.evaluation}
            role="worker"
            error={deliveryReview.error}
            unavailableMessage={deliveryReview.unavailableMessage}
            onRetry={() => deliveryReview.retry()}
          />
        )}
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Request release
        </h3>
        <p className="text-[14px] text-muted">
          Request the client to release funds for this delivery.
        </p>
        <WorkerGasNotice
          chainId={activeChainId}
          address={wallet.address as `0x${string}` | undefined}
        />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() =>
            wrapAction(() => requestRelease.action(payment.id))
          }
          disabled={requestRelease.isPending || requestRelease.isSuccess}
        >
          {requestRelease.isPending
            ? "Requesting…"
            : requestRelease.isSuccess
              ? "Request confirmed"
              : "Request release"}
        </Button>
        <TxStatus
          isPending={requestRelease.isPending}
          isSuccess={requestRelease.isSuccess}
          error={requestRelease.error}
          txHash={requestRelease.txHash}
          onDismiss={() => requestRelease.reset()}
          label="Release request"
          chainId={activeChainId}
          isSyncing={requestSync.isSyncing}
          isTimedOut={requestSync.isTimedOut}
          onRefresh={() => refetchPayment()}
        />
        <div className="pt-2 border-t border-border">
          <Link href={`/payments/${paymentIdStr}/evidence${chainQuery}`}>
            <Button variant="secondary" size="sm">
              Update evidence
            </Button>
          </Link>
        </div>
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
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
    const deliveryDateLabel =
      payment.deliveryAt > BigInt(0)
        ? new Date(Number(payment.deliveryAt) * 1000).toISOString()
        : "Not recorded";
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Review delivery
        </h3>
        <p className="text-[14px] leading-relaxed text-muted">
          The worker has submitted delivery. Review the details and the
          delivery evidence below before deciding to release or open a
          dispute.
        </p>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14px]">
          <div>
            <dt className="text-[13px] text-muted">Amount</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
              {formatUSDC(payment.amount)} {token.symbol}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Freelancer</dt>
            <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {payment.worker}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Network</dt>
            <dd className="mt-0.5 text-ink">{chainDisplayName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Status</dt>
            <dd className="mt-0.5 text-ink">{lifecycleLabel}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Terms</dt>
            <dd className="mt-0.5 text-ink">
              {payment.deliverableSummary || payment.releaseRule || "As agreed"}
              {payment.evidenceExpectation
                ? ` · ${payment.evidenceExpectation}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Delivered</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {deliveryDateLabel}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Evidence hash</dt>
            <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-[13px] text-ink">
              {payment.evidenceReference || "Not submitted"}
            </dd>
          </div>
        </dl>
        {reviewReleaseMode === "agent_assisted" && (
          <DeliveryReviewCard
            status={deliveryReview.status}
            evaluation={deliveryReview.evaluation}
            role="client"
            error={deliveryReview.error}
            unavailableMessage={deliveryReview.unavailableMessage}
            onRetry={() => deliveryReview.retry()}
          />
        )}
        <div id="delivery-evidence">
          <SecureEvidenceViewer
            paymentId={paymentIdStr ?? ""}
            chainId={activeChainId}
            walletAddress={wallet.address}
            isConnected={wallet.isConnected}
            evidenceReference={payment.evidenceReference}
          />
        </div>
        <div id="release-payment">
          <ReleasePreflight
            amountLabel={formatUSDC(payment.amount)}
            tokenSymbol={token.symbol}
            workerAddress={payment.worker}
            networkName={chainDisplayName}
            targetChainId={activeChainId}
            chainId={activeChainId}
            canonicalState={payment.state}
            isWrongNetwork={isWrongNetwork}
            isEligible={
              wallet.isConnected && role === "client" && !isWrongNetwork
            }
            isPending={approveRelease.isPending}
            isSuccess={approveRelease.isSuccess}
            error={approveRelease.error}
            txHash={approveRelease.txHash}
            onRequestSwitch={(cid) => requestNetworkSwitch(cid)}
            onRelease={() => wrapAction(() => approveRelease.action(payment.id))}
            onRefresh={() => refetchPayment()}
            onDismissError={() => approveRelease.reset()}
            isSyncing={releaseSync.isSyncing}
            isTimedOut={releaseSync.isTimedOut}
          />
        </div>
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
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
    const deliveryDateLabel =
      payment.deliveryAt > BigInt(0)
        ? new Date(Number(payment.deliveryAt) * 1000).toISOString()
        : "Not recorded";
    primaryActionContent = (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Review delivery
        </h3>
        <p className="text-[14px] leading-relaxed text-muted">
          The worker has requested release. Review the delivery and evidence
          below, then release the payment or open a dispute.
        </p>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14px]">
          <div>
            <dt className="text-[13px] text-muted">Amount</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
              {formatUSDC(payment.amount)} {token.symbol}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Freelancer</dt>
            <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-ink">
              {payment.worker}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Network</dt>
            <dd className="mt-0.5 text-ink">{chainDisplayName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Status</dt>
            <dd className="mt-0.5 text-ink">{lifecycleLabel}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Terms</dt>
            <dd className="mt-0.5 text-ink">
              {payment.deliverableSummary || payment.releaseRule || "As agreed"}
              {payment.evidenceExpectation
                ? ` · ${payment.evidenceExpectation}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Delivered</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {deliveryDateLabel}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Evidence hash</dt>
            <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-[13px] text-ink">
              {payment.evidenceReference || "Not submitted"}
            </dd>
          </div>
        </dl>
        {reviewReleaseMode === "agent_assisted" && (
          <DeliveryReviewCard
            status={deliveryReview.status}
            evaluation={deliveryReview.evaluation}
            role="client"
            error={deliveryReview.error}
            unavailableMessage={deliveryReview.unavailableMessage}
            onRetry={() => deliveryReview.retry()}
          />
        )}
        <div id="delivery-evidence">
          <SecureEvidenceViewer
            paymentId={paymentIdStr ?? ""}
            chainId={activeChainId}
            walletAddress={wallet.address}
            isConnected={wallet.isConnected}
            evidenceReference={payment.evidenceReference}
          />
        </div>
        <div id="release-payment">
          <ReleasePreflight
            amountLabel={formatUSDC(payment.amount)}
            tokenSymbol={token.symbol}
            workerAddress={payment.worker}
            networkName={chainDisplayName}
            targetChainId={activeChainId}
            chainId={activeChainId}
            canonicalState={payment.state}
            isWrongNetwork={isWrongNetwork}
            isEligible={
              wallet.isConnected && role === "client" && !isWrongNetwork
            }
            isPending={approveRelease.isPending}
            isSuccess={approveRelease.isSuccess}
            error={approveRelease.error}
            txHash={approveRelease.txHash}
            onRequestSwitch={(cid) => requestNetworkSwitch(cid)}
            onRelease={() => wrapAction(() => approveRelease.action(payment.id))}
            onRefresh={() => refetchPayment()}
            onDismissError={() => approveRelease.reset()}
            isSyncing={releaseSync.isSyncing}
            isTimedOut={releaseSync.isTimedOut}
          />
        </div>
        <Link href={`/payments/${paymentIdStr}/dispute${chainQuery}`}>
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
      <div className="space-y-4">
        {reviewReleaseMode === "agent_assisted" && (
          <DeliveryReviewCard
            status={deliveryReview.status}
            evaluation={deliveryReview.evaluation}
            role="worker"
            error={deliveryReview.error}
            unavailableMessage={deliveryReview.unavailableMessage}
            onRetry={() => deliveryReview.retry()}
          />
        )}
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Waiting for the client to approve the release.
          </p>
        </Notice>
        <WorkerGasNotice
          chainId={activeChainId}
          address={wallet.address as `0x${string}` | undefined}
        />
      </div>
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
          state={lifecycleLabel}
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
          {role !== "viewer" && wallet.isConnected && (
            <StatusBadge
              variant={role === "client" ? "pending" : "protected"}
              label={role === "client" ? "You: Client" : "You: Worker"}
            />
          )}
          {role === "viewer" && wallet.isConnected && (
            <StatusBadge variant="pending" label="Viewer" />
          )}
          {wrongNetworkBanner}
          {primaryActionContent}
          {hasReviewPacket && (
            <Link href={`/payments/${paymentIdStr}/review${chainQuery}`}>
              <Button variant="ghost" size="sm">
                Review case
              </Button>
            </Link>
          )}
          <Link href={`/payments/${paymentIdStr}/agent${chainQuery}`}>
            <Button variant="ghost" size="sm">
              Open Resolution Agent
            </Button>
          </Link>
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
