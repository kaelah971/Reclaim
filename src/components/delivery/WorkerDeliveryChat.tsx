"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import DeliveryChatBox from "./DeliveryChatBox";
import DeliveryConfirmationCard from "./DeliveryConfirmationCard";
import type {
  DeliveryIntentDraft,
  DeliveryMissingField,
  DeliveryPackage,
} from "@/lib/delivery/deliveryIntent";
import {
  deliveryDraftToPackage,
  deliveryPackageToEvidenceFormData,
} from "@/lib/delivery/deliveryIntent";
import type { EvidenceFormData } from "@/lib/evidence/manifest";

// ---------------------------------------------------------------------------
// WorkerDeliveryChat — conversational delivery worker (P6.3).
//
// Scoped thread: delivery, evidence, job status and payment readiness only.
// The worker describes the delivery; each message POSTs to the parse API
// with the accumulated draft + transcript (merge handled server-side). When
// the draft is ready, a confirmation card maps the package to
// EvidenceFormData via the lib helper and hands it to the existing
// submitEvidenceHash flow — ONLY on explicit "Submit delivery" click.
//
// NO transaction broadcast lives here: submission and payment requests go
// out exclusively through onSubmitDelivery / onRequestPayment callbacks
// (explicit worker clicks). The parent gates this component by role+state.
// ---------------------------------------------------------------------------

export interface ConversationalSubmitState {
  isPending: boolean;
  isTxConfirmed: boolean;
  isSuccess: boolean;
  txHash?: `0x${string}` | undefined;
  error: string | null;
  metadataState: string;
  metadataError: string | null;
}

export interface RequestPaymentState {
  isPending: boolean;
  isSuccess: boolean;
  error: string | null;
  txHash?: `0x${string}` | undefined;
}

export type DeliveryChatReviewStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

interface WorkerDeliveryChatProps {
  paymentIdStr: string;
  chainId: number;
  workerAddress: string;
  deliverables: string[];
  evidenceRequirements: string[];
  agreementLabel: string;
  protectedLabel: string;
  releaseMode: "manual" | "agent_assisted";
  onSubmitDelivery: (data: EvidenceFormData) => void;
  submitState: ConversationalSubmitState;
  onRequestPayment: () => void;
  requestState: RequestPaymentState;
  reviewStatus: DeliveryChatReviewStatus;
}

interface DeliveryParseResponse {
  ok: boolean;
  draft: DeliveryIntentDraft;
  missingFields: DeliveryMissingField[];
  clarifyingQuestion: string | null;
  ready: boolean;
  rejected: boolean;
  boundaryMessage: string | null;
  errors: string[];
  paymentId: string;
  chainId: number;
  worker: string;
  aiUnavailable?: boolean;
}

const AI_UNAVAILABLE_MESSAGE =
  "Reclaim could not interpret that delivery right now. Try again in a moment — nothing was submitted.";
const TRANSPORT_ERROR_MESSAGE =
  "Reclaim could not interpret that delivery note right now. Nothing was submitted — try again in a moment.";

export default function WorkerDeliveryChat({
  paymentIdStr,
  chainId,
  workerAddress,
  deliverables,
  evidenceRequirements,
  agreementLabel,
  protectedLabel,
  releaseMode,
  onSubmitDelivery,
  submitState,
  onRequestPayment,
  requestState,
  reviewStatus,
}: WorkerDeliveryChatProps) {
  const [draft, setDraft] = useState<DeliveryIntentDraft>(
    {} as DeliveryIntentDraft,
  );
  const [messagesText, setMessagesText] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<DeliveryMissingField[]>([]);
  const [rejected, setRejected] = useState(false);
  const [boundaryMessage, setBoundaryMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [confirmedPkg, setConfirmedPkg] = useState<DeliveryPackage | null>(null);
  const [editing, setEditing] = useState(false);

  const manualHref = `/payments/${paymentIdStr}/evidence${chainId ? `?chainId=${chainId}` : ""}`;

  async function handleMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed || isWorking) return;
    // Accumulate the transcript BEFORE sending (prior text + new message).
    const nextMessagesText = messagesText
      ? `${messagesText}\nworker: ${trimmed}`
      : `worker: ${trimmed}`;
    setMessagesText(nextMessagesText);
    setIsWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentIdStr}/delivery/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          draft,
          messagesText: nextMessagesText,
          paymentContext: {
            chainId,
            worker: workerAddress,
            deliverables,
            evidenceRequirements,
            agreementLabel,
          },
        }),
      });
      let data: DeliveryParseResponse | null = null;
      try {
        data = (await res.json()) as DeliveryParseResponse;
      } catch {
        data = null;
      }
      if (!res.ok || !data || !data.ok) {
        const serverErrors =
          data && Array.isArray(data.errors) && data.errors.length > 0
            ? data.errors
            : null;
        setError(
          serverErrors
            ? serverErrors.join(" ")
            : `Reclaim could not interpret that delivery note (HTTP ${res.status}). Nothing was submitted.`,
        );
        // Transport failure keeps the prior draft so clarification can resume.
        if (data && data.draft) setDraft(data.draft);
        return;
      }
      // Clarification preserves the prior draft: the server merges, and the
      // local draft always tracks the returned draft.
      if (data.draft) setDraft(data.draft);
      setMissingFields(Array.isArray(data.missingFields) ? data.missingFields : []);
      setQuestion(data.clarifyingQuestion ?? null);
      setRejected(Boolean(data.rejected));
      setBoundaryMessage(data.boundaryMessage ?? null);
      setErrors(Array.isArray(data.errors) ? data.errors : []);
      if (data.aiUnavailable) {
        setError(AI_UNAVAILABLE_MESSAGE);
        return;
      }
      if (data.ready && !data.rejected) {
        const { pkg, errors: packageErrors } = deliveryDraftToPackage(
          data.draft ?? {},
          {
            paymentId: paymentIdStr,
            chainId: chainId as 42220 | 11142220,
            worker: workerAddress,
          },
        );
        if (pkg) {
          setConfirmedPkg(pkg);
          setEditing(false);
        } else {
          setErrors(
            packageErrors.length > 0
              ? packageErrors
              : [
                  "Reclaim could not structure that delivery yet. Add a detail or use the manual form — nothing was submitted.",
                ],
          );
        }
      }
    } catch {
      setError(TRANSPORT_ERROR_MESSAGE);
    } finally {
      setIsWorking(false);
    }
  }

  // ---- Success: delivery submitted (tx confirmed + metadata persisted) ----
  // One concise payment request — NEVER auto-called. Disabled + the parent
  // hook lock guard double-execution.
  if (submitState.isSuccess) {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Delivery submitted
        </h3>
        {submitState.txHash && (
          <p className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {submitState.txHash}
          </p>
        )}
        {releaseMode === "agent_assisted" ? (
          <p
            className="text-[14px] leading-relaxed text-muted"
            data-review-status={reviewStatus}
          >
            Reclaim is checking your delivery against the agreed terms.
          </p>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onRequestPayment}
          disabled={requestState.isPending || requestState.isSuccess}
        >
          {requestState.isPending
            ? "Requesting…"
            : requestState.isSuccess
              ? "Request confirmed"
              : "Request payment"}
        </Button>
        {requestState.error && (
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">{requestState.error}</p>
          </Notice>
        )}
        {requestState.txHash && (
          <p className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {requestState.txHash}
          </p>
        )}
        <p className="text-[13px] text-muted">
          Requesting payment still requires your explicit wallet approval —
          nothing is auto-signed.
        </p>
      </div>
    );
  }

  // ---- Ready: confirm-before-submit (nothing submitted yet) ----
  if (confirmedPkg && !editing) {
    return (
      <div className="space-y-4">
        <DeliveryConfirmationCard
          pkg={confirmedPkg}
          protectedLabel={protectedLabel}
          onSubmit={() =>
            onSubmitDelivery(deliveryPackageToEvidenceFormData(confirmedPkg))
          }
          onEdit={() => setEditing(true)}
          isSubmitting={submitState.isPending}
          submitError={submitState.error}
        />
      </div>
    );
  }

  // ---- Thread: conversational draft + clarifications ----
  // Full DeliveryChatBox (own card, heading, click-to-send examples) stacked
  // with a thread card for clarifications, scope, and the manual fallback.
  return (
    <div className="space-y-4">
      <DeliveryChatBox
        onSubmit={handleMessage}
        isWorking={isWorking}
        error={error}
        boundaryMessage={rejected ? null : boundaryMessage}
      />
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-3">
        <div aria-live="polite" className="space-y-3">
          {question && (
            <div className="rounded-[--radius-card] border border-border bg-page p-4">
              <p className="text-[14px] leading-relaxed text-ink">{question}</p>
              {missingFields.length > 0 && (
                <p className="mt-1 text-[13px] text-muted">
                  Still needed: {missingFields.map((f) => String(f)).join(", ")}.
                </p>
              )}
            </div>
          )}
          {rejected && (
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">
                {boundaryMessage ??
                  "Reclaim can't help with that here. Delivery, evidence, job status and payment readiness only."}
              </p>
            </Notice>
          )}
          {errors.length > 0 && (
            <Notice variant="warning">
              <ul className="list-disc pl-5 text-[14px] leading-relaxed space-y-1">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
        <p className="text-[13px] text-muted">
          This chat handles delivery, evidence, job status and payment readiness
          only.
        </p>
        <p className="text-[13px] text-muted">
          Prefer the full form?{" "}
          <a
            href={manualHref}
            className="font-medium text-gold hover:text-gold/80 transition-colors"
          >
            Add evidence manually.
          </a>
        </p>
      </div>
    </div>
  );
}
