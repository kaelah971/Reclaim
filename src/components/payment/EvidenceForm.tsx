"use client";

import { useState, useEffect } from "react";
import { keccak256, stringToHex } from "viem";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Select from "../ui/Select";
import Button from "../ui/Button";
import FileSelectionField from "./FileSelectionField";
import Notice from "../ui/Notice";
import { PAYMENT_TOKEN_SYMBOL } from "@/lib/web3/tokens";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export interface EvidenceFormData {
  title: string;
  description: string;
  type: string;
  relatedClaim: string;
  date: string;
  externalRef: string;
  pastedText: string;
  file: File | null;
  fileHash: string;
}

export function buildEvidenceManifest(data: EvidenceFormData): string {
  return [
    `title:${data.title.trim()}`,
    data.type ? `type:${data.type}` : null,
    data.relatedClaim.trim() ? `claim:${data.relatedClaim.trim()}` : null,
    data.date ? `date:${data.date}` : null,
    data.externalRef.trim() ? `ref:${data.externalRef.trim()}` : null,
    data.pastedText.trim() ? `text:${data.pastedText.trim()}` : null,
    data.fileHash ? `file-sha256:${data.fileHash}` : null,
  ].filter(Boolean).join(" | ");
}

interface EvidenceFormProps {
  onSubmit?: (data: EvidenceFormData) => void;
  onCheckStrength?: () => void;
  submitted?: boolean;
  onReset?: () => void;
  className?: string;
}

export default function EvidenceForm({
  onSubmit,
  onCheckStrength,
  submitted = false,
  onReset,
  className = "",
}: EvidenceFormProps) {
  const [form, setForm] = useState<EvidenceFormData>({
    title: "",
    description: "",
    type: "",
    relatedClaim: "",
    date: "",
    externalRef: "",
    pastedText: "",
    file: null,
    fileHash: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EvidenceFormData, string>>>({});
  const [filePending, setFilePending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const update = (field: keyof EvidenceFormData, value: string | File | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (field === "file") {
      const file = value as File | null;
      if (!file) {
        setForm((prev) => ({ ...prev, fileHash: "" }));
        setFilePending(false);
      } else if (file.size > MAX_FILE_SIZE) {
        setForm((prev) => ({ ...prev, fileHash: "" }));
        setFilePending(false);
        setErrors((prev) => ({
          ...prev,
          file: "File is larger than 50 MB. Hash a smaller file or provide an external link instead.",
        }));
      }
    }
  };

  useEffect(() => {
    const file = form.file;
    if (!file || file.size > MAX_FILE_SIZE) {
      return;
    }
    const pendingTimer = setTimeout(() => {
      setFilePending(true);
    }, 0);
    let cancelled = false;
    file
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) return;
        return crypto.subtle.digest("SHA-256", buffer);
      })
      .then((hashBuffer) => {
        if (cancelled || !hashBuffer) return;
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex =
          "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        setForm((prev) => ({ ...prev, fileHash: hashHex }));
        setFilePending(false);
      })
      .catch(() => {
        if (!cancelled) {
          setForm((prev) => ({ ...prev, fileHash: "" }));
          setFilePending(false);
        }
      });
    return () => {
      clearTimeout(pendingTimer);
      cancelled = true;
    };
  }, [form.file]);

  const validate = (): boolean => {
    const errs: Partial<Record<keyof EvidenceFormData, string>> = {};
    if (!form.title.trim()) errs.title = "Evidence title is required.";
    if (!form.type) errs.type = "Evidence type is required.";
    if (!form.pastedText.trim() && !form.file && !form.externalRef.trim()) {
      errs.pastedText =
        "Provide at least one piece of evidence: a file, pasted text, or external reference.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setReviewing(true);
  };

  const handleConfirm = () => {
    onSubmit?.(form);
  };

  if (submitted) {
    return (
      <div className={className}>
        <Notice variant="info">
          Evidence reference submitted on-chain.
        </Notice>
        <Button variant="secondary" className="mt-4" onClick={onReset}>
          Edit evidence
        </Button>
      </div>
    );
  }

  if (reviewing) {
    const manifest = buildEvidenceManifest(form);
    const reference = keccak256(stringToHex(manifest));
    return (
      <div className={`space-y-6 ${className}`}>
        <div>
          <h3 className="text-[16px] font-semibold text-ink">Review evidence manifest</h3>
          <p className="mt-1 text-[14px] text-muted">
            Confirm the manifest below before it is hashed and recorded on-chain.
          </p>
        </div>
        <div className="rounded-[--radius-card] border border-border bg-page p-4">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
            Evidence manifest
          </p>
          <p className="mt-2 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
            {manifest}
          </p>
        </div>
        <div className="rounded-[--radius-card] border border-border bg-page p-4">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
            On-chain verification reference (keccak256)
          </p>
          <p className="mt-2 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
            {reference}
          </p>
        </div>
        <Notice variant="info">
          Only this 32-byte reference is recorded on-chain. It proves the manifest and file have
          not changed — it does not prove the claims are true. Keep your files and this manifest
          safe; they remain private and off-chain.
        </Notice>
        <div className="flex items-center gap-3">
          <Button onClick={handleConfirm}>Confirm and submit</Button>
          <Button variant="secondary" onClick={() => setReviewing(false)}>
            Edit evidence
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Input
        label="Evidence title"
        placeholder="Final Figma file delivery"
        value={form.title}
        onChange={(e) => update("title", e.target.value)}
        error={errors.title}
      />

      <Textarea
        label="Evidence description"
        placeholder="Describe what this evidence shows and how it relates to the deliverable."
        value={form.description}
        onChange={(e) => update("description", e.target.value)}
      />

      <Select
        label="Evidence type"
        value={form.type}
        onChange={(e) => update("type", e.target.value)}
        error={errors.type}
      >
        <option value="">Select evidence type</option>
        <option value="delivery-file">Delivery file</option>
        <option value="message">Message or conversation</option>
        <option value="revision-record">Revision record</option>
        <option value="agreement-reference">Agreement reference</option>
        <option value="payment-reference">Payment reference</option>
        <option value="other">Other</option>
      </Select>

      <Input
        label="Related deliverable or claim"
        placeholder="Landing page Figma file"
        value={form.relatedClaim}
        onChange={(e) => update("relatedClaim", e.target.value)}
      />

      <Input
        label="Date"
        type="date"
        value={form.date}
        onChange={(e) => update("date", e.target.value)}
      />

      <FileSelectionField
        label="File"
        helper="Select a file from your device. Files remain private and off-chain."
        onChange={(file) => update("file", file)}
      />
      {errors.file && (
        <p className="mt-1 text-[13px] text-red-500">{errors.file}</p>
      )}
      {form.file && !errors.file && filePending && (
        <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted">
          Computing file hash…
        </p>
      )}
      {form.file && !errors.file && !filePending && form.fileHash && (
        <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
          SHA-256: {form.fileHash}
        </p>
      )}

      <Textarea
        label="Pasted text or notes"
        placeholder="Paste relevant text, messages, or notes."
        value={form.pastedText}
        onChange={(e) => update("pastedText", e.target.value)}
        error={errors.pastedText}
      />

      <Input
        label="External link or reference"
        placeholder="https://..."
        value={form.externalRef}
        onChange={(e) => update("externalRef", e.target.value)}
      />

      <Notice variant="info">
        Files remain private and off-chain. Reclaim records a verification reference.
      </Notice>

      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit}>Add evidence</Button>
        <button
          type="button"
          className="text-[14px] font-medium text-gold hover:text-gold/80 transition-colors"
          onClick={() => onCheckStrength?.()}
        >
          Check evidence strength — 0.01 {PAYMENT_TOKEN_SYMBOL}
        </button>
      </div>
    </div>
  );
}
