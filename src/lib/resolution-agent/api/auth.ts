// ---------------------------------------------------------------------------
// Resolution Agent API — authentication and authorization service
//
// SERVER-ONLY — builds canonical signable messages and verifies wallet
// signatures against the claimed address.  Reuses the existing
// verifyWalletSignature function from the x402 module for cryptographic
// verification via viem.
// ---------------------------------------------------------------------------

import { verifyWalletSignature } from "@/lib/x402/walletAuth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Application name included in every signed message for domain separation. */
const APP_NAME = "Reclaim" as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the canonical message a user must sign with their wallet to
 * authorise creating a new resolution agent for a given payment case.
 *
 * The message includes:
 *  - Application name ("Reclaim")
 *  - Action identifier ("Create Resolution Agent")
 *  - Full case identity (chain, contract, payment ID)
 *  - The approved budget in atomic USDC units
 *  - The funder wallet address
 *  - A high-resolution timestamp for replay protection
 *  - A random nonce for strict uniqueness
 *
 * The client MUST sign this exact string and pass it to the server for
 * verification.
 */
export function buildCreateAgentMessage(params: {
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  budgetAtomic: bigint;
  funderAddress: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);

  return [
    `${APP_NAME} — Create Resolution Agent`,
    `Action: create_resolution_agent`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${params.escrowContractAddress}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Approved Budget (atomic USDC): ${params.budgetAtomic.toString()}`,
    `Funder Address: ${params.funderAddress}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control the funder wallet and authorise the creation of a resolution agent for this payment case.`,
  ].join("\n");
}

/**
 * Builds the canonical message a user must sign with their wallet to
 * authorise activating an existing resolution agent.
 *
 * The message includes:
 *  - Application name ("Reclaim")
 *  - Action identifier ("Activate Resolution Agent")
 *  - The agent ID being activated
 *  - The funder wallet address
 *  - A high-resolution timestamp for replay protection
 *  - A random nonce for strict uniqueness
 *
 * The client MUST sign this exact string and pass it to the server for
 * verification.
 */
export function buildActivationMessage(params: {
  agentId: string;
  funderAddress: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);

  return [
    `${APP_NAME} — Activate Resolution Agent`,
    `Action: activate_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Funder Address: ${params.funderAddress}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control the funder wallet and authorise activation of this resolution agent.`,
  ].join("\n");
}

/**
 * Verifies a wallet signature against the claimed address and message.
 *
 * This is a thin wrapper around the existing `verifyWalletSignature` from
 * the x402 module.  It normalises inputs and returns a structured result.
 *
 * @param claimedAddress — The 0x-prefixed EVM address the signer claims to be.
 * @param message        — The canonical message string that was signed.
 * @param signature      — The 0x-prefixed ECDSA signature hex.
 *
 * @returns `{ verified: true }` on success, or `{ verified: false, error }`
 *          with a human-readable error message on failure.
 */
export async function verifyAuth(params: {
  claimedAddress: string;
  message: string;
  signature: string;
}): Promise<{ verified: boolean; error?: string }> {
  return verifyWalletSignature(
    params.claimedAddress,
    params.message,
    params.signature,
  );
}
