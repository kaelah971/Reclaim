"use client";

import { type SelectHTMLAttributes, forwardRef, useState, type ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
  children: ReactNode;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helper, error, id, className = "", children, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    const borderColor = error
      ? "border-red-600"
      : focused
        ? "border-gold"
        : "border-border";

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-[15px] font-medium text-ink"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={`h-12 w-full appearance-none rounded-[--radius-input] border bg-input px-4 pr-10 text-[15px] text-ink transition-colors focus:outline-none ${borderColor} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={
              error
                ? `${selectId}-error`
                : helper
                  ? `${selectId}-helper`
                  : undefined
            }
            {...props}
          >
            {children}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {helper && !error && (
          <p id={`${selectId}-helper`} className="text-[13px] text-muted">
            {helper}
          </p>
        )}
        {error && (
          <p id={`${selectId}-error`} className="text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
