"use client";

import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { buildRenewPolicyMessage } from "@/lib/resolution-agent/api/auth";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";

// ---------------------------------------------------------------------------
// AgentPolicyRenewCard — explicit funder-only policy renewal control.
//
// Shown only when the agent policy is EXPIRED and the connected wallet is
// the funder. Clicking:
//   1. builds the canonical renew-policy message (RA1R.7B)
//   2. asks the CONNECTED FUNDER wallet to sign it (personal_sign)
//   3. POSTs to /api/resolution-agents/[agentId]/renew
//   4. shows explicit success/error and refreshes expires_at
//
// Default extension: +24 hours from current time. There is NO automatic
// renewal, and this control never executes the worker, x402, or any
// transaction — it only updates the agent's policy expiry.
// ---------------------------------------------------------------------------

const RENEWAL_EXTENSION_MS = 24 * 60 * 60 * 1000;
const CANONICAL_ESCROW_CHAIN_ID = "eip155:11142220";

interface AgentPolicyRenewCardProps {
  agentId: string;
  escrowPaymentId: string;
  /** Policy expiry (epoch ms). */
  expiresAt: number;
  /** Funder address (checksummed) that may renew this agent. */
  funderAddress: string;
  /** Called after a successful renewal so the parent can refresh. */
  onRenewed?: (newExpiresAt: number) => void;
}

export default function AgentPolicyRenewCard({
  agentId,
  escrowPaymentId,
  expiresAt,
  funderAddress,
  onRenewed,
}: AgentPolicyRenewCardProps) {
  const wallet = useWalletState();
  const { signMessageAsync } = useSignMessage();

  const [busy, setBusy] = useState(false);
  const [renewedAt, setRenewedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mount-time clock (idempotent per render) — expiry is compared against
  // the time the page loaded, refreshed via onRenewed.
  const [now] = useState(() => Date.now());

  const isExpired = expiresAt <= now;
  const isFunder =
    wallet.isConnected &&
    wallet.address !== undefined &&
    wallet.address.toLowerCase() === funderAddress.toLowerCase();

  const handleRenew = useCallback(async () => {
    if (!wallet.address) return;
    if (!isFunder) return;

    setBusy(true);
    setError(null);
    setRenewedAt(null);

    const newExpiresAt = Date.now() + RENEWAL_EXTENSION_MS;

    try {
      const canonicalMessage = buildRenewPolicyMessage({
        agentId,
        escrowChainId: CANONICAL_ESCROW_CHAIN_ID,
        escrowPaymentId,
        oldExpiresAtMs: expiresAt,
        newExpiresAtMs: newExpiresAt,
        funderAddress,
      });

      const signature = await signMessageAsync({ message: canonicalMessage });

      const res = await fetch(
        `/api/resolution-agents/${encodeURIComponent(agentId)}/renew`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet-address": wallet.address,
            "x-wallet-message": canonicalMessage,
            "x-wallet-signature": signature,
          },
          body: JSON.stringify({ expiresAt: String(newExpiresAt) }),
        },
      );

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `Renewal failed (HTTP ${res.status})`,
        );
      }

      setRenewedAt(newExpiresAt);
      onRenewed?.(newExpiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renewal failed.");
    } finally {
      setBusy(false);
    }
  }, [agentId, escrowPaymentId, expiresAt, funderAddress, isFunder, onRenewed, signMessageAsync, wallet.address]);

  if (!isExpired) return null;

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Policy Status
      </h3>
      <p className="mt-2 text-[13px] text-muted">
        This agent&rsquo;s policy expired on{" "}
        <span className="font-[family-name:var(--font-ibm-plex-mono)] text-ink">
          {new Date(expiresAt).toISOString()}
        </span>
        . Renewal adds 24 hours and requires the funder wallet signature.
      </p>

      {!wallet.isConnected && (
        <p className="mt-3 text-[13px] text-muted">
          Connect the funder wallet to renew this policy.
        </p>
      )}

      {wallet.isConnected && !isFunder && (
        <Notice variant="warning" className="mt-3">
          <p className="text-[13px] leading-relaxed">
            This policy can only be renewed by its funder:{" "}
            <span className="font-[family-name:var(--font-ibm-plex-mono)] break-all">
              {funderAddress}
            </span>
          </p>
        </Notice>
      )}

      {isFunder && (
        <>
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={handleRenew} disabled={busy}>
              {busy ? "Renewing…" : "Renew agent policy"}
            </Button>
          </div>

          {renewedAt !== null && (
            <div className="mt-3">
              <Notice variant="success">
                <p className="text-[13px] leading-relaxed">
                  Policy renewed. New expiry:{" "}
                  <span className="font-[family-name:var(--font-ibm-plex-mono)]">
                    {new Date(renewedAt).toISOString()}
                  </span>
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
        </>
      )}
    </div>
  );
}
