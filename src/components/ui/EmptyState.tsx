import { type ReactNode } from "react";
import Button from "./Button";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: ReactNode;
  className?: string;
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-16 text-center ${className}`}
    >
      {icon && (
        <div className="mb-5 text-muted/60" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          {description}
        </p>
      )}
      {actionLabel &&
        (actionHref ? (
          <a
            href={actionHref}
            className="mt-6 inline-flex h-11 items-center rounded-[--radius-button] bg-primary px-5 text-[15px] font-semibold text-page transition-colors hover:bg-utility"
          >
            {actionLabel}
          </a>
        ) : onAction ? (
          <Button className="mt-6" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null)}
    </div>
  );
}
