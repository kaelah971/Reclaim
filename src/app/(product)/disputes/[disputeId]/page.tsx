import Link from "next/link";
import Button from "@/components/ui/Button";
import UnavailableRecordState from "@/components/ui/UnavailableRecordState";
import CaseHeader from "@/components/dispute/CaseHeader";
import PaymentCaseSummary from "@/components/dispute/PaymentCaseSummary";
import ClaimPanel from "@/components/dispute/ClaimPanel";
import DisputeRoomLayout from "@/components/dispute/DisputeRoomLayout";
import EvidenceMap from "@/components/payment/EvidenceMap";
import PaymentTimeline from "@/components/payment/PaymentTimeline";
import AICasePacket from "@/components/payment/AICasePacket";
import ReviewProgress from "@/components/dispute/ReviewProgress";
import PossibleOutcomes from "@/components/dispute/PossibleOutcomes";

const reviewStages = [
  { label: "Case prepared", complete: false, active: false },
  { label: "Reviewers assigned", complete: false, active: false },
  { label: "Voting open", complete: false, active: false },
  { label: "Voting closed", complete: false, active: false },
  { label: "Settlement ready", complete: false, active: false },
  { label: "Settled", complete: false, active: false },
];

export default function DisputeRoomPage() {
  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <UnavailableRecordState
          title="This dispute is not available yet."
          description="Connect the dispute service or open a protected-payment dispute once integration is enabled."
          secondaryAction="View reviews"
          secondaryHref="/reviews"
        />
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/payments">
            <Button>Return to payments</Button>
          </Link>
          <Link href="/reviews">
            <Button variant="secondary">View reviews</Button>
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
              The complete Dispute Room layout is built below. All sections accept typed props.
              When real dispute data is connected, the unavailable state will be replaced by this layout.
            </p>
          </div>

          <DisputeRoomLayout
            caseHeader={
              <CaseHeader
                disputeId="DISPUTE_REF"
                paymentRef="PAYMENT_REF"
                amount="—"
                status="Unavailable"
                statusVariant="pending"
                reviewDeadline="—"
                currentPhase="Awaiting integration"
              />
            }
            paymentSummary={
              <PaymentCaseSummary
                clientWallet="—"
                workerWallet="—"
                deliverable="—"
                deadline="—"
                releaseRule="—"
                disputeWindow="—"
                escrowState="Awaiting integration"
              />
            }
            clientClaim={<ClaimPanel side="client" />}
            workerClaim={<ClaimPanel side="worker" />}
            timeline={
              <PaymentTimeline entries={[]} />
            }
            evidence={
              <EvidenceMap items={[]} />
            }
            aiCase={
              <AICasePacket />
            }
            reviewProgress={
              <ReviewProgress stages={reviewStages} />
            }
            outcomes={
              <PossibleOutcomes />
            }
          />
        </div>
      </div>
    </>
  );
}
