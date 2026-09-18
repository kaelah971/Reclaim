"use client";

export const NEW_PAYMENT_STEPS = ["Payment", "Terms", "Review"] as const;

interface NewPaymentStepperProps {
  currentStep: 1 | 2 | 3;
}

export default function NewPaymentStepper({
  currentStep,
}: NewPaymentStepperProps) {
  return (
    <ol
      aria-label="Progress"
      className="flex items-center gap-2 text-[13px] font-medium"
    >
      {NEW_PAYMENT_STEPS.map((label, index) => {
        const stepNumber = (index + 1) as 1 | 2 | 3;
        const isCurrent = stepNumber === currentStep;
        const isDone = stepNumber < currentStep;
        return (
          <li key={label} className="flex items-center gap-2">
            {index > 0 && (
              <span aria-hidden="true" className="h-px w-6 bg-border" />
            )}
            <span
              aria-current={isCurrent ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-[--radius-pill] border px-3 py-1 ${
                isCurrent
                  ? "border-primary bg-primary text-page"
                  : isDone
                    ? "border-success/40 bg-status-protected-bg text-status-protected-text"
                    : "border-border bg-surface text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums"
              >
                {stepNumber}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
