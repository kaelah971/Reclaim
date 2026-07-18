import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
type ButtonSize = "md" | "sm" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-page hover:bg-utility focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
  secondary:
    "bg-page text-ink border border-border hover:bg-input focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
  destructive:
    "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
  ghost:
    "text-ink hover:bg-input focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-12 px-5 text-[15px]",
  sm: "h-9 px-4 text-[13px]",
  lg: "h-14 px-7 text-base",
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
