"use client";

import { type TextareaHTMLAttributes, forwardRef, useState } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, helper, error, id, className = "", ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    const borderColor = error
      ? "border-red-600"
      : focused
        ? "border-gold"
        : "border-border";

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[15px] font-medium text-ink"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`min-h-[120px] rounded-[--radius-input] border bg-input px-4 py-3 text-[15px] text-ink placeholder:text-muted transition-colors focus:outline-none resize-vertical ${borderColor} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helper
                ? `${inputId}-helper`
                : undefined
          }
          {...props}
        />
        {helper && !error && (
          <p id={`${inputId}-helper`} className="text-[13px] text-muted">
            {helper}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export default Textarea;
