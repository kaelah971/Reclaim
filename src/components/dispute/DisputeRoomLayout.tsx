import { type ReactNode } from "react";
import CaseHeader from "./CaseHeader";
import PaymentCaseSummary from "./PaymentCaseSummary";
import ClaimPanel from "./ClaimPanel";
import PossibleOutcomes from "./PossibleOutcomes";
import ReviewProgress from "./ReviewProgress";
import EvidenceMap, { type EvidenceItemData } from "../payment/EvidenceMap";
import PaymentTimeline, { type TimelineEntryData } from "../payment/PaymentTimeline";
import AICasePacket from "../payment/AICasePacket";

interface DisputeRoomLayoutProps {
  caseHeader: ReactNode;
  paymentSummary: ReactNode;
  clientClaim: ReactNode;
  workerClaim: ReactNode;
  timeline?: ReactNode;
  evidence?: ReactNode;
  aiCase?: ReactNode;
  reviewProgress?: ReactNode;
  outcomes?: ReactNode;
  className?: string;
}

export default function DisputeRoomLayout({
  caseHeader,
  paymentSummary,
  clientClaim,
  workerClaim,
  timeline,
  evidence,
  aiCase,
  reviewProgress,
  outcomes,
  className = "",
}: DisputeRoomLayoutProps) {
  return (
    <div className={className}>
      {caseHeader}

      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-8">
            {paymentSummary}
            <div className="grid gap-6 md:grid-cols-2">
              {clientClaim}
              {workerClaim}
            </div>
            {evidence}
            {aiCase}
            {timeline}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-[8rem] space-y-6">
              {reviewProgress}
              {outcomes}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export {
  CaseHeader,
  PaymentCaseSummary,
  ClaimPanel,
  PossibleOutcomes,
  ReviewProgress,
  EvidenceMap,
  PaymentTimeline,
  AICasePacket,
};
export type { EvidenceItemData, TimelineEntryData };
