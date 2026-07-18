import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

interface ReceiptHeaderProps {
  receiptTitle?: string;
  outcome?: string;
  outcomeVariant?: BadgeVariant;
  settlementDate?: string;
  paymentRef?: string;
  verificationStatus?: string;
  className?: string;
}

export default function ReceiptHeader({
  receiptTitle,
  outcome,
  outcomeVariant = "settled",
  settlementDate,
  paymentRef,
  verificationStatus,
  className = "",
}: ReceiptHeaderProps) {
  return (
    <div className={`border-b border-border pb-6 ${className}`}>
      <span className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Settlement receipt
      </span>
      {receiptTitle && (
        <h2 className="mt-2 text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
          {receiptTitle}
        </h2>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        {outcome && (
          <div className="flex items-center gap-2">
            <StatusBadge variant={outcomeVariant} label={outcome} />
          </div>
        )}
        {settlementDate && (
          <span className="text-[14px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
            {settlementDate}
          </span>
        )}
        {paymentRef && (
          <span className="text-[14px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
            {paymentRef}
          </span>
        )}
        {verificationStatus && (
          <span className="text-[13px] text-success font-medium">{verificationStatus}</span>
        )}
      </div>
    </div>
  );
}
