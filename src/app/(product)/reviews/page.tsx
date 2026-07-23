"use client";

// ---------------------------------------------------------------------------
// Review Queue — lists all reviewable protected-payment cases
//
// Requires wallet-based reviewer authentication. After signing, the token is
// passed as a Bearer header to fetch the case list.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import EmptyState from "@/components/ui/EmptyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import ReviewerPrinciples from "@/components/review/ReviewerPrinciples";
import { useReviewerAuth } from "@/hooks/reviewer/useReviewerAuth";

// ---------------------------------------------------------------------------
// Types matching GET /api/reviews response shape
// ---------------------------------------------------------------------------

interface QueueCase {
  paymentId: string;
  agreementTitle: string;
  protectedAmount: string;
  client: string;
  worker: string;
  state: string;
  generationMode: string;
  provider?: string;
  model?: string;
  createdAt: string;
  evidenceCount: number;
  missingEvidenceCount: number;
  reviewStatus: string;
  latestDecision: {
    id: string;
    decision: string;
    status: string;
    submittedAt: string;
  } | null;
}

type FilterValue = "awaiting_review" | "ready_for_execution" | "all";

const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "ready_for_execution", label: "Ready for execution" },
  { value: "all", label: "All cases" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shorten(str: string): string {
  if (!str) return "";
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

function reviewStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "awaiting_review":
      return { label: "Awaiting review", className: "bg-status-disputed-bg text-status-disputed-text border-status-disputed-text/20" };
    case "draft":
      return { label: "Draft saved", className: "bg-input text-muted border-border" };
    case "submitted":
      return { label: "Submitted", className: "bg-gold/10 text-gold border-gold/30" };
    case "ready_for_execution":
      return { label: "Ready for execution", className: "bg-status-protected-bg text-status-protected-text border-success/30" };
    case "superseded":
      return { label: "Superseded", className: "bg-page text-muted border-border" };
    default:
      return { label: status, className: "bg-page text-muted border-border" };
  }
}

function genModeBadge(mode: string): { label: string; className: string } {
  if (mode === "ai") {
    return { label: "AI-prepared", className: "border-gold/40 bg-gold/10 text-gold" };
  }
  return { label: "Manual brief", className: "border-border bg-page text-muted" };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ReviewsPage() {
  const auth = useReviewerAuth();
  const [cases, setCases] = useState<QueueCase[]>([]);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterValue>("awaiting_review");

  // Fetch cases when authenticated
  const loadCases = useCallback(async () => {
    if (!auth.sessionToken) return;
    setFetchStatus("loading");
    setFetchError(null);

    try {
      const res = await fetch("/api/reviews", {
        headers: { Authorization: `Bearer ${auth.sessionToken}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          auth.clearAuth();
          throw new Error("Session expired. Please authenticate again.");
        }
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to load cases (${res.status}).`);
      }

      const data = (await res.json()) as { cases: QueueCase[] };
      setCases(data.cases || []);
      setFetchStatus("success");
    } catch (err) {
      setFetchStatus("error");
      setFetchError(err instanceof Error ? err.message : "Failed to load cases.");
    }
  }, [auth.sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch when auth state changes. This effect synchronises with the
  // external authentication system — setState is the intended behaviour here:
  // when the user logs in, data must be loaded; when they log out, data resets.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (auth.status === "authenticated") {
      loadCases();
    } else {
      setCases([]);
      setFetchStatus("idle");
      setFetchError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Client-side filter
  const filteredCases = useMemo(() => {
    if (activeFilter === "all") return cases;
    return cases.filter((c) => c.reviewStatus === activeFilter);
  }, [cases, activeFilter]);

  // ---------------------------------------------------------------------------
  // Not authenticated view
  // ---------------------------------------------------------------------------

  if (auth.status !== "authenticated") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Review protected-payment cases
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Authenticate with your allowed reviewer wallet to view assigned cases.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4">
          <div className="rounded-[--radius-card] border border-border bg-surface p-8 text-center max-w-md w-full">
            <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Connect &amp; Authenticate
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {auth.wallet.isConnected
                ? `Connected as ${auth.wallet.shortAddress}. Sign the authentication message to access the review queue.`
                : "Connect your Celo wallet, then sign an authentication message to verify you are an authorized reviewer."}
            </p>

            {auth.error && (
              <Notice variant="warning" className="mt-4 text-left">
                <p className="text-[14px] leading-relaxed">{auth.error}</p>
              </Notice>
            )}

            <div className="mt-6 flex flex-col gap-3">
              {!auth.wallet.isConnected ? (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => auth.wallet}
                  disabled
                >
                  Connect wallet to begin
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={auth.authenticate}
                  disabled={auth.isLoading}
                >
                  {auth.isLoading ? "Authenticating…" : "Sign & authenticate"}
                </Button>
              )}
              {auth.isLoading && (
                <p className="text-[13px] text-muted">Sign the message in your wallet to continue.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <ReviewerPrinciples />
          </div>

          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Reviewer access
            </h3>
            <ul className="mt-4 space-y-3 text-[14px] leading-relaxed text-muted">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                Connect your Celo wallet to register as a reviewer.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                Receive a structured evidence packet and AI-organised case summary.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                Review against the agreed terms and submit a binding decision.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                Your decision becomes part of the settlement record.
              </li>
            </ul>
          </div>
        </div>

        <Notice variant="info" className="mt-8">
          <p className="text-[14px] leading-relaxed">
            <strong>Reviewer rewards.</strong> Reviewer reward routing is planned for a later phase. During the initial launch, reviews are part of the protected-payment process. Rewards, reputation, and accuracy scores will be introduced in a future update.
          </p>
        </Notice>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Authenticated view
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Review cases
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Authenticated as{" "}
          <span className="font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
            {auth.wallet.shortAddress}
          </span>
          {" · "}
          <button
            onClick={auth.clearAuth}
            className="text-gold hover:text-gold/80 transition-colors underline underline-offset-2"
          >
            Sign out
          </button>
        </p>
      </div>

      {/* Filters */}
      <div className="mt-6 flex overflow-x-auto gap-1 pb-2" role="tablist" aria-label="Review filters">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={activeFilter === f.value}
            onClick={() => setActiveFilter(f.value)}
            className={`shrink-0 rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium transition-colors ${
              activeFilter === f.value
                ? "bg-primary text-page"
                : "text-muted hover:text-ink hover:bg-input"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={loadCases}
          className="shrink-0 ml-auto rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium text-muted hover:text-ink hover:bg-input transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Loading */}
      {fetchStatus === "loading" && (
        <div className="mt-6">
          <LoadingSkeleton variant="list" />
        </div>
      )}

      {/* Error */}
      {fetchStatus === "error" && (
        <div className="mt-6">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">{fetchError}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={loadCases}>
              Retry
            </Button>
          </Notice>
        </div>
      )}

      {/* Empty */}
      {fetchStatus === "success" && filteredCases.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title={
              activeFilter === "all"
                ? "No review cases found."
                : activeFilter === "awaiting_review"
                  ? "No cases awaiting review."
                  : "No cases ready for execution."
            }
            description={
              activeFilter === "all"
                ? "No protected-payment cases are currently available for review."
                : "Try selecting a different filter to see more cases."
            }
          />
        </div>
      )}

      {/* Case cards */}
      {fetchStatus === "success" && filteredCases.length > 0 && (
        <div className="mt-6 space-y-4">
          {filteredCases.map((c) => {
            const badge = reviewStatusBadge(c.reviewStatus);
            const modeBadge = genModeBadge(c.generationMode);
            return (
              <Link
                key={c.paymentId}
                href={`/reviews/${c.paymentId}`}
                className="block rounded-[--radius-card] border border-border bg-surface p-5 transition-shadow hover:shadow-[0_8px_24px_rgba(35,28,21,.10)]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[16px] font-semibold text-ink truncate">
                        {c.agreementTitle}
                      </h3>
                      <span
                        className={`shrink-0 rounded-[--radius-pill] border px-2 py-0.5 text-[12px] ${modeBadge.className}`}
                      >
                        {modeBadge.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                      <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
                        #{c.paymentId}
                      </span>
                      <span>{c.protectedAmount}</span>
                      <span>Client: {shorten(c.client)}</span>
                      <span>Worker: {shorten(c.worker)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
                      <span
                        className={`rounded-[--radius-pill] border px-2 py-0.5 text-[12px] ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      {c.state && (
                        <span className="text-muted">On-chain: {c.state}</span>
                      )}
                      {c.evidenceCount > 0 && (
                        <span className="text-muted">{c.evidenceCount} evidence item{c.evidenceCount !== 1 ? "s" : ""}</span>
                      )}
                      {c.missingEvidenceCount > 0 && (
                        <span className="text-status-disputed-text">
                          {c.missingEvidenceCount} missing
                        </span>
                      )}
                      {c.createdAt && (
                        <span className="text-muted font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-[12px]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span className="text-[13px] text-gold font-medium">
                      View case →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Footer notice */}
      <Notice variant="info" className="mt-8">
        <p className="text-[14px] leading-relaxed">
          <strong>AI prepares the case. You decide. Execution happens separately.</strong>{" "}
          The AI brief provides structure and evidence organisation — it never selects a winner or recommends a verdict.
        </p>
      </Notice>
    </div>
  );
}
