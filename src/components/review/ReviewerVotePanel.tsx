"use client";

// ---------------------------------------------------------------------------
// ReviewerVotePanel — decision panel for the review case page
//
// Provides:
//  - Radio options: release_to_worker, refund_to_client, partial_resolution,
//    needs_more_evidence
//  - Required rationale textarea (min 20 chars)
//  - Conditional amount inputs for partial resolution
//  - Save Draft button via onSaveDraft
//  - Submit Decision button with confirmation dialog via onSupersede
//  - Read-only display of an existing decision / draft
//  - Supersede action when an existing decision exists
// ---------------------------------------------------------------------------

import { useState, useCallback } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import Notice from "../ui/Notice";

export type DecisionValue =
  | "release_to_worker"
  | "refund_to_client"
  | "partial_resolution"
  | "needs_more_evidence";

export interface DecisionDraft {
  decision: DecisionValue;
  rationale: string;
  clientAmount?: string;
  workerAmount?: string;
}

interface ExistingDecision {
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

interface ReviewerVotePanelProps {
  /** Called with the draft data for saving */
  onSubmit?: (data: DecisionDraft) => void;
  /** Explicit save draft callback (same as onSubmit, provided for clarity) */
  onSaveDraft?: (data: DecisionDraft) => void;
  /** Called when superseding a previous decision */
  onSupersede?: (decisionId: string) => void;
  /** An existing submitted/ready_for_execution decision to display */
  existingDecision?: ExistingDecision | null;
  /** An existing draft decision to pre-populate */
  existingDraft?: ExistingDecision | null;
  /** Whether a save operation is in progress */
  isLoading?: boolean;
  /** Whether a submit is in progress */
  isSubmitting?: boolean;
  /** Error message from parent */
  panelError?: string | null;
  /** Success message from parent */
  panelSuccess?: string | null;
  /** Protected amount for context */
  protectedAmount?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Decision labels
// ---------------------------------------------------------------------------

const OPTIONS: { value: DecisionValue; label: string; description: string }[] = [
  {
    value: "release_to_worker",
    label: "Release to worker",
    description: "Funds should be released to the worker in full.",
  },
  {
    value: "refund_to_client",
    label: "Refund to client",
    description: "Funds should be returned to the client in full.",
  },
  {
    value: "partial_resolution",
    label: "Partial resolution",
    description: "Split the protected funds between both parties.",
  },
  {
    value: "needs_more_evidence",
    label: "Needs more evidence",
    description: "More evidence is required before a decision can be made.",
  },
];

function decisionLabel(decision: string): string {
  const opt = OPTIONS.find((o) => o.value === decision);
  return opt ? opt.label : decision;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shorten(str: string): string {
  if (!str) return "";
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewerVotePanel({
  onSubmit,
  onSaveDraft,
  onSupersede,
  existingDecision,
  existingDraft,
  isLoading = false,
  isSubmitting = false,
  panelError,
  panelSuccess,
  protectedAmount,
  className = "",
}: ReviewerVotePanelProps) {
  const [option, setOption] = useState<DecisionValue | "">(existingDraft?.decision as DecisionValue || "");
  const [rationale, setRationale] = useState(existingDraft?.rationale || "");
  const [clientAmount, setClientAmount] = useState(existingDraft?.clientAmount || "");
  const [workerAmount, setWorkerAmount] = useState(existingDraft?.workerAmount || "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [success, setSuccess] = useState(false);

  const saveFn = onSaveDraft || onSubmit;

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!option) {
      errs.option = "Select a decision.";
    }
    if (!rationale || rationale.trim().length < 20) {
      errs.rationale = "Rationale is required and must be at least 20 characters.";
    }
    if (option === "partial_resolution") {
      if (!clientAmount || clientAmount.trim() === "") {
        errs.clientAmount = "Enter the client portion.";
      }
      if (!workerAmount || workerAmount.trim() === "") {
        errs.workerAmount = "Enter the worker portion.";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [option, rationale, clientAmount, workerAmount]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleSaveDraft = () => {
    if (!validate()) return;
    if (!saveFn) return;

    saveFn({
      decision: option as DecisionValue,
      rationale: rationale.trim(),
      clientAmount: option === "partial_resolution" ? clientAmount : undefined,
      workerAmount: option === "partial_resolution" ? workerAmount : undefined,
    });
    setSuccess(true);
  };

  const handleOpenConfirm = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setConfirmOpen(false);
    // First save the draft, then submit
    if (!saveFn) return;

    saveFn({
      decision: option as DecisionValue,
      rationale: rationale.trim(),
      clientAmount: option === "partial_resolution" ? clientAmount : undefined,
      workerAmount: option === "partial_resolution" ? workerAmount : undefined,
    });
  };

  // -------------------------------------------------------------------------
  // Render: Existing submitted decision (readonly)
  // -------------------------------------------------------------------------

  if (existingDecision && !option && !existingDraft) {
    const badgeClass =
      existingDecision.status === "ready_for_execution"
        ? "bg-status-protected-bg text-status-protected-text border-success/30"
        : "bg-gold/10 text-gold border-gold/30";

    return (
      <div
        className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Existing decision
        </h3>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`rounded-[--radius-pill] border px-2 py-0.5 text-[12px] ${badgeClass}`}>
              {existingDecision.status === "ready_for_execution" ? "Ready for execution" : "Submitted"}
            </span>
          </div>

          <p className="text-[15px] font-semibold text-ink">
            {decisionLabel(existingDecision.decision)}
          </p>

          <p className="text-[14px] leading-relaxed text-ink">
            {existingDecision.rationale}
          </p>

          {existingDecision.clientAmount && existingDecision.workerAmount && (
            <div className="flex gap-4 text-[13px]">
              <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
                Client: {existingDecision.clientAmount}
              </span>
              <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
                Worker: {existingDecision.workerAmount}
              </span>
            </div>
          )}

          <div className="text-[12px] text-muted">
            {existingDecision.submittedAt
              ? `Submitted ${new Date(existingDecision.submittedAt).toLocaleString()}`
              : `Created ${new Date(existingDecision.createdAt).toLocaleDateString()}`}
            {" · "}by {shorten(existingDecision.reviewer)}
          </div>
        </div>

        {/* Supersede button */}
        {onSupersede && (
          <div className="mt-5 border-t border-border pt-5">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={isSubmitting}
              onClick={() => onSupersede(existingDecision.id)}
            >
              {isSubmitting ? "Superseding…" : "Supersede this decision"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Active decision form
  // -------------------------------------------------------------------------

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Your decision
      </h3>

      {protectedAmount && (
        <p className="mt-2 text-[13px] text-muted">
          Protected amount:{" "}
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
            {protectedAmount}
          </span>
        </p>
      )}

      {/* Panel-level messages */}
      {panelError && (
        <Notice variant="warning" className="mt-3">
          <p className="text-[13px] leading-relaxed">{panelError}</p>
        </Notice>
      )}
      {panelSuccess && (
        <Notice variant="success" className="mt-3">
          <p className="text-[13px] leading-relaxed">{panelSuccess}</p>
        </Notice>
      )}
      {success && !panelSuccess && !panelError && (
        <Notice variant="success" className="mt-3">
          <p className="text-[13px] leading-relaxed">Draft saved. Use Submit when ready.</p>
        </Notice>
      )}

      {/* Decision radio options */}
      <fieldset className="mt-4 space-y-3">
        <legend className="text-[15px] font-medium text-ink mb-2">Select outcome</legend>
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 rounded-[--radius-card] border p-4 cursor-pointer transition-colors ${
              option === opt.value
                ? "border-gold bg-input"
                : "border-border hover:bg-input"
            }`}
          >
            <input
              type="radio"
              name="review-decision"
              value={opt.value}
              checked={option === opt.value}
              onChange={() => {
                setOption(opt.value);
                if (errors.option) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.option;
                    return next;
                  });
                }
              }}
              className="mt-0.5 h-4 w-4 accent-gold shrink-0"
            />
            <div>
              <span className="text-[15px] font-medium text-ink">{opt.label}</span>
              <p className="mt-0.5 text-[13px] text-muted leading-relaxed">
                {opt.description}
              </p>
            </div>
          </label>
        ))}
      </fieldset>
      {errors.option && (
        <p className="mt-2 text-[13px] text-red-600" role="alert">
          {errors.option}
        </p>
      )}

      {/* Partial resolution amounts */}
      {option === "partial_resolution" && (
        <div className="mt-5 border-t border-border pt-5 space-y-4">
          <h4 className="text-[14px] font-semibold text-ink">
            Split allocation{" "}
            <span className="text-[13px] font-normal text-muted">
              (in atomic units, e.g. 50000000 for 50 USDC)
            </span>
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Client amount"
              type="text"
              placeholder="0"
              value={clientAmount}
              onChange={(e) => {
                setClientAmount(e.target.value);
                if (errors.clientAmount) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.clientAmount;
                    return next;
                  });
                }
              }}
              error={errors.clientAmount}
            />
            <Input
              label="Worker amount"
              type="text"
              placeholder="0"
              value={workerAmount}
              onChange={(e) => {
                setWorkerAmount(e.target.value);
                if (errors.workerAmount) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.workerAmount;
                    return next;
                  });
                }
              }}
              error={errors.workerAmount}
            />
          </div>
        </div>
      )}

      {/* Rationale */}
      <div className="mt-5 border-t border-border pt-5">
        <label className="text-[14px] font-medium text-ink">
          Rationale <span className="text-red-600">*</span>
        </label>
        <p className="mt-0.5 text-[12px] text-muted">
          Explain the reasoning behind your decision. Minimum 20 characters.
        </p>
        <textarea
          value={rationale}
          onChange={(e) => {
            setRationale(e.target.value);
            if (errors.rationale) {
              setErrors((prev) => {
                const next = { ...prev };
                delete next.rationale;
                return next;
              });
            }
          }}
          placeholder="Based on the agreement terms, evidence provided, and on-chain facts…"
          rows={5}
          className={`mt-2 w-full rounded-[--radius-input] border bg-input px-4 py-3 text-[15px] text-ink placeholder:text-muted transition-colors focus:border-gold focus:outline-none resize-vertical ${
            errors.rationale ? "border-red-600" : "border-border"
          }`}
          aria-invalid={errors.rationale ? "true" : undefined}
        />
        {errors.rationale && (
          <p className="mt-1 text-[13px] text-red-600" role="alert">
            {errors.rationale}
          </p>
        )}
        <p className="mt-1 text-[12px] text-muted tabular-nums">
          {rationale.trim().length} / 20 min characters
        </p>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full"
          onClick={handleSaveDraft}
          disabled={isLoading}
        >
          {isLoading ? "Saving…" : "Save draft"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={handleOpenConfirm}
        >
          Submit decision
        </Button>
      </div>

      {/* Confirmation dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm your decision"
        primaryLabel="Submit decision"
        onPrimary={handleConfirmSubmit}
        secondaryLabel="Continue editing"
      >
        <div className="space-y-3">
          <p className="text-[15px]">
            <strong>Decision:</strong>{" "}
            {decisionLabel(option as string) || "Not selected"}
          </p>
          {option === "partial_resolution" && (
            <p className="text-[15px]">
              <strong>Split:</strong>{" "}
              <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
                Client: {clientAmount || "—"} / Worker: {workerAmount || "—"}
              </span>
            </p>
          )}
          <p className="text-[14px] text-muted">
            <strong>Rationale:</strong> {rationale}
          </p>
          <p className="text-[13px] text-muted italic mt-3">
            Your decision will become part of the settlement record. Once submitted, it
            cannot be reversed — only superseded by a new decision. No funds are moved
            automatically; execution happens separately.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
