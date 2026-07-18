"use client";

import { useState } from "react";
import { keccak256, stringToHex } from "viem";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Notice from "../ui/Notice";

export interface DisputeFormData {
  reason: string;
  disputedPortion: string;
  expectedOutcome: string;
  evidence: string;
  resolutionAttempts: string;
  additionalContext: string;
}

export function buildDisputeManifest(data: DisputeFormData): string {
  return [
    `reason:${data.reason.trim()}`,
    data.disputedPortion.trim() ? `portion:${data.disputedPortion.trim()}` : null,
    data.expectedOutcome ? `outcome:${data.expectedOutcome}` : null,
    data.evidence.trim() ? `evidence:${data.evidence.trim()}` : null,
    data.resolutionAttempts.trim() ? `attempts:${data.resolutionAttempts.trim()}` : null,
    data.additionalContext.trim() ? `context:${data.additionalContext.trim()}` : null,
  ].filter(Boolean).join(" | ");
}

interface DisputeFormProps {
  onSubmit?: (data: DisputeFormData) => void;
  submitted?: boolean;
  onReset?: () => void;
  className?: string;
}

export default function DisputeForm({
  onSubmit,
  submitted = false,
  onReset,
  className = "",
}: DisputeFormProps) {
  const [form, setForm] = useState<DisputeFormData>({
    reason: "",
    disputedPortion: "",
    expectedOutcome: "",
    evidence: "",
    resolutionAttempts: "",
    additionalContext: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof DisputeFormData, string>>>({});
  const [reviewing, setReviewing] = useState(false);

  const update = (field: keyof DisputeFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof DisputeFormData, string>> = {};
    if (!form.reason.trim()) errs.reason = "Please describe the reason for the dispute.";
    if (!form.expectedOutcome) errs.expectedOutcome = "Please select an expected outcome.";
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
        <Notice variant="warning">
          Dispute opened on-chain. Funds are frozen.
        </Notice>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={onReset}
        >
          Edit dispute details
        </Button>
      </div>
    );
  }

  if (reviewing) {
    const manifest = buildDisputeManifest(form);
    const reference = keccak256(stringToHex(manifest));
    return (
      <div className={`space-y-6 ${className}`}>
        <div>
          <h3 className="text-[16px] font-semibold text-ink">Review dispute details</h3>
          <p className="mt-1 text-[14px] text-muted">
            Confirm the dispute manifest below before it is hashed and recorded on-chain.
          </p>
        </div>
        <div className="rounded-[--radius-card] border border-border bg-page p-4">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
            Dispute manifest
          </p>
          <p className="mt-2 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
            {manifest}
          </p>
        </div>
        <div className="rounded-[--radius-card] border border-border bg-page p-4">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
            On-chain dispute reference (keccak256)
          </p>
          <p className="mt-2 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
            {reference}
          </p>
        </div>
        <Notice variant="warning">
          Opening a dispute freezes the protected funds in the contract. No one — including
          Reclaim — can release or cancel the payment while it is disputed. Reviewer settlement
          is not connected yet, so disputed funds stay frozen until it ships. No winner is
          selected automatically and AI does not decide the outcome.
        </Notice>
        <div className="flex items-center gap-3">
          <Button onClick={handleConfirm} variant="destructive">
            Confirm and open dispute
          </Button>
          <Button variant="secondary" onClick={() => setReviewing(false)}>
            Edit details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Textarea
        label="Reason for dispute"
        placeholder="Explain what part of the agreement was not met and why you are opening this dispute."
        value={form.reason}
        onChange={(e) => update("reason", e.target.value)}
        error={errors.reason}
      />

      <Input
        label="Disputed portion of the deliverable"
        placeholder="e.g. Mobile responsive design was not included"
        value={form.disputedPortion}
        onChange={(e) => update("disputedPortion", e.target.value)}
      />

      <Select
        label="Expected outcome"
        value={form.expectedOutcome}
        onChange={(e) => update("expectedOutcome", e.target.value)}
        error={errors.expectedOutcome}
      >
        <option value="">Select expected outcome</option>
        <option value="client-refund">Client refund — funds return to client</option>
        <option value="worker-release">Worker release — funds release to worker</option>
        <option value="split">Split settlement — funds divided between parties</option>
      </Select>

      <Textarea
        label="Relevant evidence"
        placeholder="List the evidence that supports your claim. Reference previously submitted evidence where applicable."
        value={form.evidence}
        onChange={(e) => update("evidence", e.target.value)}
      />

      <Textarea
        label="Attempts made to resolve the issue"
        placeholder="Describe any communication or steps you have already taken to resolve this before opening a dispute."
        value={form.resolutionAttempts}
        onChange={(e) => update("resolutionAttempts", e.target.value)}
      />

      <Textarea
        label="Additional context"
        placeholder="Any other information that may help reviewers understand the situation."
        value={form.additionalContext}
        onChange={(e) => update("additionalContext", e.target.value)}
      />

      <div className="rounded-[--radius-card] border border-border bg-page p-5">
        <h4 className="text-[14px] font-semibold text-ink">What happens next</h4>
        <ol className="mt-3 space-y-2 text-[14px] leading-relaxed text-muted list-decimal list-inside">
          <li>Funds remain frozen.</li>
          <li>Both sides may submit evidence.</li>
          <li>AI organises the claims and evidence.</li>
          <li>Reviewers assess the case.</li>
          <li>The contract will settle the outcome when reviewer settlement ships (not yet connected).</li>
        </ol>
        <p className="mt-4 text-[14px] italic text-muted border-t border-border pt-4">
          AI prepares the case. People decide. The contract settles.
        </p>
      </div>

      <div className="rounded-[--radius-card] border border-border bg-surface p-5">
        <h4 className="text-[14px] font-semibold text-ink">Possible outcomes</h4>
        <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-muted list-disc list-inside">
          <li>Client wins — funds return to client</li>
          <li>Worker wins — funds release to worker</li>
          <li>Split settlement — funds divided by reviewer decision</li>
        </ul>
      </div>

      <Button onClick={handleSubmit} variant="destructive" size="lg">
        Open dispute
      </Button>
    </div>
  );
}
