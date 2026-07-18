import Link from "next/link";
import Button from "@/components/ui/Button";
import UnavailableRecordState from "@/components/ui/UnavailableRecordState";
import ReceiptHeader from "@/components/receipt/ReceiptHeader";
import AllocationBreakdown from "@/components/receipt/AllocationBreakdown";
import ParticipantSummary from "@/components/receipt/ParticipantSummary";
import AgreementSummary from "@/components/payment/AgreementSummary";
import AccordLine from "@/components/shared/AccordLine";
import type { AccordStage } from "@/components/shared/AccordLine";
import ReviewResult from "@/components/receipt/ReviewResult";
import TransactionReference from "@/components/receipt/TransactionReference";
import type { TransactionRef } from "@/components/receipt/TransactionReference";
import VerificationSummary from "@/components/receipt/VerificationSummary";
import PrintReceiptButton from "@/components/receipt/PrintReceiptButton";

const accordStages: AccordStage[] = [
  { label: "Terms", state: "completed" },
  { label: "Funds", state: "completed" },
  { label: "Delivery", state: "completed" },
  { label: "Evidence", state: "completed" },
  { label: "Resolution", state: "completed" },
  { label: "Receipt", state: "completed" },
];

const txRefs: TransactionRef[] = [
  { label: "Escrow deposit" },
  { label: "Evidence reference" },
  { label: "Dispute transaction" },
  { label: "Vote transaction" },
  { label: "Settlement transaction" },
  { label: "Attribution tag" },
];

export default function ReceiptDetailPage() {
  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <UnavailableRecordState
          title="This settlement receipt is not available yet."
          description="Receipts will appear after a protected payment is released or resolved."
          secondaryAction="Protect a payment"
          secondaryHref="/payments/new"
        />
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/receipts">
            <Button>Return to receipts</Button>
          </Link>
          <Link href="/payments/new">
            <Button variant="secondary">Protect a payment</Button>
          </Link>
        </div>
      </div>

      <div className="border-t border-border mt-8">
        <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
          <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-8 text-center mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Architectural reference
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted max-w-2xl mx-auto">
              The complete receipt document is built below. All sections accept typed props.
              When real settlement data is connected, the unavailable state will be replaced by this layout.
            </p>
          </div>

          <div className="mx-auto max-w-3xl">
            <article className="rounded-[--radius-card] border border-border bg-surface p-6 shadow-[--shadow-card] md:p-8 print:shadow-none print:border-0">
              <ReceiptHeader
                receiptTitle="Settlement receipt — unavailable"
                outcome="Awaiting integration"
                outcomeVariant="pending"
                settlementDate="—"
                paymentRef="—"
                verificationStatus="Awaiting integration"
              />

              {/* Plain-language outcome */}
              <div className="mt-8 rounded-[--radius-card] border border-border bg-page p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                  Outcome
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink">
                  The settlement outcome will be described here in plain language when a real receipt is available. This may include a full release to the worker, a full return to the client, or a split settlement with percentage allocations.
                </p>
              </div>

              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <AllocationBreakdown
                  protectedAmount="—"
                />
                <ParticipantSummary
                  clientWallet="—"
                  workerWallet="—"
                />
              </div>

              <div className="mt-8">
                <AgreementSummary
                  deliverable="—"
                  deadline="—"
                  releaseRule="—"
                  disputeWindow="—"
                  evidenceExpectation="—"
                />
              </div>

              <div className="mt-8">
                <AccordLine stages={accordStages} />
              </div>

              <div className="mt-8">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted mb-4">
                  Evidence references
                </h3>
                <p className="text-[15px] text-muted">
                  Evidence references will appear here when real settlement data is connected.
                </p>
              </div>

              <div className="mt-8">
                <ReviewResult finalRuling="—" reviewerCount={0} />
              </div>

              <div className="mt-8">
                <TransactionReference items={txRefs} />
              </div>

              <div className="mt-8">
                <VerificationSummary />
              </div>

              <div className="mt-8 border-t border-border pt-6">
                <PrintReceiptButton />
              </div>
            </article>
          </div>
        </div>
      </div>
    </>
  );
}
