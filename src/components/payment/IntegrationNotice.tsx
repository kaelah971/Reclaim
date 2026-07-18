import { type ReactNode } from "react";

interface IntegrationNoticeProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function IntegrationNotice({
  title = "Integration notice",
  children,
  className = "",
}: IntegrationNoticeProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-dashed border-border bg-input px-6 py-5 text-center ${className}`}
    >
      <span className="text-[13px] font-semibold uppercase tracking-[0.15em] text-muted">
        {title}
      </span>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}
