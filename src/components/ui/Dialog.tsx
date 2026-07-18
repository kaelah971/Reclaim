"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import Button from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "default" | "destructive";
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export default function Dialog({
  open,
  onClose,
  title,
  children,
  variant = "default",
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-lg rounded-[--radius-card] bg-surface shadow-[--shadow-modal] mx-4 mb-4 sm:mb-0 sm:mx-0"
      >
        <div className="px-6 pt-6 pb-4">
          <h2
            id="dialog-title"
            className="text-xl font-[family-name:var(--font-georama)] font-semibold text-ink"
          >
            {title}
          </h2>
        </div>

        <div className="px-6 pb-2 text-[15px] leading-relaxed text-ink">
          {children}
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6 pt-4">
          {secondaryLabel && (
            <Button variant="secondary" onClick={onSecondary || onClose}>
              {secondaryLabel}
            </Button>
          )}
          {primaryLabel && (
            <Button
              variant={variant === "destructive" ? "destructive" : "primary"}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
