interface UnavailableRecordStateProps {
  title?: string;
  description?: string;
  secondaryAction?: string;
  secondaryHref?: string;
  className?: string;
}

export default function UnavailableRecordState({
  title = "This record is not available yet.",
  description = "Connect the payment service or create a new protected payment once integration is enabled.",
  secondaryAction,
  secondaryHref,
  className = "",
}: UnavailableRecordStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-16 text-center ${className}`}
    >
      <svg
        className="mb-5 text-muted/50"
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="6"
          y="8"
          width="28"
          height="24"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M6 16H34"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M14 12V20"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
        {description}
      </p>
      {secondaryAction && secondaryHref && (
        <a
          href={secondaryHref}
          className="mt-6 text-[15px] font-medium text-gold hover:text-gold/80 transition-colors"
        >
          {secondaryAction}
        </a>
      )}
    </div>
  );
}
