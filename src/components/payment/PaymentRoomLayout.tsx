import { type ReactNode } from "react";

interface PaymentRoomLayoutProps {
  moneyStrip: ReactNode;
  accordLine?: ReactNode;
  agreement: ReactNode;
  primaryAction: ReactNode;
  timeline?: ReactNode;
  evidence?: ReactNode;
  aiCase?: ReactNode;
  receipt?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export default function PaymentRoomLayout({
  moneyStrip,
  accordLine,
  agreement,
  primaryAction,
  timeline,
  evidence,
  aiCase,
  receipt,
  className = "",
}: PaymentRoomLayoutProps) {
  return (
    <div className={className}>
      {moneyStrip}

      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        {accordLine && <div className="mb-8">{accordLine}</div>}

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-8">
            {agreement}
            {evidence}
            {aiCase}
            {timeline}
            {receipt}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-[8rem] space-y-6">
              {primaryAction}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
