interface ReviewProgressProps {
  stages: readonly { label: string; complete: boolean; active: boolean }[];
  className?: string;
}

export default function ReviewProgress({
  stages,
  className = "",
}: ReviewProgressProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Review progress
      </h3>

      <div className="mt-4 space-y-3">
        {stages.map((stage) => (
          <div key={stage.label} className="flex items-center gap-3">
            {stage.complete ? (
              <svg
                className="shrink-0 text-success"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path
                  d="M5 8L7 10L11 6"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <div
                className={`shrink-0 h-3 w-3 rounded-full border-2 ${
                  stage.active
                    ? "border-gold bg-gold"
                    : "border-border bg-transparent"
                }`}
                aria-hidden="true"
              />
            )}
            <span
              className={`text-[15px] ${
                stage.complete
                  ? "text-ink"
                  : stage.active
                    ? "font-medium text-ink"
                    : "text-muted"
              }`}
            >
              {stage.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
