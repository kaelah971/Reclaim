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
  className?: string;
}

export default function ProtectionRules({
  onChange,
  className = "",
}: ProtectionRulesProps) {
  const [releaseRule, setReleaseRule] = useState("");
  const [autoReleaseHours, setAutoReleaseHours] = useState("");
  const [disputeWindow, setDisputeWindow] = useState("");
  const [evidenceExpectation, setEvidenceExpectation] = useState("");

  const handleChange = (field: keyof ProtectionRulesData, value: string) => {
    const newData: ProtectionRulesData = {
      releaseRule,
      autoReleaseHours,
      disputeWindow,
      evidenceExpectation,
      [field]: value,
    };
    switch (field) {
      case "releaseRule": setReleaseRule(value); break;
      case "autoReleaseHours": setAutoReleaseHours(value); break;
      case "disputeWindow": setDisputeWindow(value); break;
      case "evidenceExpectation": setEvidenceExpectation(value); break;
    }
    onChange?.(newData);
  };

  return (
    <div className={className}>
      <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        Protection rules
      </h3>

      <div className="mt-5 space-y-5">
        <Select
          label="Release rule"
          value={releaseRule}
          onChange={(e) => handleChange("releaseRule", e.target.value)}
          helper="Choose how funds will be released after delivery."
        >
          <option value="">Select a release rule</option>
          <option value="buyer-approval">Buyer approval required</option>
          <option value="auto-release">Buyer approval or timed auto-release</option>
          <option value="manual">Manual release only</option>
        </Select>

        <Input
          label="Auto-release period (hours)"
          type="number"
          placeholder="48"
          value={autoReleaseHours}
          onChange={(e) => handleChange("autoReleaseHours", e.target.value)}
          helper="After the worker submits delivery, how long before funds auto-release if the client does not act? Leave empty to disable."
        />

        <Input
          label="Dispute window (hours)"
          type="number"
          placeholder="24"
          value={disputeWindow}
          onChange={(e) => handleChange("disputeWindow", e.target.value)}
          helper="How long does the client have to open a dispute after delivery is submitted?"
        />

        <Input
          label="Evidence expectation"
          placeholder="Final files, revision record, and agreed message thread"
          value={evidenceExpectation}
          onChange={(e) => handleChange("evidenceExpectation", e.target.value)}
          helper="Describe what evidence the worker should submit to prove delivery."
        />
      </div>
    </div>
  );
}
