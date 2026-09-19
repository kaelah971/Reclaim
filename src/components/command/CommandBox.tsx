"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";

// ---------------------------------------------------------------------------
// CommandBox — primary Reclaim Command entry (P6.1).
//
// NOT an open chatbot: scoped to creating a protected payment, describing
// work, and setting release conditions. Out-of-domain prompts receive the
// concise boundary. Large focused command box with task-oriented examples.
// ---------------------------------------------------------------------------

const EXAMPLES = [
  "Protect 50 USA₮ for a logo design.",
  "Pay a developer 120 USA₮ when the landing page is delivered.",
  "Protect 200 USA₮ for Sarah. Ask me before releasing.",
];

interface CommandBoxProps {
  onSubmit: (message: string) => void;
  isWorking: boolean;
  error: string | null;
  boundaryMessage: string | null;
  compact?: boolean;
}

export default function CommandBox({
  onSubmit,
  isWorking,
  error,
  boundaryMessage,
  compact = false,
}: CommandBoxProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isWorking) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <section
      aria-label="Reclaim command"
      className={compact ? "" : "rounded-[--radius-card] border border-border bg-surface p-6 md:p-8"}
    >
      {!compact && (
        <>
          <h2 className="text-[20px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            What do you want Reclaim to handle?
          </h2>
          <p className="mt-1 text-[14px] text-muted">
            Describe the protected payment in your own words — work, amount,
            and release conditions.
          </p>
        </>
      )}
      <div className="mt-4">
        <label htmlFor="reclaim-command-input" className="sr-only">
          Describe the protected payment
        </label>
        <textarea
          id="reclaim-command-input"
          rows={compact ? 2 : 3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Protect 50 USA₮ for Daniel to design a logo by Friday. Ask me before releasing."
          disabled={isWorking}
          className="w-full rounded-[--radius-input] border border-border bg-input px-4 py-3 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={submit}
          disabled={isWorking || !value.trim()}
        >
          {isWorking ? "Interpreting…" : "Interpret command"}
        </Button>
        {!compact && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={isWorking}
                onClick={() => onSubmit(ex)}
                className="rounded-[--radius-pill] border border-border bg-page px-3 py-1.5 text-[13px] text-muted hover:text-ink hover:border-primary/30 transition-colors disabled:opacity-60"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-4">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">{error}</p>
          </Notice>
        </div>
      )}
      {boundaryMessage && (
        <div className="mt-4">
          <Notice variant="info">
            <p className="text-[14px] leading-relaxed">{boundaryMessage}</p>
          </Notice>
        </div>
      )}
    </section>
  );
}
