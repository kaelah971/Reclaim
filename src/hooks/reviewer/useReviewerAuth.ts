"use client";

// ---------------------------------------------------------------------------
// useReviewerAuth — shared hook for reviewer wallet-based authentication
//
// Flow:
//  1. Call authenticate() to fetch a nonce, sign it with the wallet, and
//     exchange the signature for a short-lived session token.
//  2. Token and address are stored in React state (not persisted).
//  3. Remains "authenticated" until the token expires or clearAuth() is called.
// ---------------------------------------------------------------------------

import { useState, useCallback } from "react";
import { useSignMessage } from "wagmi";
import { useWalletState } from "@/hooks/wallet/useWalletState";

export type AuthStatus =
  | "idle"
  | "checking_wallet"
  | "fetching_nonce"
  | "signing"
  | "authenticating"
  | "authenticated"
  | "error";

export interface ReviewerAuthState {
  status: AuthStatus;
  sessionToken: string | null;
  address: string | null;
  error: string | null;
}

export function useReviewerAuth() {
  const [state, setState] = useState<ReviewerAuthState>({
    status: "idle",
    sessionToken: null,
    address: null,
    error: null,
  });

  const wallet = useWalletState();
  const { signMessageAsync } = useSignMessage();

  const authenticate = useCallback(async () => {
    // Reset error state
    setState((prev) => ({ ...prev, status: "checking_wallet", error: null }));

    // Must have a connected wallet
    if (!wallet.isConnected || !wallet.address) {
      setState({
        status: "error",
        sessionToken: null,
        address: null,
        error: "Connect your wallet first.",
      });
      return;
    }

    try {
      // 1. Fetch nonce
      setState((prev) => ({ ...prev, status: "fetching_nonce" }));

      const nonceRes = await fetch("/api/reviews/nonce");
      if (!nonceRes.ok) {
        const errBody = await nonceRes.json().catch(() => ({ error: "Failed to fetch nonce." }));
        throw new Error(errBody.error || `HTTP ${nonceRes.status}`);
      }
      const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };
      if (!nonce || !message) {
        throw new Error("Invalid nonce response from server.");
      }

      // 2. Sign message with wallet
      setState((prev) => ({ ...prev, status: "signing" }));

      let signature: string;
      try {
        // wagmi v3 signMessageAsync returns the hex signature
        const result = await signMessageAsync({ message });
        // In wagmi v3, the result may be wrapped in { data } or be the string directly
        signature = typeof result === "string" ? result : (result as { data: string }).data;
      } catch (signErr) {
        throw new Error(
          `Signature rejected or failed: ${signErr instanceof Error ? signErr.message : "Unknown signing error"}`,
        );
      }

      if (!signature || signature === "0x") {
        throw new Error("Wallet returned an empty signature.");
      }

      // 3. Exchange for session token
      setState((prev) => ({ ...prev, status: "authenticating" }));

      const authRes = await fetch("/api/reviews/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, message, nonce }),
      });

      const authBody = await authRes.json().catch(() => ({ error: "Invalid auth response." })) as {
        success?: boolean;
        address?: string;
        sessionToken?: string;
        error?: string;
      };

      if (!authRes.ok || !authBody.success) {
        throw new Error(authBody.error || `Authentication failed (${authRes.status}).`);
      }

      setState({
        status: "authenticated",
        sessionToken: authBody.sessionToken ?? null,
        address: authBody.address ?? null,
        error: null,
      });
    } catch (err) {
      setState({
        status: "error",
        sessionToken: null,
        address: null,
        error: err instanceof Error ? err.message : "Authentication failed.",
      });
    }
  }, [wallet.isConnected, wallet.address, signMessageAsync]);

  const clearAuth = useCallback(() => {
    setState({
      status: "idle",
      sessionToken: null,
      address: null,
      error: null,
    });
  }, []);

  const isLoading =
    state.status === "checking_wallet" ||
    state.status === "fetching_nonce" ||
    state.status === "signing" ||
    state.status === "authenticating";

  return {
    ...state,
    isLoading,
    authenticate,
    clearAuth,
    wallet,
  };
}
