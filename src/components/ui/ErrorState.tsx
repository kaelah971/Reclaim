import Button from "./Button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export default function ErrorState({
  title = "Something went wrong",
  description = "An unexpected error occurred. Please try again.",
  actionLabel = "Try again",
  onRetry,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[--radius-card] border border-border bg-page px-6 py-16 text-center ${className}`}
      role="alert"
    >
      <svg
        className="mb-5 text-muted/60"
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="20"
          cy="20"
          r="16"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M20 12V22"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="20" cy="27" r="1.5" fill="currentColor" />
      </svg>
      <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
        {description}
      </p>
      {onRetry && (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
