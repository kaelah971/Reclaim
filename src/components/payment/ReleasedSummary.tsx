"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import SharePaymentLink from "@/components/payment/SharePaymentLink";
import { shortenAddress } from "@/hooks/wallet/useWalletState";
import {
  CELO_MAINNET_CHAIN_ID,
  getCeloExplorerTxUrl,
  getCeloMainnetExplorerTxUrl,
} from "@/lib/web3/chains";

// ---------------------------------------------------------------------------
// ReleasedSummary — canonical settlement summary (P4.4a).
//
// Rendered ONLY when the canonical on-chain state is Released. All content
// (amount, worker, network, payment id, released time) comes from the fresh
// canonical payment read — never inferred from local transaction state. The
// optional tx hash comes from the confirmed receipt when available. No
// release controls are rendered here. Worker wallets see the "Payment
// received" variant; clients see "Payment released".
// ---------------------------------------------------------------------------

interface ReleasedSummaryProps {
  amountLabel: string;
  tokenSymbol: string;
  workerAddress: string;
  networkName: string;
  paymentId: string;
  chainId: number;
  txHash?: `0x${string}` | undefined;
  releasedAtLabel: string;
  role: "client" | "worker" | "viewer";
  /** Settlement-receipt route (chain-free): /receipts/{paymentId}. */
  receiptHref: string;
  receiptLabel?: string;
  sharePaymentId: string;
  shareChainId: number;
  className?: string;
}

function explorerTxUrl(chainId: number, txHash: string): string {
  return chainId === CELO_MAINNET_CHAIN_ID
    ? getCeloMainnetExplorerTxUrl(txHash)
    : getCeloExplorerTxUrl(txHash);
}

export default function ReleasedSummary({
  amountLabel,
  tokenSymbol,
  workerAddress,
  networkName,
  paymentId,
  chainId,
  txHash,
  releasedAtLabel,
  role,
  receiptHref,
  receiptLabel = "View receipt",
  sharePaymentId,
  shareChainId,
  className = "",
}: ReleasedSummaryProps) {
  const isWorker = role === "worker";
  const heading = isWorker ? "Payment received" : "Payment released";

  return (
    <div className={`space-y-4 ${className}`}>
      <Notice variant="success">
        <h3 className="text-[18px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
          {heading}
        </h3>
        <p className="mt-1 text-[14px] leading-relaxed">
          {isWorker ? (
            <>
              You received{" "}
              <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium">
                {amountLabel} {tokenSymbol}
              </span>{" "}
              on {networkName}.
            </>
          ) : (
            <>
              <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium">
                {amountLabel} {tokenSymbol}
              </span>{" "}
              was sent to {shortenAddress(workerAddress)} on {networkName}.
            </>
          )}
        </p>
      </Notice>

      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14px]">
          <div>
            <dt className="text-[13px] text-muted">Amount</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
              {amountLabel} {tokenSymbol}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Freelancer</dt>
            <dd
              className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-ink"
              title={workerAddress}
            >
              {workerAddress}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Network</dt>
            <dd className="mt-0.5 text-ink">{networkName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Payment ID</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {paymentId}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">Released</dt>
            <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
              {releasedAtLabel}
            </dd>
          </div>
          {txHash && (
            <div className="sm:col-span-2">
              <dt className="text-[13px] text-muted">Transaction</dt>
              <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-[13px] text-ink">
                {txHash}
              </dd>
              <a
                href={explorerTxUrl(chainId, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
              >
                View on Celo Explorer
              </a>
            </div>
          )}
        </dl>

        <Link href={receiptHref}>
          <Button variant="primary" size="lg" className="w-full">
            {receiptLabel}
          </Button>
        </Link>

        <div className="pt-2 border-t border-border">
          <SharePaymentLink
            paymentId={sharePaymentId}
            chainId={shareChainId}
            buttonLabel="Copy payment link"
          />
        </div>
      </div>
    </div>
  );
}
