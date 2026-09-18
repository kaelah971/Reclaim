"use client";

import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import {
  readPartyEvidence,
  type PartyEvidence,
} from "@/lib/evidence/partyRead";

// ---------------------------------------------------------------------------
// SecureEvidenceViewer — party-gated delivery evidence read (P4.4a).
//
// "View delivery evidence" → challenge (POST only via the partyRead helper,
// never the GET alias) → wagmi signMessage by the connected wallet → render
// minimal delivery material (title / note / date + small metadata) in
// ephemeral component state ONLY (useState — no storage, no URL params).
//
// - Signature reject / expiry / replay → clear inline error + retry, which
//   requests a brand-new challenge (single-use challenges are never reused).
// - Unrelated wallets never receive content (server denies with NOT_PARTY).
// - Unauthenticated viewers see the hash + a connect hint, never content and
//   never a public fallback fetch.
// ---------------------------------------------------------------------------

interface SecureEvidenceViewerProps {
  paymentId: string;
  chainId: number;
  walletAddress?: string;
  isConnected: boolean;
  /** On-chain evidence hash (always safe to display, even unauthenticated). */
  evidenceReference: string;
  className?: string;
  /** Test seam: override the wallet signer (defaults to wagmi). */
  signMessage?: (message: string) => Promise<string>;
  /** Test seam: override the party read (defaults to the POST-only helper). */
  readFn?: typeof readPartyEvidence;
}

type ViewerStatus = "idle" | "loading" | "ready" | "error";

function mapEvidenceError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const message =
    err instanceof Error && err.message ? err.message : "Could not load the evidence.";
  const lower = `${message} ${code}`.toLowerCase();

  if (code === "NOT_PARTY") {
    return "Only the client or worker for this payment can view delivery evidence.";
  }
  if (code === "CHALLENGE_EXPIRED") {
    return "This access request expired. Try again to request a fresh challenge.";
  }
  if (code === "CHALLENGE_CONSUMED") {
    return "This access request was already used. Try again to request a fresh challenge.";
  }
  if (
    code === "SIGNER_MISMATCH" ||
    code === "SIGNATURE_INVALID" ||
    lower.includes("reject") ||
    lower.includes("denied") ||
    lower.includes("cancel")
  ) {
    return "Signature was not completed. No evidence was revealed. Try again for a fresh challenge.";
  }
  if (code === "CHALLENGE_REQUIRED" || code === "INVALID_WALLET" || code === "MISSING_CHAIN") {
    return "Connect your wallet to view delivery evidence. The evidence hash is shown — no content is revealed until you sign.";
  }
  return `${message} Try again for a fresh challenge.`;
}

export default function SecureEvidenceViewer({
  paymentId,
  chainId,
  walletAddress,
  isConnected,
  evidenceReference,
  className = "",
  signMessage,
  readFn,
}: SecureEvidenceViewerProps) {
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [evidence, setEvidence] = useState<PartyEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleView = useCallback(async () => {
    // Unauthenticated → hash + hint, never a content fetch.
    if (!isConnected || !walletAddress) {
      setEvidence(null);
      setStatus("error");
      setError(
        "Connect your wallet to view delivery evidence. The evidence hash is shown — no content is revealed until you sign.",
      );
      return;
    }
    setStatus("loading");
    setError(null);
    setEvidence(null);
    try {
      const wallet = walletAddress;
      const signer = signMessage ?? ((msg: string) => signMessageAsync({ message: msg }));
      const read = readFn ?? readPartyEvidence;
      const result = await read({
        paymentId,
        chainId,
        wallet,
        signMessage: signer,
      });
      setEvidence(result);
      setStatus("ready");
    } catch (err) {
      // Clear any partial content; retry always starts a new challenge.
      setEvidence(null);
      setStatus("error");
      setError(mapEvidenceError(err));
    }
  }, [chainId, isConnected, paymentId, readFn, signMessage, signMessageAsync, walletAddress]);

  const handleRetry = useCallback(() => {
    setError(null);
    setEvidence(null);
    setStatus("idle");
    void handleView();
  }, [handleView]);

  const handleHide = useCallback(() => {
    setEvidence(null);
    setError(null);
    setStatus("idle");
  }, []);

  const note = evidence
    ? (evidence.description ?? evidence.pastedText ?? evidence.claim ?? null)
    : null;
  const dateLabel = evidence ? (evidence.date ?? evidence.submittedAt ?? null) : null;

  return (
    <div className={className}>
      {status !== "ready" && (
        <div className="space-y-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleView()}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Requesting access…" : "View delivery evidence"}
          </Button>
          {status === "loading" && (
            <p className="text-[13px] text-muted" aria-live="polite">
              Requesting access… sign the challenge in your wallet when prompted.
            </p>
          )}
          {status === "error" && error && (
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">{error}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                  onClick={handleRetry}
                >
                  Try again
                </button>
              </div>
            </Notice>
          )}
          {!isConnected && (
            <p className="text-[13px] text-muted">
              Evidence hash:{" "}
              <span className="font-[family-name:var(--font-ibm-plex-mono)] break-all">
                {evidenceReference || "Not submitted"}
              </span>
            </p>
          )}
        </div>
      )}

      {status === "ready" && evidence && (
        <div className="rounded-[--radius-card] border border-border bg-input p-4 space-y-2">
          <p className="text-[13px] uppercase tracking-[0.15em] text-muted">
            Delivery evidence
          </p>
          <p className="text-[15px] font-medium text-ink">
            {evidence.title ?? "Delivery evidence"}
          </p>
          <p className="text-[14px] leading-relaxed text-ink">
            {note ?? "No delivery note provided."}
          </p>
          {dateLabel && (
            <p className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
              {dateLabel}
            </p>
          )}
          {(evidence.evidenceType || evidence.submittedAt) && (
            <p className="text-[13px] text-muted">
              {evidence.evidenceType ? `${evidence.evidenceType}` : ""}
              {evidence.evidenceType && evidence.submittedAt ? " · " : ""}
              {evidence.submittedAt ? `Submitted ${evidence.submittedAt}` : ""}
            </p>
          )}
          <button
            type="button"
            className="text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
            onClick={handleHide}
          >
            Hide evidence
          </button>
        </div>
      )}
    </div>
  );
}

export { mapEvidenceError };
