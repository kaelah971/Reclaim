"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import ReceiptFilters, {
  type ReceiptFilterValue,
} from "@/components/receipt/ReceiptFilters";
import StatusBadge, { type BadgeVariant } from "@/components/ui/StatusBadge";
import Notice from "@/components/ui/Notice";
import { parseChainIdParam } from "@/components/payment/paymentLifecycle";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import {
  useClientPaymentIds,
  useWorkerPaymentIds,
} from "@/hooks/contracts";
import { CELO_CHAIN_ID, getChainName } from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import { CELO_MAINNET_CHAIN_ID } from "@/lib/web3/chains";
import type { ReceiptData } from "@/lib/receipt/types";

// ---------------------------------------------------------------------------
// /receipts — settlement receipt index (read-only discovery)
//
// Discovers canonical payment receipts for the connected wallet (client or
// worker) using the SAME read model as /receipts/[receiptId]:
//   GET /api/payments/[paymentId]/receipt[?chainId=]
// Candidate payment IDs come from read-only contract calls
// (getClientPaymentIds / getWorkerPaymentIds) on the ACTIVE chain. A
// candidate is listed only when the canonical receipt endpoint returns
// found:true — nothing is fabricated, nothing is mutated.
//
// CHAIN-AWARE (P4.4b): ?chainId= mirrors the room pattern. Absent preserves
// Sepolia default behavior; explicit 42220/11142220 threads into the
// contract reads + receipt fetches + detail links. Malformed or unsupported
// values fail closed (no silent fallback, no receipts shown).
// ---------------------------------------------------------------------------

interface EligibleReceipt {
  paymentId: string;
  data: ReceiptData;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Every on-chain payment state has a canonical, read-only receipt. */
function isListableReceipt(data: ReceiptData): boolean {
  return data.found === true && Boolean(data.receipt?.protectedPayment);
}

function statusVariant(finalState: string | undefined): BadgeVariant {
  if (finalState === "Released" || finalState === "Resolved") return "settled";
  if (finalState === "Disputed") return "disputed";
  return "pending";
}

function receiptDate(data: ReceiptData): string | null {
  const pp = data.receipt?.protectedPayment;
  const timestamps = data.receipt?.audit?.timestamps;
  return (
    pp?.releasedAt ??
    pp?.resolvedAt ??
    timestamps?.cancelledAt ??
    timestamps?.resolvedAt ??
    timestamps?.disputedAt ??
    timestamps?.releaseAt ??
    null
  );
}

function receiptMatchesFilter(
  data: ReceiptData,
  filter: ReceiptFilterValue,
): boolean {
  const pp = data.receipt?.protectedPayment;
  const finalState = pp?.finalState;
  const outcome = pp?.financialOutcome ?? data.receipt?.humanDecision?.outcome;
  switch (filter) {
    case "all":
      return true;
    case "released":
      return finalState === "Released";
    case "client-outcome":
      return outcome === "Client" || outcome === "Refunded to client";
    case "worker-outcome":
      return outcome === "Worker" || outcome === "Released to worker";
    case "split":
      return outcome === "Split" || outcome === "Partially resolved";
    case "recent": {
      const date = receiptDate(data);
      if (!date) return false;
      return Date.now() - new Date(date).getTime() <= THIRTY_DAYS_MS;
    }
  }
}

function formatReceiptDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Display token for a receipt chain: "USA₮" on Celo Mainnet, legacy symbol
 * (USDC) elsewhere. Used for the card fallback when the API amount is
 * missing; otherwise the canonical amountHuman from the receipt is shown
 * with its technical symbol translated to the product display form.
 */
function displayCardAmount(
  amountHuman: string | null | undefined,
  chainId: number,
): string {
  const token = getPaymentTokenConfig(chainId);
  const display = chainId === CELO_MAINNET_CHAIN_ID ? token.name : token.symbol;
  if (!amountHuman) return `— ${display}`;
  const parts = amountHuman.split(" ");
  if (parts.length < 2) return amountHuman;
  return `${parts.slice(0, -1).join(" ")} ${display}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReceiptRowSkeleton() {
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

function ReceiptCard({
  paymentId,
  data,
  userAddress,
  chainQuery,
}: {
  paymentId: string;
  data: ReceiptData;
  userAddress: string;
  chainQuery: string;
}) {
  const pp = data.receipt?.protectedPayment;
  const finalState = pp?.finalState ?? "Pending";
  const outcome = pp?.financialOutcome;
  const isClient =
    !!pp?.client && pp.client.toLowerCase() === userAddress.toLowerCase();
  const role = isClient ? "Client" : "Worker";
  // Resolve the display chain from the verified receipt (eip155:ID) with the
  // URL chain available via the card amount fallback path in the parent.
  const network = pp?.network ?? null;

  return (
    <Link
      href={`/receipts/${paymentId}${chainQuery}`}
      className="block rounded-[--radius-card] border border-border bg-surface px-6 py-5 transition-colors hover:border-primary/30 hover:bg-input/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="font-[family-name:var(--font-ibm-plex-mono)] text-[14px] tabular-nums text-ink">
            Payment #{paymentId}
          </span>
          <span className="font-[family-name:var(--font-georama)] text-[15px] font-semibold text-ink">
            {pp?.amountHuman
              ? displayCardAmount(pp.amountHuman, chainIdFromReceipt(pp.chainId))
              : displayCardAmount(null, CELO_CHAIN_ID)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge variant={statusVariant(finalState)} label={finalState} />
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[13px] text-muted">{role}</span>
            <span className="text-[13px] text-muted">
              {formatReceiptDate(receiptDate(data))}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {network ? (
          <span className="text-[12px] uppercase tracking-[0.08em] text-muted">
            {network}
          </span>
        ) : null}
        {pp?.chainId ? (
          <span className="font-[family-name:var(--font-ibm-plex-mono)] text-[12px] text-muted">
            {pp.chainId}
          </span>
        ) : null}
      </div>
      {outcome && outcome !== finalState ? (
        <p className="mt-2 text-[13px] text-muted">{outcome}</p>
      ) : null}
    </Link>
  );
}

/** Parse "eip155:42220" → 42220; unknown → Sepolia default for display only. */
function chainIdFromReceipt(chainId: string | undefined): number {
  if (!chainId) return CELO_CHAIN_ID;
  const match = chainId.match(/^eip155:(\d+)$/);
  if (!match) return CELO_CHAIN_ID;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : CELO_CHAIN_ID;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReceiptsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ReceiptRowSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <ReceiptsContent />
    </Suspense>
  );
}

function ReceiptsContent() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useWalletState();
  const [activeFilter, setActiveFilter] = useState<ReceiptFilterValue>("all");
  const [eligible, setEligible] = useState<EligibleReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);

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
  const chainQuery =
    explicitChainId !== undefined ? `?chainId=${explicitChainId}` : "";
  const chainDisplayName = getChainName(activeChainId);

  const {
    data: clientIds,
    isLoading: clientLoading,
    isError: clientError,
    refetch: refetchClient,
  } = useClientPaymentIds(isConnected ? address : undefined, activeChainId);

  const {
    data: workerIds,
    isLoading: workerLoading,
    isError: workerError,
    refetch: refetchWorker,
  } = useWorkerPaymentIds(isConnected ? address : undefined, activeChainId);

  const allPaymentIds = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const list of [clientIds, workerIds]) {
      if (!list) continue;
      for (const id of list) {
        const key = id.toString();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(key);
        }
      }
    }
    return merged;
  }, [clientIds, workerIds]);

  // Load the canonical receipt for every candidate payment ID (read-only).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Yield first so no state is set synchronously within the effect.
      await Promise.resolve();
      if (cancelled) return;
      if (!isConnected || isChainInvalid || allPaymentIds.length === 0) {
        setEligible([]);
        setLoadingReceipts(false);
        return;
      }
      setLoadingReceipts(true);
      const results = await Promise.allSettled(
        allPaymentIds.map(async (id) => {
          const res = await fetch(`/api/payments/${id}/receipt${chainQuery}`);
          if (!res.ok) throw new Error(`Failed to load receipt (HTTP ${res.status})`);
          const json = (await res.json()) as ReceiptData;
          return { paymentId: id, data: json } as EligibleReceipt;
        }),
      );
      if (cancelled) return;
      const found: EligibleReceipt[] = [];
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const candidate = result.value;
        if (isListableReceipt(candidate.data)) found.push(candidate);
      }
      // Newest payment activity first (null-safe; stable order for equal dates).
      found.sort((a, b) => {
        const aAt = receiptDate(a.data) ?? "";
        const bAt = receiptDate(b.data) ?? "";
        return bAt.localeCompare(aAt);
      });
      setEligible(found);
      setLoadingReceipts(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isConnected, isChainInvalid, allPaymentIds, chainQuery]);

  const idsLoading = clientLoading || workerLoading;
  const idsError = clientError || workerError;

  const handleRetryAll = useCallback(() => {
    refetchClient();
    refetchWorker();
  }, [refetchClient, refetchWorker]);

  const filtered = useMemo(
    () => eligible.filter((r) => receiptMatchesFilter(r.data, activeFilter)),
    [eligible, activeFilter],
  );

  // ---- Fail closed on malformed/unsupported ?chainId= ----
  if (isChainInvalid) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
        <div className="flex flex-col items-center justify-center gap-4 py-14 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Unsupported network
          </h1>
          <p className="text-[15px] text-muted">
            This receipts link uses an unsupported network (chainId
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

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Settlement receipts
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Plain-language records of protected payments from terms through outcome.
          {explicitChainId !== undefined ? ` Showing ${chainDisplayName}.` : null}
        </p>
      </div>

      <div className="mt-8">
        {!isConnected && (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Connect your wallet to view receipts.
            </h3>
            <p className="mt-2 max-w-md mx-auto text-[15px] leading-relaxed text-muted">
              Connect your Celo wallet to see settlement receipts for payments
              you were a client or worker on.
            </p>
          </div>
        )}

        {isConnected && (idsLoading || loadingReceipts) && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ReceiptRowSkeleton key={i} />
            ))}
          </div>
        )}

        {isConnected && !idsLoading && !idsError && (
          <ReceiptFilters value={activeFilter} onChange={setActiveFilter}>
            {filtered.length > 0 ? (
              <div className="space-y-3 text-left">
                {filtered.map((r) => (
                  <ReceiptCard
                    key={r.paymentId}
                    paymentId={r.paymentId}
                    data={r.data}
                    userAddress={address!}
                    chainQuery={chainQuery}
                  />
                ))}
              </div>
            ) : undefined}
          </ReceiptFilters>
        )}

        {isConnected && !idsLoading && idsError && (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-14 text-center">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Could not load receipts.
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
      </div>

      <div className="mt-10 rounded-[--radius-card] border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          What receipts contain
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            "Original terms and amount",
            "Client and worker wallets",
            "Delivery and evidence record",
            "Release or dispute outcome",
            "Final allocation breakdown",
            "Reviewer result and vote summary",
            "Celo transaction references",
            "Attribution and verification details",
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <svg
                className="mt-0.5 shrink-0 text-gold"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 7L5.5 10L11.5 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[14px] text-ink">{item}</span>
            </div>
          ))}
        </div>

        <Notice variant="info" className="mt-6 !border-border">
          <p className="text-[14px] leading-relaxed">
            <strong>Receipts are free to view.</strong> No x402 payment or paid
            action is required to view, print, share, or verify your own
            settlement receipt. A receipt is a trust feature, not an upsell.
          </p>
        </Notice>
      </div>
    </div>
  );
}
