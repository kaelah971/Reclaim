"use client";

import { useState } from "react";
import Select from "../ui/Select";
import Input from "../ui/Input";

export interface ProtectionRulesData {
  releaseRule: string;
  autoReleaseHours: string;
  disputeWindow: string;
  evidenceExpectation: string;
}

interface ProtectionRulesProps {
  onChange?: (data: ProtectionRulesData) => void;
  /** Controlled value (for wizard step navigation). Falls back to internal state. */
  value?: ProtectionRulesData;
  className?: string;
}

const EMPTY_RULES: ProtectionRulesData = {
  releaseRule: "",
  autoReleaseHours: "",
  disputeWindow: "",
  evidenceExpectation: "",
};

export default function ProtectionRules({
  onChange,
  value,
  className = "",
}: ProtectionRulesProps) {
  const [internal, setInternal] = useState<ProtectionRulesData>(
    value ?? EMPTY_RULES,
  );
  // When `value` is provided the parent owns the state (controlled);
  // otherwise this component keeps its own (backward compatible).
  const data = value ?? internal;

  const handleChange = (field: keyof ProtectionRulesData, value: string) => {
    const newData: ProtectionRulesData = { ...data, [field]: value };
    setInternal(newData);
    onChange?.(newData);
  };

  return (
    <div className={className}>
      <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        How the money is released
      </h3>
      <p className="mt-1 text-[14px] text-muted">
        The freelancer is paid when you approve the delivery. These choices
        are saved with the agreement so both sides can see them.
      </p>

      <div className="mt-5 space-y-5">
        <Select
          label="How should the money be released?"
          value={data.releaseRule}
          onChange={(e) => handleChange("releaseRule", e.target.value)}
          helper="Pick what has to happen before the locked funds can move to the freelancer."
        >
          <option value="">Choose how release works</option>
          <option value="buyer-approval">
            I approve every release (recommended)
          </option>
          <option value="auto-release">
            I approve, or it releases automatically after a backup delay
          </option>
          <option value="manual">Only release when I say so</option>
        </Select>

        <details className="rounded-[--radius-input] border border-border bg-input/50 px-4 py-3">
          <summary className="cursor-pointer text-[14px] font-medium text-ink">
            Advanced timing (optional)
          </summary>
          <div className="mt-4 space-y-5 pb-1">
            <Input
              label="Backup release delay (hours, optional)"
              type="number"
              placeholder="48"
              value={data.autoReleaseHours}
              onChange={(e) =>
                handleChange("autoReleaseHours", e.target.value)
              }
              helper="Only used with automatic release: how long after delivery the funds wait before releasing on their own. Leave empty to turn this off."
            />

            <Input
              label="Review window (hours, optional)"
              type="number"
              placeholder="24"
              value={data.disputeWindow}
              onChange={(e) => handleChange("disputeWindow", e.target.value)}
              helper="After the freelancer submits work, how long you have to raise a concern before the release can go ahead."
            />

            <Input
              label="What should delivery include?"
              placeholder="Final files, revision record, and a short summary"
              value={data.evidenceExpectation}
              onChange={(e) =>
                handleChange("evidenceExpectation", e.target.value)
              }
              helper="Tell the freelancer what to hand over. Both sides can see this note."
            />
          </div>
        </details>
      </div>
    </div>
  );
}
