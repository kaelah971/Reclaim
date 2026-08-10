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
      className={`document-card flex flex-col items-center justify-center rounded-[--radius-card] px-6 py-14 text-center ${className}`}
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
            className="mt-6 inline-flex h-11 items-center rounded-[--radius-button] border border-primary bg-primary px-5 text-[15px] font-semibold text-page shadow-[0_6px_16px_rgba(35,28,21,0.16)] transition-colors hover:bg-utility"
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
