import Button from "../ui/Button";

export type PaymentActionLabel =
  | "Review terms"
  | "Deposit cUSD"
  | "Accept terms"
  | "Submit delivery"
  | "Request release"
  | "Approve release"
  | "Open dispute"
  | "View settlement";

interface PaymentStateActionProps {
  action: PaymentActionLabel;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

export default function PaymentStateAction({
  action,
  disabled = true,
  disabledReason,
  className = "",
}: PaymentStateActionProps) {
  return (
    <div className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}>
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Next action
      </h3>
      <div className="mt-4">
        <Button disabled={disabled} size="lg" className="w-full sm:w-auto">
          {action}
        </Button>
      </div>
      {disabled && disabledReason && (
        <p className="mt-3 text-[13px] text-muted">{disabledReason}</p>
      )}
    </div>
  );
}
