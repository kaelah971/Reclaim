import { type ReactNode } from "react";

interface DashboardSectionProps {
  title: string;
  description?: string;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  children?: ReactNode;
  className?: string;
}

export default function DashboardSection({
  title,
  description,
  empty = false,
  emptyTitle,
  emptyDescription,
  children,
  className = "",
}: DashboardSectionProps) {
  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[14px] text-muted">{description}</p>
          )}
        </div>
      </div>
      <div className="mt-4">
        {empty ? (
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-10 text-center">
            {emptyTitle && (
              <p className="text-[15px] font-medium text-ink">{emptyTitle}</p>
            )}
            {emptyDescription && (
              <p className="mt-1 text-[14px] text-muted">{emptyDescription}</p>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
