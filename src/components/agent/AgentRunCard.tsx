"use client";

import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { buildRunAgentMessage } from "@/lib/resolution-agent/api/auth";
import { encodeWalletAuthMessage } from "@/lib/x402/walletAuth";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";

// ---------------------------------------------------------------------------
// AgentRunCard — manual "run one worker iteration" control for an EXISTING
// resolution agent.
//
// Runs AT MOST ONE resolution agent worker iteration for this agent
// (observe → plan → dispatch at most one control action). The worker itself
// enforces all policy/budget/lease/x402 protections; this control only
// triggers one iteration — there is NO automatic or recurring execution.
//
// Clicking:
//   1. builds the canonical run-agent message
//   2. asks the CONNECTED wallet to sign it (personal_sign)
//   3. POSTs to /api/resolution-agents/[agentId]/run (no body)
//   4. shows the worker result (outcome + dispatched action) and refreshes
//      the control room via onRan
//
// Display rules:
//   - hidden unless the agent status is worker-runnable
//   - hidden while the on-chain payment state is unknown (null)
//   - replaced by a muted terminal card when the case reached a final
//     on-chain state (Released / Cancelled / Resolved)
// ---------------------------------------------------------------------------

// Worker-runnable statuses — mirrored from the SERVER-ONLY worker types.
// Deliberately NOT imported from @/lib/resolution-agent/worker/types
// (SERVER-ONLY, must not be loaded into client bundles).
const RUNNABLE_STATUSES = [
  "active",
  "running_tool",
  "waiting_for_evidence",
  "waiting_for_human_approval",
  "failed_recoverable",
] as const;

// Terminal on-chain payment states (client-side labels from usePayment).
const TERMINAL_PAYMENT_STATES = ["Released", "Cancelled", "Resolved"] as const;

const CANONICAL_ESCROW_CHAIN_ID = "eip155:11142220";

interface AgentRunCardProps {
  agentId: string;
  escrowPaymentId: string;
  /** Agent status string from the public view (e.g. "active"). */
  status: string;
  /** On-chain payment state label (e.g. "Disputed", "Released") or null when unknown. */
  paymentState: string | null;
  /** Called after a successful run so the parent can refresh. */
  onRan?: () => void;
}

interface LastRunResult {
  outcome: string;
  actionKind: string | null;
}

export default function AgentRunCard({
  agentId,
  escrowPaymentId,
  status,
  paymentState,
  onRan,
}: AgentRunCardProps) {
  const wallet = useWalletState();
  const { signMessageAsync } = useSignMessage();

  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<LastRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRunnable = (RUNNABLE_STATUSES as readonly string[]).includes(status);
  const isTerminal = (TERMINAL_PAYMENT_STATES as readonly string[]).includes(
    paymentState ?? "",
  );

  const handleRun = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) return;

    setBusy(true);
    setError(null);
    setLastResult(null);

    try {
      const canonicalMessage = buildRunAgentMessage({
        agentId,
        escrowChainId: CANONICAL_ESCROW_CHAIN_ID,
        escrowPaymentId,
      });

      const signature = await signMessageAsync({ message: canonicalMessage });

      const res = await fetch(
        `/api/resolution-agents/${encodeURIComponent(agentId)}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet-address": wallet.address,
            // The canonical message is multiline and cannot be transported
            // raw in an HTTP header — send the shared header-safe encoding.
            "x-wallet-message": encodeWalletAuthMessage(canonicalMessage),
            "x-wallet-signature": signature,
          },
          // No body — the run endpoint accepts none.
        },
      );

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `Run failed (HTTP ${res.status})`,
        );
      }

      const result = data.result as {
        outcome?: string;
        actionDispatched?: { kind?: string } | null;
      } | null;
      setLastResult({
        outcome: result?.outcome ?? "unknown",
        actionKind: result?.actionDispatched?.kind ?? null,
      });
      onRan?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }, [agentId, escrowPaymentId, onRan, signMessageAsync, wallet.address, wallet.isConnected]);

  // Hidden while the agent is not worker-runnable.
  if (!isRunnable) return null;

  // Hidden while the on-chain payment state is unknown.
  if (paymentState === null) return null;

  // Terminal on-chain case — no further iteration is meaningful.
  if (isTerminal) {
    return (
      <div
        data-testid="agent-run-terminated"
        className="rounded-[--radius-card] border border-border bg-surface p-6"
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Case resolved
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This case reached its final on-chain state ({paymentState}). No
          further agent iterations are meaningful &mdash; the historical agent
          record and review packet remain available.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="agent-run-card"
      className="rounded-[--radius-card] border border-border bg-surface p-6"
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Run Resolution Agent
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Runs one worker iteration for this agent: observe the case on-chain,
        plan the next step, and dispatch at most one action. Signed wallet
        authorization required. No automatic or recurring execution.
      </p>

      {!wallet.isConnected && (
        <p className="mt-3 text-[13px] text-muted">
          Connect a wallet to run one iteration.
        </p>
      )}

      <div className="mt-4">
        <Button variant="primary" size="sm" onClick={handleRun} disabled={busy}>
          {busy ? "Running…" : "Run one iteration"}
        </Button>
      </div>

      {lastResult && (
        <div className="mt-3">
          <Notice variant="success">
            <p className="text-[13px] leading-relaxed">
              {`Iteration complete: ${lastResult.outcome}${
                lastResult.actionKind
                  ? ` · action ${lastResult.actionKind}`
                  : ""
              }`}
            </p>
          </Notice>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Notice variant="warning">
            <p className="text-[13px] leading-relaxed">{error}</p>
          </Notice>
        </div>
      )}
    </div>
  );
}
