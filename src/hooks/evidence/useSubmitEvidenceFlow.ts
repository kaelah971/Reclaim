"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { keccak256, stringToHex } from "viem";
import {
  buildEvidenceManifest,
  type EvidenceFormData,
} from "@/lib/evidence/manifest";
import { useSubmitEvidenceHash } from "@/hooks/contracts/useEscrowActions";
import { getEscrowChainId } from "@/lib/contracts/config";
import type { EscrowChainReference } from "@/lib/contracts/config";
import { celoChain } from "@/lib/web3/chains";

// ---------------------------------------------------------------------------
// useSubmitEvidenceFlow — evidence submission lifecycle
//
// Required semantics:
//   canonical manifest → keccak256 → submitEvidenceHash tx (wallet signature)
//   → wait for successful receipt → ONLY THEN POST evidence metadata
//   → ONLY THEN present success / redirect.
//
// Wallet rejection, a missing tx hash, a failed/reverted receipt, a network
// mismatch, or a metadata persistence failure all surface as errors and
// never present success.
// ---------------------------------------------------------------------------

export type EvidenceMetadataState = "idle" | "persisted" | "error";

export interface SubmitEvidenceFlow {
  /** Start the submission for the given evidence form data. */
  submit: (data: EvidenceFormData) => void;
  /** True while the tx is pending or confirming on-chain. */
  isPending: boolean;
  /** True once the submitEvidenceHash receipt confirmed (metadata pending). */
  isTxConfirmed: boolean;
  /** True only after the tx confirmed AND metadata persisted. */
  isSuccess: boolean;
  /** Transaction hash once the wallet has signed the submitEvidenceHash call. */
  txHash: `0x${string}` | undefined;
  /** Transaction-level error (gate / simulation / wallet rejection). */
  error: string | null;
  /** The manifest reference that was submitted. */
  lastReference: `0x${string}` | null;
  /** Metadata persistence state (idle = waiting for tx or POST in flight). */
  metadataState: EvidenceMetadataState;
  /** Metadata persistence error (after a confirmed tx). */
  metadataError: string | null;
  /** Re-attempt the metadata persistence after a failure. */
  retryMetadata: () => void;
  /** Reset the whole flow back to its initial state. */
  reset: () => void;
  /**
   * P6.4E metadata-only recovery: POST already-confirmed delivery details
   * WITHOUT any chain write (never calls submitEvidenceTx). Used after a
   * refresh wiped the in-memory manifest, or when the metadata POST raced a
   * stale chain read (HASH_MISMATCH on a matching manifest).
   */
  recoverMetadata: (data: EvidenceFormData) => void;
  /**
   * P6.4E: read the durable manifest stored by submit() for this payment,
   * or null when absent/unparseable. Used by the UI to offer one-click retry.
   */
  hasStoredManifest: () => EvidenceFormData | null;
  /** True while a recoverMetadata POST is in flight. */
  isRecovering: boolean;
}

/** P6.4E durable manifest key — survives refresh (in-memory ref does not). */
export function evidenceManifestStorageKey(
  chainIdStr: string,
  paymentIdStr: string,
): string {
  return `reclaim.evidenceManifest.${chainIdStr}.${paymentIdStr}`;
}

/**
 * P6.4E: read a stored manifest without the hook (room prefill path).
 * Returns null outside the browser or when absent/unparseable.
 */
export function readStoredEvidenceManifest(
  paymentIdStr: string | undefined,
  chainIdStr: string | undefined,
): EvidenceFormData | null {
  if (!paymentIdStr || !chainIdStr) return null;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(
      evidenceManifestStorageKey(chainIdStr, paymentIdStr),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EvidenceFormData>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.type !== "string" ||
      typeof parsed.date !== "string"
    ) {
      return null;
    }
    return {
      title: parsed.title,
      description: parsed.description,
      type: parsed.type,
      relatedClaim:
        typeof parsed.relatedClaim === "string" ? parsed.relatedClaim : "",
      date: parsed.date,
      externalRef:
        typeof parsed.externalRef === "string" ? parsed.externalRef : "",
      pastedText:
        typeof parsed.pastedText === "string" ? parsed.pastedText : "",
      fileHash: typeof parsed.fileHash === "string" ? parsed.fileHash : "",
    };
  } catch {
    return null;
  }
}

function clearStoredEvidenceManifest(
  paymentIdStr: string | undefined,
  chainIdStr: string | undefined,
): void {
  if (!paymentIdStr || !chainIdStr) return;
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(
      evidenceManifestStorageKey(chainIdStr, paymentIdStr),
    );
  } catch {
    // Durability is best-effort — a storage failure must never break submit.
  }
}

export function useSubmitEvidenceFlow(
  paymentId: bigint | undefined,
  paymentIdStr: string | undefined,
  // P4.1a: explicit escrow chain threading (default Sepolia for backward
  // compat; production callers must pass 42220 explicitly). Manifest, hash,
  // and metadata logic below are unchanged.
  chain: EscrowChainReference = celoChain,
): SubmitEvidenceFlow {
  const {
    action: submitEvidenceTx,
    isPending,
    isSuccess: isTxConfirmed,
    error,
    txHash,
    reset: resetTx,
  } = useSubmitEvidenceHash(chain);

  const submittedRef = useRef<EvidenceFormData | null>(null);
  const [lastReference, setLastReference] = useState<`0x${string}` | null>(null);
  const [metadataState, setMetadataState] = useState<EvidenceMetadataState>("idle");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [submitSeq, setSubmitSeq] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);

  // P4.3b: the POST body carries the explicit escrow chain so the server
  // verifies the manifest hash against the canonical payment+chain (never
  // the Sepolia default for a Mainnet submission). The URL is unchanged for
  // backward compatibility; the server also accepts ?chainId=.
  const escrowChainId = String(getEscrowChainId(chain));

  const submit = useCallback(
    (data: EvidenceFormData) => {
      if (!paymentId) return;
      // P4.5F action locking: never rebroadcast once a receipt is known.
      // The confirmed tx + metadata flow owns the lifecycle; a second submit
      // would double-broadcast the same evidence hash.
      if (isPending || isTxConfirmed) return;
      const manifest = buildEvidenceManifest(data);
      const reference = keccak256(stringToHex(manifest));

      submittedRef.current = data;
      setMetadataState("idle");
      setMetadataError(null);
      setLastReference(reference);
      setSubmitSeq((seq) => seq + 1);

      // P6.4E durability: the in-memory ref is wiped by refresh — persist
      // the manifest so a stale-read 400 (or any metadata failure) stays
      // recoverable without resubmitting on-chain.
      try {
        if (
          typeof window !== "undefined" &&
          window.localStorage &&
          paymentIdStr
        ) {
          window.localStorage.setItem(
            evidenceManifestStorageKey(escrowChainId, paymentIdStr),
            JSON.stringify(data),
          );
        }
      } catch {
        // Durability is best-effort — a storage failure must never block submit.
      }

      submitEvidenceTx(paymentId, reference);
    },
    [paymentId, paymentIdStr, escrowChainId, submitEvidenceTx, isPending, isTxConfirmed],
  );

  // After the tx receipt confirms, persist the metadata. Success is only
  // presented once the metadata POST itself succeeded.
  useEffect(() => {
    if (!isTxConfirmed || !txHash || !submittedRef.current) return;
    if (metadataState !== "idle") return;

    const stored = submittedRef.current;
    let cancelled = false;

    fetch(`/api/payments/${paymentIdStr}/evidence/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: stored.title,
        description: stored.description,
        type: stored.type,
        relatedClaim: stored.relatedClaim,
        date: stored.date,
        externalRef: stored.externalRef,
        pastedText: stored.pastedText,
        fileHash: stored.fileHash,
        chainId: Number(escrowChainId),
        escrowChainId,
      }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const detail = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(
            detail.startsWith("{")
              ? `Evidence metadata could not be persisted: HTTP ${res.status}`
              : `Evidence metadata could not be persisted: ${detail}`,
          );
        }
        setMetadataState("persisted");
        // P6.4E durability: the manifest is now persisted server-side — the
        // local copy is no longer needed.
        clearStoredEvidenceManifest(paymentIdStr, escrowChainId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMetadataError(
          err instanceof Error && err.message
            ? err.message
            : "Evidence metadata could not be persisted.",
        );
        setMetadataState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isTxConfirmed, txHash, paymentIdStr, metadataState, submitSeq, escrowChainId]);

  const retryMetadata = useCallback(() => {
    setMetadataError(null);
    setMetadataState("idle");
  }, []);

  const reset = useCallback(() => {
    submittedRef.current = null;
    setLastReference(null);
    setMetadataError(null);
    setMetadataState("idle");
    setIsRecovering(false);
    resetTx();
  }, [resetTx]);

  /**
   * P6.4E metadata-only recovery — POSTs already-confirmed delivery details
   * with the exact submit() body shape (incl. chainId + escrowChainId) and
   * NEVER touches the chain (no submitEvidenceTx / writeContract call).
   *
   * The normal POST effect cannot fire after a refresh (it requires
   * isTxConfirmed && txHash, both false post-refresh), so recovery carries
   * its own POST path. On success the durable manifest copy is cleared.
   */
  const recoverMetadata = useCallback(
    (data: EvidenceFormData) => {
      if (!paymentIdStr) return;
      if (isRecovering) return;
      submittedRef.current = data;
      setMetadataError(null);
      setMetadataState("idle");
      setIsRecovering(true);

      fetch(`/api/payments/${paymentIdStr}/evidence/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          type: data.type,
          relatedClaim: data.relatedClaim,
          date: data.date,
          externalRef: data.externalRef,
          pastedText: data.pastedText,
          fileHash: data.fileHash,
          chainId: Number(escrowChainId),
          escrowChainId,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const detail = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(
              detail.startsWith("{")
                ? `Evidence metadata could not be persisted: HTTP ${res.status}`
                : `Evidence metadata could not be persisted: ${detail}`,
            );
          }
          setMetadataState("persisted");
          clearStoredEvidenceManifest(paymentIdStr, escrowChainId);
        })
        .catch((err: unknown) => {
          setMetadataError(
            err instanceof Error && err.message
              ? err.message
              : "Evidence metadata could not be persisted.",
          );
          setMetadataState("error");
        })
        .finally(() => {
          setIsRecovering(false);
        });
    },
    [paymentIdStr, escrowChainId, isRecovering],
  );

  /**
   * P6.4E: read the durable manifest stored by submit() (null when absent).
   * Safe outside the browser (returns null) and never throws.
   */
  const hasStoredManifest = useCallback((): EvidenceFormData | null => {
    return readStoredEvidenceManifest(paymentIdStr, escrowChainId);
  }, [paymentIdStr, escrowChainId]);

  return {
    submit,
    isPending,
    isTxConfirmed,
    isSuccess: isTxConfirmed && metadataState === "persisted",
    txHash,
    error,
    lastReference,
    metadataState,
    metadataError,
    retryMetadata,
    reset,
    recoverMetadata,
    hasStoredManifest,
    isRecovering,
  };
}
