"use client";

import { useBalance } from "wagmi";
import Notice from "@/components/ui/Notice";
import { getChainName } from "@/lib/web3/chains";

// ---------------------------------------------------------------------------
// WorkerGasNotice — CELO fee readiness (P4.3a).
//
// Always states "CELO is used for transaction fees." for worker contexts.
// Shows an actionable warning only when the native balance is determinable
// and zero (never blocks, never promises exact gas, no faucet).
// ---------------------------------------------------------------------------

interface WorkerGasNoticeProps {
  chainId: number;
  address?: `0x${string}`;
  className?: string;
}

export default function WorkerGasNotice({
  chainId,
  address,
  className = "",
}: WorkerGasNoticeProps) {
  const { data: nativeBalance } = useBalance({
    address,
    chainId,
    query: { enabled: Boolean(address) },
  });

  const isZeroBalance = nativeBalance?.value === 0n;
  const networkName = getChainName(chainId);

  return (
    <div className={className}>
      <p className="text-[13px] text-muted">
        CELO is used for transaction fees.
      </p>
      {isZeroBalance && (
        <div className="mt-2">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">
              You have no CELO on {networkName} for network fees. Add a small
              amount of CELO so your transactions can go through.
            </p>
            <p className="mt-1 text-[13px] text-muted">
              Actual fees depend on network conditions.
            </p>
          </Notice>
        </div>
      )}
    </div>
  );
}
