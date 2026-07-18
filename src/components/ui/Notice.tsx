import { type ReactNode } from "react";

type NoticeVariant = "info" | "success" | "warning" | "protected";

interface NoticeProps {
  variant?: NoticeVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<NoticeVariant, string> = {
  info: "bg-input text-ink border-border",
  success: "bg-status-protected-bg text-status-protected-text border-success/30",
  warning: "bg-status-disputed-bg text-status-disputed-text border-status-disputed-text/20",
  protected: "bg-status-protected-bg text-status-protected-text border-success/30",
};

export default function Notice({
  variant = "info",
  children,
  className = "",
}: NoticeProps) {
  return (
    <div
      className={`rounded-[--radius-card] border px-5 py-4 text-[15px] leading-relaxed ${variantStyles[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
