import AgreementSummary from "../payment/AgreementSummary";

interface PaymentCaseSummaryProps {
  clientWallet?: string;
  workerWallet?: string;
  amount?: string;
  deliverable?: string;
  deadline?: string;
  releaseRule?: string;
  disputeWindow?: string;
  escrowState?: string;
  className?: string;
}

export default function PaymentCaseSummary({
  clientWallet,
  workerWallet,
  amount: _amount,
  deliverable,
  deadline,
  releaseRule,
  disputeWindow,
  escrowState,
  className = "",
}: PaymentCaseSummaryProps) {
  void _amount;
  return (
    <div className={className}>
      <AgreementSummary
        clientWallet={clientWallet}
        workerWallet={workerWallet}
        deliverable={deliverable}
        deadline={deadline}
        releaseRule={releaseRule}
        disputeWindow={disputeWindow}
      />
      {escrowState && (
        <div className="mt-4 rounded-[--radius-card] border border-border bg-page px-4 py-3">
          <span className="text-[13px] text-muted">Escrow state:</span>{" "}
          <span className="text-[14px] font-medium text-ink">{escrowState}</span>
        </div>
      )}
    </div>
  );
}
