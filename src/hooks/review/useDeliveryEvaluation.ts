"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryEvaluation } from "@/lib/review/deliveryEvaluation";

// ---------------------------------------------------------------------------
// useDeliveryEvaluation — party-scoped delivery review fetch (P6.2).
//
// Reuses the SAME P4.3D wallet-challenge flow as SecureEvidenceViewer:
// challenge → wallet signature → single-use evaluation POST. Anonymous stays
// idle; the caller gates `enabled` (agent_assisted + DeliverySubmitted /
// ReleaseRequested + connected party). No transaction, no autopilot —
// read-only evaluation display data.
// ---------------------------------------------------------------------------

export type DeliveryEvaluationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export interface UseDeliveryEvaluationReturn {
  status: DeliveryEvaluationStatus;
  evaluation: DeliveryEvaluation | null;
  role: "client" | "worker" | null;
  releaseMode: "manual" | "agent_assisted" | null;
  unavailableMessage: string | null;
  error: string | null;
  retry: () => void;
}

interface UseDeliveryEvaluationParams {
  paymentId: string;
  chainId: number;
  walletAddress: string | undefined;
  isConnected: boolean;
  enabled: boolean;
  signMessage: (message: string) => Promise<string>;
}

export function useDeliveryEvaluation({
  paymentId,
  chainId,
  walletAddress,
  isConnected,
  enabled,
  signMessage,
}: UseDeliveryEvaluationParams): UseDeliveryEvaluationReturn {
  const [status, setStatus] = useState<DeliveryEvaluationStatus>("idle");
  const [evaluation, setEvaluation] = useState<DeliveryEvaluation | null>(null);
  const [role, setRole] = useState<"client" | "worker" | null>(null);
  const [releaseMode, setReleaseMode] = useState<
    "manual" | "agent_assisted" | null
  >(null);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const signMessageRef = useRef(signMessage);

  useEffect(() => {
    signMessageRef.current = signMessage;
  });

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // Derived during render (never written in the effect below): anonymous,
  // disconnected, or manual-mode callers stay idle without any fetch.
  const isActive = enabled && isConnected && Boolean(walletAddress);

  useEffect(() => {
    if (!isActive || !walletAddress) {
      return;
    }
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setError(null);
      setUnavailableMessage(null);
      try {
        const challengeRes = await fetch(
          `/api/payments/${paymentId}/evidence/challenge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId,
              wallet: walletAddress,
              purpose: "evidence-read",
            }),
          },
        );
        if (!challengeRes.ok) {
          throw new Error("Could not start the delivery review.");
        }
        const challenge = (await challengeRes.json()) as {
          challengeId?: string;
          message?: string;
        };
        if (!challenge.challengeId || !challenge.message) {
          throw new Error("Could not start the delivery review.");
        }
        const signature = await signMessageRef.current(challenge.message);
        const evalRes = await fetch(
          `/api/payments/${paymentId}/delivery-evaluation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: challenge.challengeId,
              signature,
              chainId,
              wallet: walletAddress,
            }),
          },
        );
        const data = (await evalRes.json()) as {
          available?: boolean;
          evaluation?: DeliveryEvaluation;
          role?: "client" | "worker";
          releaseMode?: "manual" | "agent_assisted";
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!evalRes.ok) {
          throw new Error(data.error ?? "Could not review the delivery.");
        }
        if (!data.available || !data.evaluation) {
          setEvaluation(null);
          setUnavailableMessage(data.message ?? null);
          setStatus("unavailable");
          return;
        }
        setEvaluation(data.evaluation);
        setRole(data.role ?? null);
        setReleaseMode(data.releaseMode ?? null);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not review the delivery.",
        );
        setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isActive, walletAddress, paymentId, chainId, attempt]);

  return {
    status: isActive ? status : "idle",
    evaluation,
    role,
    releaseMode,
    unavailableMessage,
    error,
    retry,
  };
}
