"use client";

// ---------------------------------------------------------------------------
// Review Case Detail — full case review workspace for a single dispute
//
// Requires wallet-based reviewer authentication. Fetches case detail from
// GET /api/reviews/[id] and renders: case header, AI brief, on-chain facts,
// decision panel, and review history.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import EmptyState from "@/components/ui/EmptyState";
import AICaseBriefDisplay from "@/components/payment/AICaseBriefDisplay";
import ReviewerVotePanel from "@/components/review/ReviewerVotePanel";
import { useReviewerAuth } from "@/hooks/reviewer/useReviewerAuth";

// ---------------------------------------------------------------------------
// Types matching GET /api/reviews/[id] response shape
// ---------------------------------------------------------------------------

interface OnchainData {
  id: string;
  client: string;
  worker: string;
  amount: string;
  token: string;
  state: string;
  evidenceReference: string | null;
  disputeReference: string | null;
}

interface StoredData {
  payer_address: string;
  pay_to_address: string;
  amount_display: string;
  amount_atomic: string;
  state: string;
  transaction_hash: string | null;
  escrow_payment_id: string | null;
  generation_mode: string;
  ai_provider: string | null;
  ai_model: string | null;
  created_at: string;
}

interface DecisionRecord {
  id: string;
  decision: string;
  rationale: string;
  clientAmount: string | null;
  workerAmount: string | null;
  status: string;
  reviewer: string;
  createdAt: string;
  submittedAt: string | null;
}

interface CaseDetail {
  paymentId: string;
  brief: Record<string, unknown> | null;
  onchainData: OnchainData | null;
  decisions: DecisionRecord[];
  stored: StoredData;
  reviewerAddress: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shorten(str: string): string {
  if (!str) return "";
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

function decisionLabel(decision: string): string {
  switch (decision) {
    case "release_to_worker":
      return "Release to worker";
    case "refund_to_client":
      return "Refund to client";
    case "partial_resolution":
      return "Partial resolution";
    case "needs_more_evidence":
      return "Needs more evidence";
    default:
      return decision;
  }
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", className: "bg-input text-muted border-border" };
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

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ReviewerCasePage() {
  const params = useParams();
  const disputeId = params?.disputeId as string;

  const auth = useReviewerAuth();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "success" | "error" | "not_found">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Decision panel state
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelSuccess, setPanelSuccess] = useState<string | null>(null);

  // Fetch case data
  const loadCase = useCallback(async () => {
    if (!auth.sessionToken || !disputeId) return;

    setFetchStatus("loading");
    setFetchError(null);

    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(disputeId)}`, {
        headers: { Authorization: `Bearer ${auth.sessionToken}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          auth.clearAuth();
          throw new Error("Session expired. Please authenticate again.");
        }
        if (res.status === 404) {
          setFetchStatus("not_found");
          return;
        }
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to load case (${res.status}).`);
      }

      const data = (await res.json()) as CaseDetail;
      setCaseData(data);
      setFetchStatus("success");
    } catch (err) {
      setFetchStatus("error");
      setFetchError(err instanceof Error ? err.message : "Failed to load case.");
    }
  }, [auth.sessionToken, disputeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch when auth state changes. This effect synchronises with the
  // external authentication system — setState is the intended behaviour here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (auth.status === "authenticated") {
      loadCase();
    } else {
      setCaseData(null);
      setFetchStatus("idle");
      setFetchError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ---------------------------------------------------------------------------
  // Decision panel callbacks
  // ---------------------------------------------------------------------------

  const handleSaveDraft = useCallback(
    async (draft: {
      decision: string;
      rationale: string;
      clientAmount?: string;
      workerAmount?: string;
    }) => {
      if (!auth.sessionToken || !disputeId) return;

      setSavingDraft(true);
      setPanelError(null);
      setPanelSuccess(null);

      try {
        const res = await fetch(`/api/reviews/${encodeURIComponent(disputeId)}/draft`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.sessionToken}`,
          },
          body: JSON.stringify(draft),
        });

        const body = await res.json().catch(() => ({})) as {
          success?: boolean;
          action?: string;
          error?: string;
          details?: Record<string, string[]>;
        };

        if (!res.ok) {
          const errMsg =
            body.details
              ? Object.entries(body.details)
                  .map(([k, v]) => `${k}: ${v.join(", ")}`)
                  .join("; ")
              : body.error || "Failed to save draft.";
          throw new Error(errMsg);
        }

        setPanelSuccess(body.action === "updated" ? "Draft updated." : "Draft saved.");
        // Reload case to get updated decisions
        void loadCase();
      } catch (err) {
        setPanelError(err instanceof Error ? err.message : "Failed to save draft.");
      } finally {
        setSavingDraft(false);
      }
    },
    [auth.sessionToken, disputeId, loadCase],
  );

  const handleSubmit = useCallback(
    async (decisionId: string, supersedePrevious: boolean) => {
      if (!auth.sessionToken || !disputeId) return;

      setSubmitting(true);
      setPanelError(null);
      setPanelSuccess(null);

      try {
        const res = await fetch(`/api/reviews/${encodeURIComponent(disputeId)}/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.sessionToken}`,
          },
          body: JSON.stringify({ decisionId, supersedePrevious }),
        });

        const body = await res.json().catch(() => ({})) as {
          success?: boolean;
          error?: string;
          message?: string;
          details?: unknown;
        };

        if (!res.ok) {
          throw new Error(body.error || "Failed to submit decision.");
        }

        setPanelSuccess(body.message || "Decision submitted.");
        // Reload case to get updated decisions
        void loadCase();
      } catch (err) {
        setPanelError(err instanceof Error ? err.message : "Failed to submit decision.");
      } finally {
        setSubmitting(false);
      }
    },
    [auth.sessionToken, disputeId, loadCase],
  );

  // ---------------------------------------------------------------------------
  // Not authenticated view
  // ---------------------------------------------------------------------------

  if (auth.status !== "authenticated") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-16 text-center">
          <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
            Authentication required
          </h3>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
            {auth.wallet.isConnected
              ? "Sign the authentication message to access this case."
              : "Connect your Celo wallet and authenticate to review this case."}
          </p>

          {auth.error && (
            <Notice variant="warning" className="mt-4 w-full max-w-md text-left">
              <p className="text-[14px] leading-relaxed">{auth.error}</p>
            </Notice>
          )}

          {auth.wallet.isConnected ? (
            <Button
              size="lg"
              className="mt-6"
              onClick={auth.authenticate}
              disabled={auth.isLoading}
            >
              {auth.isLoading ? "Authenticating…" : "Sign & authenticate"}
            </Button>
          ) : (
            <p className="mt-4 text-[14px] text-muted">
              Use the wallet button in the navigation bar to connect first.
            </p>
          )}

          <Link href="/reviews" className="mt-6 text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
            ← Back to reviews
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading view
  // ---------------------------------------------------------------------------

  if (fetchStatus === "loading") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
        <div className="mb-8 flex items-center gap-3">
          <Link href="/reviews" className="text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
            ← Back to reviews
          </Link>
          <span className="text-muted text-[13px]">·</span>
          <span className="text-[13px] text-muted">Loading case…</span>
        </div>
        <LoadingSkeleton variant="detail" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Not found
  // ---------------------------------------------------------------------------

  if (fetchStatus === "not_found") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <EmptyState
          title="Case not found."
          description="This review case does not exist or has been removed."
        />
        <div className="mt-8 flex justify-center">
          <Link href="/reviews">
            <Button>← Back to reviews</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error view
  // ---------------------------------------------------------------------------

  if (fetchStatus === "error") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
        <Link href="/reviews" className="text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
          ← Back to reviews
        </Link>
        <div className="mt-8">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">{fetchError}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={loadCase}>
              Retry
            </Button>
          </Notice>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Success — render full case
  // ---------------------------------------------------------------------------

  if (fetchStatus !== "success" || !caseData) return null;

  const { brief, onchainData, decisions, stored } = caseData;
  const existingDecision = decisions.find(
    (d) => d.status === "submitted" || d.status === "ready_for_execution",
  ) ?? null;
  const existingDraft = decisions.find(
    (d) => d.status === "draft",
  ) ?? null;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <Link href="/reviews" className="text-[15px] font-medium text-gold hover:text-gold/80 transition-colors">
          ← Reviews
        </Link>
        <span className="text-muted text-[13px]">·</span>
        <span className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted tabular-nums">
          {disputeId}
        </span>
        <span className="text-muted text-[13px]">·</span>
        <span className="text-[13px] text-muted">
          Auth: {auth.wallet.shortAddress}
        </span>
      </div>

      {/* Page title */}
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          {(brief as Record<string, unknown> | null)?.caseTitle as string ||
            (brief as Record<string, unknown> | null)?.neutralCaseTitle as string ||
            `Payment #${disputeId}`}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          AI prepared this case. You decide. Execution happens separately.
        </p>
      </div>

      {/* Global panel messages */}
      {panelError && (
        <Notice variant="warning" className="mt-6">
          <p className="text-[14px] leading-relaxed">{panelError}</p>
          <button
            onClick={() => setPanelError(null)}
            className="mt-2 text-[13px] text-gold underline underline-offset-2"
          >
            Dismiss
          </button>
        </Notice>
      )}
      {panelSuccess && (
        <Notice variant="success" className="mt-6">
          <p className="text-[14px] leading-relaxed">{panelSuccess}</p>
          <button
            onClick={() => setPanelSuccess(null)}
            className="mt-2 text-[13px] text-gold underline underline-offset-2"
          >
            Dismiss
          </button>
        </Notice>
      )}

      {/* Main layout: 2/3 + 1/3 */}
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Left column: case content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Case header card */}
          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-4">
              Case Details
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[14px]">
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">Payment ID</span>
                <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
                  {disputeId}
                </p>
              </div>
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">Amount</span>
                <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-semibold text-ink">
                  {stored.amount_display}
                </p>
              </div>
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">Client</span>
                <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink text-[13px]">
                  {shorten(stored.payer_address)}
                </p>
              </div>
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">Worker</span>
                <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink text-[13px]">
                  {shorten(stored.pay_to_address)}
                </p>
              </div>
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">State</span>
                <p className="mt-0.5 font-medium text-ink">{stored.state}</p>
              </div>
              <div>
                <span className="text-muted text-[12px] uppercase tracking-wider">Generation</span>
                <p className="mt-0.5 font-medium text-ink">
                  {stored.generation_mode === "ai" ? "AI-prepared" : "Manual"}
                </p>
              </div>
              {stored.transaction_hash && (
                <div className="col-span-full">
                  <span className="text-muted text-[12px] uppercase tracking-wider">Transaction</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-[12px] text-ink break-all">
                    {stored.transaction_hash}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* On-chain verified facts — clearly separated from AI brief */}
          {onchainData && (
            <div className="rounded-[--radius-card] border border-success/30 bg-status-protected-bg p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-status-protected-text">
                  Verified on-chain facts
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[13px]">
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">Escrow ID</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
                    #{onchainData.id}
                  </p>
                </div>
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">Token</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
                    {onchainData.token}
                  </p>
                </div>
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">Amount (atomic)</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink text-[12px]">
                    {onchainData.amount}
                  </p>
                </div>
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">On-chain state</span>
                  <p className="mt-0.5 font-semibold text-ink">{onchainData.state}</p>
                </div>
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">Client</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-[12px] text-ink">
                    {shorten(onchainData.client)}
                  </p>
                </div>
                <div>
                  <span className="text-muted text-[11px] uppercase tracking-wider">Worker</span>
                  <p className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-[12px] text-ink">
                    {shorten(onchainData.worker)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-muted italic">
                These facts are read directly from the Celo blockchain. They are independently verifiable and do not originate from the AI brief.
              </p>
            </div>
          )}

          {/* AI Case Brief */}
          {brief && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-4">
                AI-prepared case brief
              </h2>
              <AICaseBriefDisplay
                brief={
                  brief as unknown as Parameters<typeof AICaseBriefDisplay>[0]["brief"]
                }
                generationMode={stored.generation_mode}
              />
            </div>
          )}

          {!brief && (
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                No AI brief is available for this case. The case data may still be generating.
              </p>
            </Notice>
          )}

          {/* Review history */}
          {decisions.length > 0 && (
            <div className="rounded-[--radius-card] border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-4">
                Review history
              </h2>
              <div className="space-y-4">
                {decisions.map((d) => {
                  const badge = statusBadge(d.status);
                  return (
                    <div
                      key={d.id}
                      className="rounded-[--radius-card] border border-border bg-page p-4"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-[15px] font-semibold text-ink">
                            {decisionLabel(d.decision)}
                          </p>
                          <p className="mt-0.5 text-[13px] text-muted">
                            by {shorten(d.reviewer)} ·{" "}
                            {d.submittedAt
                              ? new Date(d.submittedAt).toLocaleString()
                              : `Created ${new Date(d.createdAt).toLocaleDateString()}`}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-[--radius-pill] border px-2 py-0.5 text-[12px] ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      {d.rationale && (
                        <p className="mt-3 text-[14px] leading-relaxed text-ink">
                          {d.rationale}
                        </p>
                      )}
                      {d.clientAmount && d.workerAmount && (
                        <div className="mt-3 flex gap-4 text-[13px]">
                          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
                            Client: {d.clientAmount}
                          </span>
                          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
                            Worker: {d.workerAmount}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI disclaimer */ }
          <Notice variant="info">
            <p className="text-[15px] leading-relaxed">
              AI prepares the case. People decide. The contract settles.<br />
              <span className="text-[14px]">
                The AI brief is a structured summary, not a ruling. It never selects a winner or recommends a verdict.
              </span>
            </p>
          </Notice>
        </div>

        {/* Right column: decision panel (sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-[8rem] space-y-6">
            <ReviewerVotePanel
              onSubmit={(data) => handleSaveDraft(data)}
              onSaveDraft={(data) => handleSaveDraft(data)}
              onSupersede={(decisionId) => handleSubmit(decisionId, true)}
              existingDecision={existingDecision}
              existingDraft={existingDraft}
              isLoading={savingDraft}
              isSubmitting={submitting}
              panelError={panelError}
              panelSuccess={panelSuccess}
              protectedAmount={stored.amount_display}
            />

            {/* Contradictions & questions card */}
            {brief && (() => {
              const b = brief as Record<string, unknown>;
              const contradictions = Array.isArray(b.contradictions) ? (b.contradictions as string[]) : [];
              const questions = Array.isArray(b.questionsForReviewer) ? (b.questionsForReviewer as string[]) : [];
              const hasContent = contradictions.length > 0 || questions.length > 0;

              return (
                <div className="rounded-[--radius-card] border border-border bg-page p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                    Contradictions &amp; questions
                  </h3>
                  {hasContent ? (
                    <>
                      {contradictions.length > 0 && (
                        <ul className="mt-3 space-y-2 list-inside list-disc text-[14px] leading-relaxed text-ink">
                          {contradictions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      )}
                      {questions.length > 0 && (
                        <ul className="mt-3 space-y-2 list-inside list-disc text-[14px] leading-relaxed text-ink">
                          {questions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-[14px] leading-relaxed text-muted">
                      No contradictions or unresolved questions identified in this case.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Quick actions */}
            <div className="rounded-[--radius-card] border border-border bg-page p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Quick actions
              </h3>
              <div className="mt-3 flex flex-col gap-2">
                <Link href="/reviews">
                  <Button variant="secondary" size="sm" className="w-full">
                    ← Back to reviews
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={auth.clearAuth}
                  className="w-full"
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
