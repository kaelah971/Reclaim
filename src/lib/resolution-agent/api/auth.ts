// ---------------------------------------------------------------------------
// Resolution Agent API — authentication and authorization service
//
// SERVER-ONLY — builds canonical signable messages and verifies wallet
// signatures against the claimed address.  Reuses the existing
// verifyWalletSignature function from the x402 module for cryptographic
// verification via viem.
//
// Hardened messages include policy version, authorization expiry timestamps,
// canonical escrow contract address, tool allowlists, and fixed goals so that
// a signature is tightly bound to a single authorised action and cannot be
// replayed in a different context.
// ---------------------------------------------------------------------------

import { verifyWalletSignature } from "@/lib/x402/walletAuth";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "./escrow-reader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Application name included in every signed message for domain separation. */
const APP_NAME = "Reclaim" as const;

/** Authorization expiry window for signed messages (5 minutes in ms). */
const AUTH_EXPIRY_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the canonical message a user must sign with their wallet to
 * authorise creating a new resolution agent for a given payment case.
 *
 * Hardened bindings added:
 *  - `policyVersion: "v1"`
 *  - `authorizationExpiry` (5 minutes from message creation)
 *  - `canonicalEscrowContract` (fixed server-owned canonical address)
 *
 * Full message format:
 * ```
 * Reclaim — Create Resolution Agent
 * Action: create_resolution_agent
 * Version: v1
 * Escrow Chain ID: eip155:11142220
 * Escrow Contract: {canonical}
 * Escrow Payment ID: {paymentId}
 * Approved Budget (atomic USDC): {budget}
 * Funder Address: {funder}
 * Policy Version: v1
 * Authorization Expires: {expiryTimestamp}
 * Timestamp: {timestamp}
 * Nonce: {nonce}
 * By signing this message, you confirm that you control this wallet...
 * ```
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
  const authorizationExpiry = timestamp + AUTH_EXPIRY_WINDOW_MS;

  // Always use the canonical escrow contract address so the signature
  // binds to the server-trusted contract, not a client-supplied address.
  const canonicalContract = CANONICAL_ESCROW_CONTRACT_ADDRESS;

  return [
    `${APP_NAME} — Create Resolution Agent`,
    `Action: create_resolution_agent`,
    `Version: v1`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${canonicalContract}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Approved Budget (atomic USDC): ${params.budgetAtomic.toString()}`,
    `Funder Address: ${params.funderAddress}`,
    `Policy Version: v1`,
    `Authorization Expires: ${authorizationExpiry}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control this wallet and authorise creation of a resolution agent for the specified payment case.`,
  ].join("\n");
}

/**
 * Builds the canonical message a user (the funder) must sign with their
 * wallet to authorise activating an existing resolution agent.
 *
 * **CRITICAL HARDENING** — the message includes ALL permissions being
 * activated, read from the actual agent state.  This prevents signature
 * reuse across different agents, cases, budgets, or tool configurations.
 *
 * Full message format:
 * ```
 * Reclaim — Activate Resolution Agent
 * Action: activate_resolution_agent
 * Version: v1
 * Agent ID: {agentId}
 * Escrow Chain ID: {chainId}
 * Escrow Contract: {contract}
 * Escrow Payment ID: {paymentId}
 * Fixed Goal: {goal}
 * Approved Budget (atomic USDC): {budget}
 * Refund Address: {refund}
 * Policy Version: {policyVersion}
 * Allowed Tools: evidence-quality-check, case-refresh, reclaim-dispute-brief-v1
 * Agent Expires At: {agentExpiry}
 * Authorization Expires: {authExpiry}
 * Timestamp: {timestamp}
 * Nonce: {nonce}
 * By signing this message, you confirm that you control this wallet...
 * ```
 *
 * The client MUST sign this exact string and pass it to the server for
 * verification.  The server will reconstruct this message from the agent's
 * stored state and verify it matches byte-for-byte (excluding variable
 * timestamp/nonce fields).
 */
export function buildActivationMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  goal: string;
  approvedBudgetAtomic: bigint;
  refundAddress: string;
  policyVersion: string;
  allowedToolIds: readonly string[];
  agentExpiresAt: number;
  authorizationExpiresAt: number;
  funderAddress: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);

  // Always use the canonical escrow contract address.
  const escrowContractAddress = CANONICAL_ESCROW_CONTRACT_ADDRESS;

  return [
    `${APP_NAME} — Activate Resolution Agent`,
    `Action: activate_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${escrowContractAddress}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Goal: ${params.goal}`,
    `Approved Budget (atomic USDC): ${params.approvedBudgetAtomic.toString()}`,
    `Refund Address: ${params.refundAddress}`,
    `Allowed Tools: ${params.allowedToolIds.join(", ")}`,
    `Policy Version: ${params.policyVersion}`,
    `Agent Expiry: ${params.agentExpiresAt}`,
    `Authorization Expires: ${params.authorizationExpiresAt}`,
    `Funder Address: ${params.funderAddress}`,
    `Version: v1`,
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

// ---------------------------------------------------------------------------
// Pause / Resume Message Builders
// ---------------------------------------------------------------------------

/**
 * Builds the canonical message a user must sign to authorise pausing an
 * active or waiting resolution agent.
 */
export function buildPauseMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);
  const authorizationExpiry = timestamp + AUTH_EXPIRY_WINDOW_MS;

  return [
    `${APP_NAME} — Pause Resolution Agent`,
    `Action: pause_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Authorization Expires: ${authorizationExpiry}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control this wallet and authorise pausing the resolution agent.`,
  ].join("\n");
}

/**
 * Builds the canonical message a user must sign to authorise resuming a
 * paused resolution agent.
 */
export function buildResumeMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);
  const authorizationExpiry = timestamp + AUTH_EXPIRY_WINDOW_MS;

  return [
    `${APP_NAME} — Resume Resolution Agent`,
    `Action: resume_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Authorization Expires: ${authorizationExpiry}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control this wallet and authorise resuming the resolution agent.`,
  ].join("\n");
}

/**
 * Builds the canonical message a user (the funder) must sign to authorise
 * closing a resolution agent and reclaiming unused USDC.
 */
export function buildCloseMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  funderAddress: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);
  const authorizationExpiry = timestamp + AUTH_EXPIRY_WINDOW_MS;

  return [
    `${APP_NAME} — Close Resolution Agent`,
    `Action: close_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Refund Destination: ${params.funderAddress}`,
    `Authorization Expires: ${authorizationExpiry}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `WARNING: Closing is permanent. Unused USDC will be returned to the funder wallet. The case wallet will be permanently disabled.`,
  ].join("\n");
}

/**
 * Builds the canonical message a user (the funder) must sign to authorise
 * amending the approved budget of a resolution agent that has not yet been
 * funded or activated.
 *
 * Only allowed in pre-activation states (awaiting_funding, awaiting_activation)
 * and only funder-upwards (increasing budget).  The message binds the agent
 * identity, the old and new budget, and the amend action so the signature
 * cannot be replayed for a different budget change.
 */
export function buildAmendBudgetMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  oldBudgetAtomic: bigint;
  newBudgetAtomic: bigint;
  funderAddress: string;
}): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().slice(0, 12);
  const authorizationExpiry = timestamp + AUTH_EXPIRY_WINDOW_MS;

  return [
    `${APP_NAME} — Amend Resolution Agent Budget`,
    `Action: amend_budget_resolution_agent`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Old Approved Budget (atomic USDC): ${params.oldBudgetAtomic.toString()}`,
    `New Approved Budget (atomic USDC): ${params.newBudgetAtomic.toString()}`,
    `Funder Address: ${params.funderAddress}`,
    `Authorization Expires: ${authorizationExpiry}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
    `By signing this message, you confirm that you control the funder wallet and authorise amending this resolution agent's approved budget.`,
  ].join("\n");
}
