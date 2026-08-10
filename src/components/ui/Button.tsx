import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
type ButtonSize = "md" | "sm" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-primary bg-primary text-page shadow-[0_6px_16px_rgba(35,28,21,0.16)] hover:bg-utility focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
  secondary:
    "border border-border bg-surface text-ink hover:bg-input focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
  destructive:
    "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
  ghost:
    "border border-transparent text-ink hover:border-border hover:bg-surface focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-[14px]",
  sm: "h-9 px-4 text-[13px]",
  lg: "h-12 px-6 text-[15px]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`inline-flex items-center justify-center gap-2 rounded-[--radius-button] font-semibold transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export { type ButtonProps, type ButtonVariant, type ButtonSize };
export default Button;
