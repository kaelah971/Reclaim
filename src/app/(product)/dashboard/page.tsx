"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import DashboardSection from "@/components/payment/DashboardSection";
import OnboardingChecklist from "@/components/payment/OnboardingChecklist";
import UnsupportedNetworkNotice from "@/components/ui/UnsupportedNetworkNotice";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import {
  usePayment,
  useClientPaymentIds,
  useWorkerPaymentIds,
} from "@/hooks/contracts";
import { type PaymentData, type PaymentState } from "@/lib/contracts/types";
import type { ChecklistStep } from "@/components/payment/OnboardingChecklist";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_DEFS = [
  {
    key: "actionRequired" as const,
    title: "Action required",
    description: "Payments that need your attention.",
    emptyTitle: "No action required.",
    emptyDescription:
      "Payments needing your review, approval, or evidence will appear here.",
  },
  {
    key: "active" as const,
    title: "Active payments",
    description: "Protected payments in progress.",
    emptyTitle: "No active payments.",
    emptyDescription:
      "Payments where work is underway or delivery has been submitted.",
  },
  {
    key: "reviews" as const,
    title: "Reviews",
    description: "Disputes assigned to you for review.",
    emptyTitle: "No reviews assigned.",
    emptyDescription:
      "When you are selected as a reviewer, your assigned cases will appear here.",
  },
  {
    key: "receipts" as const,
    title: "Recent receipts",
    description: "Settlement records for completed payments.",
    emptyTitle: "No settlement receipts yet.",
    emptyDescription:
      "Receipts appear after a protected payment is released or resolved.",
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine if a payment state is terminal (completed / cancelled). */
function isTerminal(state: PaymentState): boolean {
  return state === "Released" || state === "Cancelled";
}

/** Determine if a payment needs action from the given user role. */
function paymentNeedsAction(
  payment: PaymentData,
  userAddress: string,
): boolean {
  const isClient = payment.client.toLowerCase() === userAddress.toLowerCase();

  // Client needs to act when: Created (fund it), DeliverySubmitted (review),
  // or ReleaseRequested (approve/dispute it)
  if (isClient) {
    return (
      payment.state === "Created" ||
      payment.state === "DeliverySubmitted" ||
      payment.state === "ReleaseRequested"
    );
  }

  // Worker needs to act when: Funded (accept it), or Disputed (respond)
  return (
    payment.state === "Funded" ||
    payment.state === "Disputed"
  );
}

// ---------------------------------------------------------------------------
// Invisible payment data tracker
// ---------------------------------------------------------------------------

/**
 * Fetches a single payment and reports it upward via a stable callback ref.
 * Renders nothing — used purely for data aggregation.
 */
function PaymentTracker({
  paymentId,
  onData,
}: {
  paymentId: bigint;
  onData: React.MutableRefObject<(data: PaymentData) => void>;
}) {
  const { data } = usePayment(paymentId);
  const reported = useRef(false);

  useEffect(() => {
    if (data && !reported.current) {
      reported.current = true;
      onData.current(data);
    }
  }, [data, onData]);

  return null;
}

// ---------------------------------------------------------------------------
// Payment aggregate hook (composed via state + trackers)
// ---------------------------------------------------------------------------

interface PaymentAggregate {
  actionRequired: number;
  active: number;
  reviews: number;
  receipts: number;
  hasFundedPayment: boolean;
  hasAcceptedPayment: boolean;
}

function usePaymentAggregate(
  paymentIds: readonly bigint[],
  userAddress: string | undefined,
): {
  aggregate: PaymentAggregate;
  /** Render these components in the tree so hooks fire. */
  trackers: React.ReactNode[];
} {
  const [paymentMap, setPaymentMap] = useState<Map<string, PaymentData>>(
    new Map(),
  );

  // Stable callback stored in a ref so `useEffect` deps stay clean
  const onDataRef = useRef<(data: PaymentData) => void>(() => {});
  const stableOnData = useCallback((p: PaymentData) => {
    setPaymentMap((prev) => {
      const key = p.id.toString();
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, p);
      return next;
    });
  }, []);

  useEffect(() => {
    onDataRef.current = stableOnData;
  }, [stableOnData]);

  const trackers = useMemo(
    () =>
      paymentIds.map((id) => (
        <PaymentTracker key={id.toString()} paymentId={id} onData={onDataRef} />
      )),
    [paymentIds],
  );

  const aggregate = useMemo<PaymentAggregate>(() => {
    if (!userAddress || paymentMap.size === 0) {
      return {
        actionRequired: 0,
        active: 0,
        reviews: 0,
        receipts: 0,
        hasFundedPayment: false,
        hasAcceptedPayment: false,
      };
    }

    let actionRequired = 0;
    let active = 0;
    let receipts = 0;
    let hasFundedPayment = false;
    let hasAcceptedPayment = false;

    for (const payment of paymentMap.values()) {
      // Action required
      if (paymentNeedsAction(payment, userAddress)) {
        actionRequired += 1;
      }

      // Active = non-terminal
      if (!isTerminal(payment.state)) {
        active += 1;
      }

      // Receipts = Released
      if (payment.state === "Released") {
        receipts += 1;
      }

      // Checklist flags
      if (
        payment.state !== "Created" &&
        payment.state !== "Cancelled"
      ) {
        hasFundedPayment = true;
      }
      if (
        payment.state !== "Created" &&
        payment.state !== "Funded" &&
        payment.state !== "Cancelled"
      ) {
        hasAcceptedPayment = true;
      }
    }

    return {
      actionRequired,
      active,
      reviews: 0, // reviewer system not yet implemented
      receipts,
      hasFundedPayment,
      hasAcceptedPayment,
    };
  }, [paymentMap, userAddress]);

  return { aggregate, trackers };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const wallet = useWalletState();

  // --- Fetch payment IDs ------------------------------------------------
  const {
    data: clientIds,
    isLoading: clientLoading,
    isError: clientError,
    refetch: refetchClient,
  } = useClientPaymentIds(wallet.isConnected ? wallet.address : undefined);

  const {
    data: workerIds,
    isLoading: workerLoading,
    isError: workerError,
    refetch: refetchWorker,
  } = useWorkerPaymentIds(wallet.isConnected ? wallet.address : undefined);

  // Deduplicate
  const allIds = useMemo(() => {
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

  const idsLoading = clientLoading || workerLoading;
  const idsError = clientError || workerError;

  // --- Aggregate payment data -------------------------------------------
  const { aggregate, trackers } = usePaymentAggregate(
    allIds,
    wallet.address,
  );

  // --- Build checklist steps --------------------------------------------
  const checklistSteps: ChecklistStep[] = useMemo(() => {
    const hasPayments = allIds.length > 0;
    const { hasFundedPayment, hasAcceptedPayment } = aggregate;

    return [
      {
        label: "Connect a wallet",
        complete: wallet.isConnected,
        disabled: !wallet.isConnected,
        disabledReason: wallet.isConnected
          ? `Connected as ${wallet.shortAddress}`
          : "Connect your Celo wallet to get started.",
      },
      {
        label: "Create clear terms",
        complete: hasPayments,
        disabled: !wallet.isConnected,
        disabledReason: "Available after wallet connection.",
      },
      {
        label: "Deposit USDC",
        complete: hasFundedPayment,
        disabled: !hasPayments || !wallet.isConnected,
        disabledReason: !wallet.isConnected
          ? "Available after wallet connection."
          : "Available after terms are created.",
      },
      {
        label: "Share the Payment Room",
        complete: hasAcceptedPayment,
        disabled: !hasFundedPayment || !wallet.isConnected,
        disabledReason: !wallet.isConnected
          ? "Available after wallet connection."
          : "Available after funds are protected.",
      },
    ];
  }, [wallet.isConnected, wallet.shortAddress, allIds.length, aggregate]);

  // --- Determine loading / error states for the body --------------------
  const showSkeletons = wallet.isConnected && idsLoading;
  const showIdsError = wallet.isConnected && !idsLoading && idsError;
  const showEmpty = wallet.isConnected && !idsLoading && !idsError && allIds.length === 0;

  const handleRetryAll = useCallback(() => {
    refetchClient();
    refetchWorker();
  }, [refetchClient, refetchWorker]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      {/* Render invisible payment trackers so hooks fire */}
      {trackers}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Your protected payments
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Track and manage your protected USDC payments.
          </p>
        </div>
        <Link href="/payments/new">
          <Button size="lg" className="shrink-0">
            Protect a payment
          </Button>
        </Link>
      </div>

      {wallet.isConnected && !wallet.chainSupported && (
        <UnsupportedNetworkNotice className="mt-6" />
      )}

      <div className="mt-10 space-y-12">
        {/* --- Loading skeletons --- */}
        {showSkeletons &&
          SECTION_DEFS.map((section) => (
            <DashboardSection
              key={section.key}
              title={section.title}
              description={section.description}
              empty
              emptyTitle="Loading…"
              emptyDescription=""
            />
          ))}

        {/* --- Error state --- */}
        {showIdsError && (
          <DashboardSection
            title="Could not load payments."
            description="Please try again."
            empty
            emptyTitle="Could not load payments. Please try again."
            emptyDescription=""
          >
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={handleRetryAll}>
                Retry
              </Button>
            </div>
          </DashboardSection>
        )}

        {/* --- Empty state (connected but no payments) --- */}
        {showEmpty &&
          SECTION_DEFS.map((section) => (
            <DashboardSection
              key={section.key}
              title={section.title}
              description={section.description}
              empty
              emptyTitle={section.emptyTitle}
              emptyDescription={section.emptyDescription}
            />
          ))}

        {/* --- Real data --- */}
        {wallet.isConnected &&
          !idsLoading &&
          !idsError &&
          allIds.length > 0 && (
            <>
              {/* Action required */}
              <DashboardSection
                title={SECTION_DEFS[0].title}
                description={SECTION_DEFS[0].description}
                empty={aggregate.actionRequired === 0}
                emptyTitle={SECTION_DEFS[0].emptyTitle}
                emptyDescription={SECTION_DEFS[0].emptyDescription}
              >
                <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-5 text-center">
                  <p className="text-[28px] font-[family-name:var(--font-georama)] font-bold text-ink tabular-nums">
                    {aggregate.actionRequired}
                  </p>
                  <p className="mt-1 text-[14px] text-muted">
                    {aggregate.actionRequired === 1
                      ? "payment needs your attention"
                      : "payments need your attention"}
                  </p>
                </div>
              </DashboardSection>

              {/* Active payments */}
              <DashboardSection
                title={SECTION_DEFS[1].title}
                description={SECTION_DEFS[1].description}
                empty={aggregate.active === 0}
                emptyTitle={SECTION_DEFS[1].emptyTitle}
                emptyDescription={SECTION_DEFS[1].emptyDescription}
              >
                <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-5 text-center">
                  <p className="text-[28px] font-[family-name:var(--font-georama)] font-bold text-ink tabular-nums">
                    {aggregate.active}
                  </p>
                  <p className="mt-1 text-[14px] text-muted">
                    {aggregate.active === 1
                      ? "protected payment in progress"
                      : "protected payments in progress"}
                  </p>
                </div>
              </DashboardSection>

              {/* Reviews (placeholder — reviewer system not yet implemented) */}
              <DashboardSection
                title={SECTION_DEFS[2].title}
                description={SECTION_DEFS[2].description}
                empty
                emptyTitle={SECTION_DEFS[2].emptyTitle}
                emptyDescription={SECTION_DEFS[2].emptyDescription}
              />

              {/* Recent receipts */}
              <DashboardSection
                title={SECTION_DEFS[3].title}
                description={SECTION_DEFS[3].description}
                empty={aggregate.receipts === 0}
                emptyTitle={SECTION_DEFS[3].emptyTitle}
                emptyDescription={SECTION_DEFS[3].emptyDescription}
              >
                <div className="rounded-[--radius-card] border border-border bg-surface px-6 py-5 text-center">
                  <p className="text-[28px] font-[family-name:var(--font-georama)] font-bold text-ink tabular-nums">
                    {aggregate.receipts}
                  </p>
                  <p className="mt-1 text-[14px] text-muted">
                    {aggregate.receipts === 1
                      ? "completed payment receipt"
                      : "completed payment receipts"}
                  </p>
                </div>
              </DashboardSection>
            </>
          )}

        {/* Disconnected state — show empty placeholders */}
        {!wallet.isConnected &&
          SECTION_DEFS.map((section) => (
            <DashboardSection
              key={section.key}
              title={section.title}
              description={section.description}
              empty
              emptyTitle={section.emptyTitle}
              emptyDescription={section.emptyDescription}
            />
          ))}
      </div>

      <OnboardingChecklist steps={checklistSteps} className="mt-12" />
    </div>
  );
}
