"use client";

import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import type { DeliveryPackage } from "@/lib/delivery/deliveryIntent";

// ---------------------------------------------------------------------------
// DeliveryConfirmationCard — structured confirm-before-submit (P6.3).
//
// Mirrors the PolicyConfirmationCard pattern: renders validated package
// values only. NOTHING executes here — the worker must explicitly click
// "Submit delivery", which hands into the existing submitEvidenceHash flow
// via callback. "Edit details" returns to the conversational thread with the
// accumulated draft intact.
//
// Copy is advisory only: this card NEVER claims the delivery is verified.
// ---------------------------------------------------------------------------

interface DeliveryConfirmationCardProps {
  pkg: DeliveryPackage;
  protectedLabel: string;
  onSubmit: () => void;
  onEdit: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

export default function DeliveryConfirmationCard({
  pkg,
  protectedLabel,
  onSubmit,
  onEdit,
  isSubmitting,
  submitError,
}: DeliveryConfirmationCardProps) {
  const references = Array.isArray(pkg.references) ? pkg.references : [];
  const relatedDeliverable =
    pkg.relatedDeliverable.trim() !== "" ? pkg.relatedDeliverable : "—";

  return (
    <section
      aria-label="Delivery confirmation"
      className="rounded-[--radius-card] border border-border bg-surface p-6 md:p-8"
    >
      <h2 className="text-[20px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
        You&apos;re submitting
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        Reclaim understood your delivery as the evidence below. Nothing moves
        until you confirm.
      </p>

      <div className="mt-6 space-y-4 text-[14px]">
        <div>
          <p className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Summary
          </p>
          <p className="mt-1 font-medium text-ink">{pkg.title}</p>
          {pkg.description && (
            <p className="mt-1 leading-relaxed text-ink">{pkg.description}</p>
          )}
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Evidence
          </p>
          {references.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {references.map((ref, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden="true" className="font-medium text-ink">
                    ✓
                  </span>
                  <span className="break-all text-ink">
                    {ref.label ?? ref.type}: {ref.value}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">—</p>
          )}
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Related deliverable
          </p>
          <p className="mt-1 text-ink">{relatedDeliverable}</p>
        </div>

        <div>
          <p className="text-[13px] uppercase tracking-[0.08em] text-muted">
            Payment
          </p>
          <p className="mt-1 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
            {protectedLabel}
          </p>
        </div>
      </div>

      {submitError && (
        <div className="mt-6">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">{submitError}</p>
          </Notice>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit delivery"}
        </Button>
        <Button variant="secondary" onClick={onEdit} disabled={isSubmitting}>
          Edit details
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-muted">
        Reclaim will record a hash of this delivery on-chain. Private delivery
        details remain available only to authorized payment parties.
      </p>
      <p className="mt-1 text-[13px] text-muted">
        This has not been verified yet — the client reviews it before any
        release.
      </p>
    </section>
  );
}
