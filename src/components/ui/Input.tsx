"use client";

import { type InputHTMLAttributes, forwardRef, useState } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
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
        <input
          ref={ref}
          id={inputId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`h-12 rounded-[--radius-input] border bg-input px-4 text-[15px] text-ink placeholder:text-muted transition-colors focus:outline-none ${borderColor} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
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

Input.displayName = "Input";

export default Input;
