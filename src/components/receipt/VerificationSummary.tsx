interface VerificationSummaryProps {
  className?: string;
}

export default function VerificationSummary({
  className = "",
}: VerificationSummaryProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-page p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Verification
      </h3>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        This receipt combines the shared agreement, evidence record, review result, and
        on-chain settlement into one readable record. Transaction references link to the
        Celo blockchain for independent verification.
      </p>
      <p className="mt-2 text-[14px] text-muted">
        No further payment or action is required to view or verify this receipt.
      </p>
    </div>
  );
}
