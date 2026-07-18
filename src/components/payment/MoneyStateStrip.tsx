import { PAYMENT_TOKEN_SYMBOL } from "@/lib/web3/tokens";
import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

interface MoneyStateStripProps {
  amount: string;
  asset?: string;
  state: string;
  stateVariant: BadgeVariant;
  deadline?: string;
  nextParty?: string;
  className?: string;
}

export default function MoneyStateStrip({
  amount,
  asset = PAYMENT_TOKEN_SYMBOL,
  state,
  stateVariant,
  deadline,
  nextParty,
  className = "",
}: MoneyStateStripProps) {
  return (
    <div
      className={`sticky top-16 z-40 border-b border-border bg-surface px-4 py-3 md:px-6 ${className}`}
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
        <span className="font-[family-name:var(--font-ibm-plex-mono)] text-lg font-medium tabular-nums text-ink">
          {amount} {asset}
        </span>
        <span className="text-border" aria-hidden="true">
          &middot;
        </span>
        <StatusBadge variant={stateVariant} label={state} />
        {deadline && (
          <>
            <span className="text-border" aria-hidden="true">
              &middot;
            </span>
            <span className="text-[13px] text-muted">
              {deadline}
            </span>
          </>
        )}
        {nextParty && (
          <>
            <span className="text-border" aria-hidden="true">
              &middot;
            </span>
            <span className="text-[13px] font-medium text-ink">
              {nextParty}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
