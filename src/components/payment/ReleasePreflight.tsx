"use client";

import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import {
  CELO_MAINNET_CHAIN_ID,
  getCeloExplorerTxUrl,
  getCeloMainnetExplorerTxUrl,
} from "@/lib/web3/chains";
import {
  PAYMENT_SYNCING_MESSAGE,
  PAYMENT_SYNC_TIMEOUT_MESSAGE,
} from "@/hooks/payment/usePaymentActionSync";

// ---------------------------------------------------------------------------
// ReleasePreflight — client-only release confirmation (P4.4a).
//
// "Release payment": exact amount + token, To worker, On network, plus a calm
// irreversibility note. Requires connected client + correct chain + eligible
// state (enforced by the caller via isEligible) + a fresh canonical re-read
// (caller passes onRefresh → refetchPayment). Wrong network renders a
// targetable switch to the payment chain. All writes go through the existing
// useApproveRelease hook via onRelease — this component never writes
// directly, never re-broadcasts, and never presents an optimistic settlement:
// a confirmed receipt with a stale canonical read shows a refresh notice
// (receipt authoritative), never a settlement claim.
// ---------------------------------------------------------------------------

interface ReleasePreflightProps {
  amountLabel: string;
  tokenSymbol: string;
  workerAddress: string;
  networkName: string;
  /** Payment chain — the only valid switch target. */
  targetChainId: number;
  /** Payment chain for explorer links. */
  chainId: number;
  /** Canonical on-chain state (for stale-read detection). */
  canonicalState: string;
  isWrongNetwork: boolean;
  /** connected == client + correct chain + eligible state. */
  isEligible: boolean;
  isPending: boolean;
  isSuccess: boolean;
  error: string | null;
  txHash?: `0x${string}` | undefined;
  onRequestSwitch: (chainId: number) => void;
  onRelease: () => void;
  onRefresh: () => void;
  onDismissError?: () => void;
  /** True while receipt confirmed but canonical barrier not yet observed. */
  isSyncing?: boolean;
  /** True when bounded sync timed out (confirmed but still stale). */
  isTimedOut?: boolean;
}

function explorerTxUrl(chainId: number, txHash: string): string {
  return chainId === CELO_MAINNET_CHAIN_ID
    ? getCeloMainnetExplorerTxUrl(txHash)
    : getCeloExplorerTxUrl(txHash);
}

export default function ReleasePreflight({
  amountLabel,
  tokenSymbol,
  workerAddress,
  networkName,
  targetChainId,
  chainId,
  canonicalState,
  isWrongNetwork,
  isEligible,
  isPending,
  isSuccess,
  error,
  txHash,
  onRequestSwitch,
  onRelease,
  onRefresh,
  onDismissError,
  isSyncing = false,
  isTimedOut = false,
}: ReleasePreflightProps) {
  const isStaleSuccess =
    isSuccess && txHash !== undefined && canonicalState !== "Released";
  // isSyncing refines the stale copy (polling vs timed-out); isStaleSuccess
  // covers receipts whose hook has already synced but whose canonical read is
  // still behind. Both render the same bounded-sync UX — never a rebroadcast.
  const showSyncCopy = isStaleSuccess && (isSyncing || !isTimedOut || isTimedOut);
  void showSyncCopy;
  // Action locking (P4.5F safety): once receipt success is known the release
  // control is never re-enabled — only a safe canonical refresh is offered.
  const isLocked = isSuccess;

  return (
    <section
      aria-label="Release preflight"
      className="rounded-[--radius-card] border border-border bg-input p-5 space-y-4"
    >
      <h4 className="text-[16px] font-semibold text-ink">Release payment</h4>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14px]">
        <div>
          <dt className="text-[13px] text-muted">Amount</dt>
          <dd className="mt-0.5 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium text-ink">
            {amountLabel} {tokenSymbol}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">To worker</dt>
          <dd className="mt-0.5 break-all font-[family-name:var(--font-ibm-plex-mono)] text-ink">
            {workerAddress}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[13px] text-muted">On</dt>
          <dd className="mt-0.5 text-ink">{networkName}</dd>
        </div>
      </dl>

      <p className="text-[13px] leading-relaxed text-muted">
        This release is final and cannot be undone. Once confirmed, the funds
        move to the worker and this step cannot be reversed. Take a moment to
        confirm the delivery meets the agreed terms.
      </p>

      <p className="text-[13px] text-muted">
        Data shown is from the latest on-chain read.{" "}
        <button
          type="button"
          className="font-medium text-gold hover:text-gold/80 transition-colors"
          onClick={onRefresh}
        >
          Refresh payment data
        </button>{" "}
        before releasing.
      </p>

      {isWrongNetwork ? (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">
            Your wallet is on the wrong network for this release. Switch to{" "}
            {networkName} to continue.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => onRequestSwitch(targetChainId)}
          >
            Switch to {networkName}
          </Button>
        </Notice>
      ) : !isEligible ? (
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            Only the client wallet for this payment can release the funds.
          </p>
        </Notice>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onRelease}
          disabled={isPending || isLocked}
        >
          {isPending
            ? "Releasing…"
            : isLocked
              ? "Release confirmed"
              : "Release payment"}
        </Button>
      )}

      {isPending && !txHash && (
        <p className="text-[13px] text-muted" aria-live="polite">
          Waiting for signature… confirm in your wallet to continue.
        </p>
      )}
      {isPending && txHash && (
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">Confirming release…</p>
          <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            {txHash}
          </p>
        </Notice>
      )}

      {error && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{error}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
              onClick={onRelease}
            >
              Try again
            </button>
            {onDismissError && (
              <button
                type="button"
                className="text-[13px] font-medium text-muted hover:text-ink transition-colors"
                onClick={onDismissError}
              >
                Dismiss
              </button>
            )}
          </div>
        </Notice>
      )}

      {isStaleSuccess && txHash && (
        <Notice variant="info">
          <p className="text-[14px] leading-relaxed">
            {isTimedOut ? PAYMENT_SYNC_TIMEOUT_MESSAGE : PAYMENT_SYNCING_MESSAGE}
          </p>
          <a
            href={explorerTxUrl(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
          >
            View on Celo Explorer
          </a>
          <p className="mt-1 text-[13px] text-muted">
            The confirmed receipt is authoritative — no further transaction is
            needed. Do not resubmit.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={onRefresh}
          >
            Refresh status
          </Button>
        </Notice>
      )}
    </section>
  );
}
