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

      submitEvidenceTx(paymentId, reference);
    },
    [paymentId, submitEvidenceTx, isPending, isTxConfirmed],
  );

  // After the tx receipt confirms, persist the metadata. Success is only
  // presented once the metadata POST itself succeeded.
  //
  // P4.3b: the POST body carries the explicit escrow chain so the server
  // verifies the manifest hash against the canonical payment+chain (never
  // the Sepolia default for a Mainnet submission). The URL is unchanged for
  // backward compatibility; the server also accepts ?chainId=.
  const escrowChainId = String(getEscrowChainId(chain));
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
    resetTx();
  }, [resetTx]);

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
  };
}
