"use client";

import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import {
  recommendationLabel,
  EVALUATION_UNAVAILABLE_MESSAGE,
  type DeliveryEvaluation,
} from "@/lib/review/deliveryEvaluation";
import type { DeliveryEvaluationStatus } from "@/hooks/review/useDeliveryEvaluation";

// ---------------------------------------------------------------------------
// DeliveryReviewCard — agent-assisted delivery review display (P6.2).
//
// ADVISORY ONLY: renders the server evaluation (requirement checks, summary,
// concerns). NEVER triggers release — actions only scroll to the existing
// delivery-evidence viewer and the existing wallet-signed release control.
// Worker role sees a limited safe status (no requirements, concerns, or
// confidence internals).
// ---------------------------------------------------------------------------

interface DeliveryReviewCardProps {
  status: DeliveryEvaluationStatus;
  evaluation: DeliveryEvaluation | null;
  role: "client" | "worker";
  error: string | null;
  unavailableMessage: string | null;
  onRetry: () => void;
}

function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function RequirementIcon({ status }: { status: string }) {
  if (status === "satisfied") {
    return (
      <span aria-hidden="true" className="font-medium text-green-700">
        ✓
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span aria-hidden="true" className="font-medium text-red-700">
        !
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="font-medium text-amber-700">
      ?
    </span>
  );
}

export default function DeliveryReviewCard({
  status,
  evaluation,
  role,
  error,
  unavailableMessage,
  onRetry,
}: DeliveryReviewCardProps) {
  if (status === "idle" || status === "loading") {
    return (
      <section
        aria-label="Delivery review"
        className="rounded-[--radius-card] border border-border bg-input p-5 space-y-3"
      >
        <h4 className="text-[16px] font-semibold text-ink">
          Reclaim reviewed this delivery
        </h4>
        <p className="text-[14px] leading-relaxed text-muted" aria-live="polite">
          Reclaim is checking your delivery against the agreed terms.
        </p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section
        aria-label="Delivery review"
        className="rounded-[--radius-card] border border-border bg-input p-5 space-y-3"
      >
        <h4 className="text-[16px] font-semibold text-ink">
          Reclaim reviewed this delivery
        </h4>
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">
            {error ?? EVALUATION_UNAVAILABLE_MESSAGE}
          </p>
          <button
            type="button"
            className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
            onClick={onRetry}
          >
            Try again
          </button>
        </Notice>
      </section>
    );
  }

  if (status === "unavailable" || !evaluation) {
    return (
      <section
        aria-label="Delivery review"
        className="rounded-[--radius-card] border border-border bg-input p-5 space-y-3"
      >
        <h4 className="text-[16px] font-semibold text-ink">
          Reclaim reviewed this delivery
        </h4>
        <p className="text-[14px] leading-relaxed text-muted">
          {unavailableMessage ?? EVALUATION_UNAVAILABLE_MESSAGE}
        </p>
      </section>
    );
  }

  // Worker: limited safe status — no requirement internals, no concerns.
  if (role === "worker") {
    const headline =
      evaluation.recommendation === "ready_for_review"
        ? "Delivery ready for client review"
        : "Reclaim found something that may need clarification.";
    return (
      <section
        aria-label="Delivery review"
        className="rounded-[--radius-card] border border-border bg-input p-5 space-y-3"
      >
        <h4 className="text-[16px] font-semibold text-ink">
          Reclaim reviewed this delivery
        </h4>
        <p className="text-[14px] font-medium text-ink">{headline}</p>
        <p className="text-[14px] leading-relaxed text-muted">
          {evaluation.summary}
        </p>
        <p className="text-[13px] text-muted">
          The client reviews your delivery and decides on release.
        </p>
      </section>
    );
  }

  const needsInspection =
    evaluation.confidence === "low" ||
    evaluation.requirements.some((r) => r.status !== "satisfied");

  return (
    <section
      aria-label="Delivery review"
      className="rounded-[--radius-card] border border-border bg-input p-5 space-y-4"
    >
      <h4 className="text-[16px] font-semibold text-ink">
        Reclaim reviewed this delivery
      </h4>

      <div>
        <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
          Recommendation
        </p>
        <p className="mt-0.5 text-[15px] font-medium text-ink">
          {recommendationLabel(evaluation.recommendation)}
        </p>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
          What Reclaim checked
        </p>
        <ul className="mt-2 space-y-1.5 text-[14px]">
          {evaluation.requirements.map((req) => (
            <li key={req.requirement} className="flex items-start gap-2">
              <RequirementIcon status={req.status} />
              <span className="text-ink">
                {req.requirement}
                <span className="text-muted"> — {req.evidence}</span>
              </span>
            </li>
          ))}
          <li className="flex items-start gap-2">
            <RequirementIcon
              status={
                evaluation.deadlineStatus === "late"
                  ? "missing"
                  : evaluation.deadlineStatus === "unknown"
                    ? "unclear"
                    : "satisfied"
              }
            />
            <span className="text-ink">
              {evaluation.deadlineStatus === "on_time"
                ? "Submitted before deadline"
                : evaluation.deadlineStatus === "late"
                  ? "Submitted after deadline"
                  : "Deadline not recorded"}
            </span>
          </li>
        </ul>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
          Summary
        </p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink">
          {evaluation.summary}
        </p>
      </div>

      {evaluation.concerns.length > 0 && (
        <div>
          <p className="text-[12px] uppercase tracking-[0.08em] text-muted">
            Things to check
          </p>
          <ul className="mt-1 list-disc pl-5 text-[14px] text-ink">
            {evaluation.concerns.map((concern, i) => (
              <li key={i}>{concern}</li>
            ))}
          </ul>
        </div>
      )}

      {needsInspection && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">
            Please inspect the delivery evidence below before releasing — some
            requirements need a human look.
          </p>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => scrollToId("delivery-evidence")}
        >
          View delivery evidence
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => scrollToId("release-payment")}
        >
          Release payment
        </Button>
      </div>
      <p className="text-[13px] text-muted">
        This recommendation is advisory — releasing funds still requires your
        explicit wallet approval below. The agent never releases funds.
      </p>
    </section>
  );
}
