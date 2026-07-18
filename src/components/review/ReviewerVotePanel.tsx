"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import Notice from "../ui/Notice";

export type VoteOption = "client" | "worker" | "split";

interface ReviewerVotePanelProps {
  onSubmit?: (vote: { option: VoteOption; clientPct: number; workerPct: number; note: string }) => void;
  className?: string;
}

export default function ReviewerVotePanel({
  onSubmit,
  className = "",
}: ReviewerVotePanelProps) {
  const [option, setOption] = useState<VoteOption | "">("");
  const [clientPct, setClientPct] = useState("");
  const [workerPct, setWorkerPct] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const splitTotal = (Number(clientPct) || 0) + (Number(workerPct) || 0);
  const splitValid = splitTotal === 100;
  const splitOver = splitTotal > 100;
  const splitUnder = option === "split" && clientPct && workerPct && splitTotal < 100;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!option) errs.option = "Select an outcome.";
    if (option === "split") {
      if (!clientPct) errs.clientPct = "Enter the client percentage.";
      if (!workerPct) errs.workerPct = "Enter the worker percentage.";
      if (clientPct && workerPct && !splitValid) {
        errs.split = "The client and worker percentages must total 100%.";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    setSubmitted(true);
    onSubmit?.({
      option: option as VoteOption,
      clientPct: Number(clientPct) || 0,
      workerPct: Number(workerPct) || 0,
      note,
    });
  };

  if (submitted) {
    return (
      <div className={className}>
        <Notice variant="info">
          Review submission will be enabled when the voting contract and reviewer service are connected.
        </Notice>
      </div>
    );
  }

  const outcomeLabels: Record<string, string> = {
    client: "Client wins — funds return to client",
    worker: "Worker wins — funds release to worker",
    split: "Split settlement — funds divided between parties",
  };

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Your review
      </h3>

      <fieldset className="mt-4 space-y-3">
        <legend className="text-[15px] font-medium text-ink mb-2">Select outcome</legend>
        {(["client", "worker", "split"] as VoteOption[]).map((opt) => (
          <label
            key={opt}
            className={`flex items-center gap-3 rounded-[--radius-card] border p-4 cursor-pointer transition-colors ${
              option === opt
                ? "border-gold bg-input"
                : "border-border hover:bg-input"
            }`}
          >
            <input
              type="radio"
              name="vote-outcome"
              value={opt}
              checked={option === opt}
              onChange={() => {
                setOption(opt);
                if (errors.option) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.option;
                    return next;
                  });
                }
              }}
              className="h-4 w-4 accent-gold"
            />
            <span className="text-[15px] text-ink">{outcomeLabels[opt]}</span>
          </label>
        ))}
      </fieldset>
      {errors.option && (
        <p className="mt-2 text-[13px] text-red-600" role="alert">{errors.option}</p>
      )}

      {option === "split" && (
        <div className="mt-5 border-t border-border pt-5 space-y-4">
          <h4 className="text-[14px] font-semibold text-ink">Split allocation</h4>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Client percentage"
              type="number"
              placeholder="0"
              min="0"
              max="100"
              value={clientPct}
              onChange={(e) => {
                setClientPct(e.target.value);
                if (errors.clientPct || errors.split) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.clientPct;
                    delete next.split;
                    return next;
                  });
                }
              }}
              error={errors.clientPct}
            />
            <Input
              label="Worker percentage"
              type="number"
              placeholder="0"
              min="0"
              max="100"
              value={workerPct}
              onChange={(e) => {
                setWorkerPct(e.target.value);
                if (errors.workerPct || errors.split) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.workerPct;
                    delete next.split;
                    return next;
                  });
                }
              }}
              error={errors.workerPct}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[14px] text-muted">Total:</span>
            <span
              className={`text-[14px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums ${
                clientPct && workerPct
                  ? splitValid
                    ? "text-success"
                    : "text-red-600"
                  : "text-muted"
              }`}
            >
              {clientPct && workerPct ? splitTotal : "—"}%
            </span>
            {splitOver && (
              <span className="text-[13px] text-red-600" role="alert">
                Must equal 100%
              </span>
            )}
            {splitUnder && (
              <span className="text-[13px] text-red-600" role="alert">
                Must equal 100%
              </span>
            )}
          </div>
          {errors.split && (
            <p className="text-[13px] text-red-600" role="alert">{errors.split}</p>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <label className="text-[14px] font-medium text-ink">
          Reviewer note <span className="text-muted font-normal">(optional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a brief explanation of your reasoning."
          className="mt-2 w-full min-h-[80px] rounded-[--radius-input] border border-border bg-input px-4 py-3 text-[15px] text-ink placeholder:text-muted transition-colors focus:border-gold focus:outline-none resize-vertical"
        />
      </div>

      <div className="mt-6">
        <Button size="lg" className="w-full" onClick={handleSubmit}>
          Submit review
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm your review"
        primaryLabel="Confirm submission"
        onPrimary={handleConfirm}
        secondaryLabel="Continue editing"
      >
        <div className="space-y-3">
          <p className="text-[15px]">
            <strong>Outcome:</strong>{" "}
            {outcomeLabels[option as string] || "Not selected"}
          </p>
          {option === "split" && (
            <p className="text-[15px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
              <strong>Split:</strong> {clientPct}% client / {workerPct}% worker
            </p>
          )}
          {note && (
            <p className="text-[14px] text-muted">
              <strong>Note:</strong> {note}
            </p>
          )}
          <p className="text-[13px] text-muted italic mt-3">
            Your vote will become part of the settlement record. This action cannot be
            reversed after settlement.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
