"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Notice from "@/components/ui/Notice";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import {
  buildEvidenceManifest,
  keccak256,
  stringToHex,
  type EvidenceFormData,
} from "@/lib/evidence/manifest";

// ---------------------------------------------------------------------------
// EvidenceRecoveryCard — P6.4E durable metadata recovery (metadata-only).
//
// When the on-chain delivery exists but the private delivery details were
// never persisted (stale-read 400 wiped by refresh), the worker re-enters
// the EXACT details. The Save button is enabled ONLY when the live hash of
// the form matches the on-chain reference byte-exactly.
//
// Metadata-only: saving goes through the hook's recoverMetadata POST and
// never submits an on-chain transaction. No chain writes live here.
// ---------------------------------------------------------------------------

/** Canonical evidence types (mirrors DELIVERY_EVIDENCE_TYPES + EvidenceForm). */
const EVIDENCE_TYPE_OPTIONS = [
  { value: "delivery-file", label: "Delivery file" },
  { value: "message", label: "Message or conversation" },
  { value: "revision-record", label: "Revision record" },
  { value: "agreement-reference", label: "Agreement reference" },
  { value: "payment-reference", label: "Payment reference" },
  { value: "other", label: "Other" },
] as const;

export interface EvidenceRecoveryInitialData {
  title?: string;
  description?: string;
  type?: string;
  relatedClaim?: string;
  pastedText?: string;
  externalRef?: string;
  fileHash?: string;
}

interface EvidenceRecoveryCardProps {
  paymentIdStr: string;
  chainId: number;
  onChainReference: string;
  /** Derived from payment.deliveryAt on-chain — critical for byte-exact match. */
  deliveryDayISO: string;
  /** Prefill for title/description/type/relatedClaim/pastedText/externalRef. */
  initialData: EvidenceRecoveryInitialData;
  onRecover: (data: EvidenceFormData) => void;
  recovering: boolean;
  recoverError: string | null;
}

export default function EvidenceRecoveryCard({
  paymentIdStr,
  chainId,
  onChainReference,
  deliveryDayISO,
  initialData,
  onRecover,
  recovering,
  recoverError,
}: EvidenceRecoveryCardProps) {
  const [title, setTitle] = useState(initialData.title ?? "");
  const [description, setDescription] = useState(initialData.description ?? "");
  const [type, setType] = useState(initialData.type ?? "");
  const [relatedClaim, setRelatedClaim] = useState(
    initialData.relatedClaim ?? "",
  );
  const [date, setDate] = useState(deliveryDayISO);
  const [externalRef, setExternalRef] = useState(initialData.externalRef ?? "");
  const [pastedText, setPastedText] = useState(initialData.pastedText ?? "");
  // Text-only recovery path: file hash is carried (byte-exactness) but not
  // edited here. Empty for text-only deliveries such as Payment #3.
  const [fileHash] = useState(initialData.fileHash ?? "");

  const formData: EvidenceFormData = useMemo(
    () => ({
      title,
      description,
      type,
      relatedClaim,
      date,
      externalRef,
      pastedText,
      fileHash,
    }),
    [title, description, type, relatedClaim, date, externalRef, pastedText, fileHash],
  );

  const { computedHash, matches } = useMemo(() => {
    try {
      const manifest = buildEvidenceManifest(formData);
      const hash = keccak256(stringToHex(manifest)).toLowerCase();
      return {
        computedHash: hash,
        matches: hash === onChainReference.toLowerCase(),
      };
    } catch {
      return { computedHash: "", matches: false };
    }
  }, [formData, onChainReference]);

  return (
    <div
      className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-4"
      data-testid={`evidence-recovery-${paymentIdStr}-${chainId}`}
    >
      <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Recover delivery details
      </h4>
      <p className="text-[13px] leading-relaxed text-muted">
        Re-enter the exact delivery details so their hash matches the on-chain
        record. Saving only stores the private details — nothing is resubmitted
        on-chain.
      </p>
      <Input
        label="Evidence title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        label="Evidence description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Select
        label="Evidence type"
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        <option value="">Select evidence type</option>
        {EVIDENCE_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      <Input
        label="Related deliverable or claim"
        value={relatedClaim}
        onChange={(e) => setRelatedClaim(e.target.value)}
      />
      <Input
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        helper="Defaults to the on-chain delivery day — keep it exact."
      />
      <Input
        label="External link or reference"
        placeholder="https://..."
        value={externalRef}
        onChange={(e) => setExternalRef(e.target.value)}
      />
      <Textarea
        label="Pasted text or notes"
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
      />
      <div aria-live="polite">
        {matches ? (
          <p className="text-[13px] font-medium text-ink">
            Matches on-chain record ✓
          </p>
        ) : (
          <p className="text-[13px] text-muted">
            Does not match the on-chain record yet.
          </p>
        )}
        {computedHash && (
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {computedHash}
          </p>
        )}
      </div>
      {recoverError && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{recoverError}</p>
        </Notice>
      )}
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={!matches || recovering}
        onClick={() => onRecover(formData)}
      >
        {recovering ? "Saving…" : "Save details"}
      </Button>
    </div>
  );
}
