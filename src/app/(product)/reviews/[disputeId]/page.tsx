"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import UnavailableRecordState from "@/components/ui/UnavailableRecordState";
import CaseHeader from "@/components/dispute/CaseHeader";
import ClaimPanel from "@/components/dispute/ClaimPanel";
import EvidenceMap from "@/components/payment/EvidenceMap";
import PaymentTimeline from "@/components/payment/PaymentTimeline";
import AICasePacket from "@/components/payment/AICasePacket";
import AgreementSummary from "@/components/payment/AgreementSummary";
import ReviewerVotePanel from "@/components/review/ReviewerVotePanel";
import Notice from "@/components/ui/Notice";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";

export default function ReviewerCasePage() {
  const { requireWallet } = useRequireWallet();

  const handleSubmitReview = () => {
    requireWallet(() => {});
  };

  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <UnavailableRecordState
          title="This review assignment is not available yet."
          description="Reviewer assignments will appear here once the review service is connected."
          secondaryAction="Return to reviews"
          secondaryHref="/reviews"
        />
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/reviews">
            <Button>Return to reviews</Button>
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
              The complete reviewer workspace is built below. All sections accept typed props.
              When real review assignments are connected, the unavailable state will be replaced by this layout.
            </p>
          </div>

          <CaseHeader
            disputeId="DISPUTE_REF"
            paymentRef="PAYMENT_REF"
            amount="—"
            status="Unavailable"
            statusVariant="pending"
            reviewDeadline="—"
            currentPhase="Awaiting integration"
            className="mb-8"
          />

          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-8">
              <AgreementSummary
                deliverable="—"
                deadline="—"
                releaseRule="—"
                disputeWindow="—"
                evidenceExpectation="—"
              />

              <div className="grid gap-6 md:grid-cols-2">
                <ClaimPanel side="client" />
                <ClaimPanel side="worker" />
              </div>

              <PaymentTimeline entries={[]} />

              <EvidenceMap items={[]} />

              <AICasePacket
                missingEvidence={[]}
                contradictions={[]}
                reviewerQuestions={[]}
              />

              <Notice variant="info">
                <p className="text-[15px] leading-relaxed">
                  AI prepares the case. People decide. The contract settles.<br />
                  <span className="text-[14px]">
                    The AI packet is a structured summary, not a ruling.
                  </span>
                </p>
              </Notice>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-[8rem] space-y-6">
                <ReviewerVotePanel onSubmit={handleSubmitReview} />

                <div className="rounded-[--radius-card] border border-border bg-page p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                    Contradictions &amp; questions
                  </h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted">
                    Contradictions between claims, missing evidence, and unresolved questions
                    for the reviewer will appear here when a real case packet is available.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
