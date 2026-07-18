"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import PaymentFilters from "@/components/payment/PaymentFilters";
import StatusBadge from "@/components/ui/StatusBadge";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import {
  usePayment,
  useClientPaymentIds,
  useWorkerPaymentIds,
} from "@/hooks/contracts";
import {
  formatUSDC,
  PAYMENT_STATE_LABELS,
  type PaymentState,
} from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function badgeVariant(
  state: PaymentState,
): "pending" | "protected" | "submitted" | "settled" | "disputed" | "missing" {
  switch (state) {
    case "Created":
    case "Funded":
      return "pending";
    case "Accepted":
    case "DeliverySubmitted":
      return "protected";
    case "ReleaseRequested":
      return "submitted";
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

function nextActionHint(state: PaymentState, isClient: boolean): string {
  switch (state) {
    case "Created":
      return isClient ? "Deposit funds" : "Awaiting funding";
    case "Funded":
      return isClient ? "Awaiting acceptance" : "Review and accept terms";
    case "Accepted":
      return isClient ? "Awaiting delivery" : "Submit delivery evidence";
    case "DeliverySubmitted":
      return isClient ? "Review delivery" : "Request release";
    case "ReleaseRequested":
      return isClient
        ? "Approve release or dispute"
        : "Awaiting client review";
    case "Released":
      return "Completed";
    case "Disputed":
      return "Funds frozen";
    case "Cancelled":
      return "Cancelled";
  }
}

function paymentMatchesFilter(
  state: PaymentState,
  isClient: boolean,
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "action") {
    return (
      (state === "Created" && isClient) ||
      (state === "Funded" && !isClient) ||
      (state === "Accepted" && !isClient) ||
      (state === "DeliverySubmitted" && isClient) ||
      (state === "ReleaseRequested" && isClient)
    );
  }
  if (filter === "active") {
    const activeStates: PaymentState[] = [
      "Created",
      "Funded",
      "Accepted",
      "DeliverySubmitted",
      "ReleaseRequested",
    ];
    return activeStates.includes(state);
  }
  if (filter === "disputed") return state === "Disputed";
  if (filter === "completed")
    return state === "Released" || state === "Cancelled";
  return true;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PaymentRowSkeleton() {
  return (
    <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-5 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-5 w-16 rounded bg-input" />
          <div className="h-4 w-24 rounded bg-input" />
        </div>
        <div className="flex items-center gap-4">
          <div className="h-5 w-20 rounded-[--radius-pill] bg-input" />
          <div className="h-4 w-16 rounded bg-input" />
        </div>
      </div>
    </div>
  );
}

function PaymentCard({
  paymentId,
  userAddress,
  filter,
}: {
  paymentId: bigint;
  userAddress: string;
  filter: string;
}) {
  const { data: payment, isLoading, isError, notFound, refetch } =
    usePayment(paymentId);

  if (isLoading) return <PaymentRowSkeleton />;

  if (notFound) {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[14px] text-muted font-[family-name:var(--font-ibm-plex-mono)]">
            #{paymentId.toString()}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-muted">Payment not found</span>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !payment) {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[14px] text-muted font-[family-name:var(--font-ibm-plex-mono)]">
            #{paymentId.toString()}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-muted">
              Could not load payment
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-[14px] font-medium text-gold hover:text-gold/80 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isClient =
    payment.client.toLowerCase() === userAddress.toLowerCase();

  if (!paymentMatchesFilter(payment.state, isClient, filter)) return null;

  const role = isClient ? "Client" : "Worker";
  const displayId = payment.id.toString();

  return (
    <Link
      href={`/payments/${displayId}`}
      className="block rounded-[--radius-card] border border-border bg-surface px-6 py-5 transition-colors hover:border-primary/30 hover:bg-input/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="font-[family-name:var(--font-ibm-plex-mono)] text-[14px] tabular-nums text-ink">
            #{displayId}
          </span>
          <span className="font-[family-name:var(--font-georama)] text-[15px] font-semibold text-ink">
            {formatUSDC(payment.amount)} USDC
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge
            variant={badgeVariant(payment.state)}
            label={PAYMENT_STATE_LABELS[payment.state]}
          />
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[13px] text-muted">{role}</span>
            <span className="text-[13px] text-muted">
              {nextActionHint(payment.state, isClient)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type FilterKey = "all" | "action" | "active" | "disputed" | "completed";

export default function PaymentsPage() {
  const { address, isConnected } = useWalletState();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const {
    data: clientIds,
    isLoading: clientLoading,
    isError: clientError,
    refetch: refetchClient,
  } = useClientPaymentIds(isConnected ? address : undefined);

  const {
    data: workerIds,
    isLoading: workerLoading,
    isError: workerError,
    refetch: refetchWorker,
  } = useWorkerPaymentIds(isConnected ? address : undefined);

  const allPaymentIds = useMemo(() => {
    const seen = new Set<string>();
    const merged: bigint[] = [];
    for (const list of [clientIds, workerIds]) {
      if (!list) continue;
      for (const id of list) {
        const key = id.toString();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(id);
        }
      }
    }
    return merged;
  }, [clientIds, workerIds]);

  const isLoading = clientLoading || workerLoading;
  const isError = clientError || workerError;

  const handleRetryAll = useCallback(() => {
    refetchClient();
    refetchWorker();
  }, [refetchClient, refetchWorker]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Payments
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Protected USDC payments you created or were invited to.
          </p>
        </div>
        <Link href="/payments/new">
          <Button size="lg" className="shrink-0">
            Protect a payment
          </Button>
        </Link>
      </div>

      <div className="mt-8">
        <PaymentFilters
          value={activeFilter}
          onChange={(key) => setActiveFilter(key as FilterKey)}
        />
      </div>

      <div className="mt-6">
        {!isConnected && (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Connect your wallet to view payments.
            </h3>
            <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
              Connect your Celo wallet to see payments you created or were
              invited to.
            </p>
          </div>
        )}

        {isConnected && isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <PaymentRowSkeleton key={i} />
            ))}
          </div>
        )}

        {isConnected && !isLoading && isError && (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Could not load payments.
            </h3>
            <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
              Please try again.
            </p>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={handleRetryAll}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {isConnected && !isLoading && !isError && allPaymentIds.length === 0 && (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              No payments found.
            </h3>
            <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
              Create your first protected payment.
            </p>
          </div>
        )}

        {isConnected &&
          !isLoading &&
          !isError &&
          allPaymentIds.length > 0 && (
            <div className="space-y-3">
              {allPaymentIds.map((id) => (
                <PaymentCard
                  key={id.toString()}
                  paymentId={id}
                  userAddress={address!}
                  filter={activeFilter}
                />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
