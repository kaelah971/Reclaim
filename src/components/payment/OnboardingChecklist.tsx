interface ChecklistStep {
  label: string;
  complete: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

interface OnboardingChecklistProps {
  steps: ChecklistStep[];
  className?: string;
}

export default function OnboardingChecklist({
  steps,
  className = "",
}: OnboardingChecklistProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">
        Getting started
      </h2>
      <ol className="mt-4 flex flex-col gap-4 sm:flex-row sm:gap-6">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-start gap-3 flex-1">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                step.complete
                  ? "bg-success text-white"
                  : "bg-input text-muted"
              }`}
              aria-label={`Step ${i + 1}${step.complete ? " complete" : ""}`}
            >
              {step.complete ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 6L5 9L10 3"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <div>
              <span
                className={`text-[15px] ${
                  step.complete
                    ? "text-ink"
                    : step.disabled
                      ? "text-muted"
                      : "text-ink"
                }`}
              >
                {step.label}
              </span>
              {step.disabled && step.disabledReason && (
                <p className="mt-0.5 text-[13px] text-muted">
                  {step.disabledReason}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export { type ChecklistStep };
