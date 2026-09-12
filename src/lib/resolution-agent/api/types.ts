// ---------------------------------------------------------------------------
// Resolution Agent API — request/response Zod schemas and types
//
// SERVER-ONLY — these schemas validate incoming HTTP request payloads and
// headers before they reach the service layer. Never import from client code.
//
// Hardened: escrowChainId and escrowContractAddress are now server-enforced
// canonical values. Only escrowPaymentId and budgetAtomic are required from
// the client. This prevents clients from specifying arbitrary escrow contracts.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical budget options (atomic USDC)
//
// These are the ONLY budgets the server will approve. The values are in
// atomic USDC units (USDC has 6 decimals, so 10000 = $0.01, 30000 = $0.03).
// ---------------------------------------------------------------------------

export const SUPPORTED_BUDGETS = [30000n, 40000n, 50000n] as const;
export type SupportedBudget = (typeof SUPPORTED_BUDGETS)[number];

/**
 * Validates that a string represents one of the canonical supported budgets.
 * The string is converted to bigint and checked against the allowlist.
 */
function isSupportedBudget(value: string): boolean {
  try {
    const n = BigInt(value);
    return SUPPORTED_BUDGETS.includes(n as SupportedBudget);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Creation request
// ---------------------------------------------------------------------------

/**
 * Schema for POST /api/resolution-agent/create request body.
 *
 * HARDENED: The escrow chain ID and contract address are server-enforced
 * canonical values and are NOT accepted from the client. Only the
 * escrow payment ID and the approved budget are required from the caller.
 *
 * Budget must be one of the three canonical values.
 */
export const createAgentRequestSchema = z.object({
  escrowPaymentId: z
    .string()
    .min(1, "Payment ID must not be empty")
    .regex(
      /^[0-9]+$/,
      "Payment ID must be a numeric escrow identifier",
    ),
  budgetAtomic: z.string().refine(isSupportedBudget, {
    message: "Budget must be one of: 30000, 40000, 50000 atomic USDC",
  }),
}).strict();

export type CreateAgentRequestBody = z.infer<typeof createAgentRequestSchema>;

// ---------------------------------------------------------------------------
// Activation request
// ---------------------------------------------------------------------------

/**
 * Schema for POST /api/resolution-agent/activate request body.
 */
export const activateAgentRequestSchema = z.object({
  agentId: z
    .string()
    .min(1, "Agent ID must not be empty")
    .max(128, "Agent ID must not exceed 128 characters"),
});

export type ActivateAgentRequestBody = z.infer<typeof activateAgentRequestSchema>;

// ---------------------------------------------------------------------------
// Budget amendment request
// ---------------------------------------------------------------------------

/**
 * Schema for POST /api/resolution-agents/[agentId]/amend-budget request body.
 *
 * Only canonical budgets are accepted.  The new budget must be strictly
 * greater than the current budget (budget can only go up before activation).
 */
export const amendBudgetRequestSchema = z.object({
  budgetAtomic: z.string().refine(isSupportedBudget, {
    message: "Budget must be one of: 30000, 40000, 50000 atomic USDC",
  }),
}).strict();

export type AmendBudgetRequestBody = z.infer<typeof amendBudgetRequestSchema>;

// ---------------------------------------------------------------------------
// Policy renewal
// ---------------------------------------------------------------------------

/**
 * Schema for POST /api/resolution-agents/[agentId]/renew request body.
 *
 * `expiresAt` is the new policy expiry as an epoch-ms string. It must be
 * strictly after the agent's CURRENT expiry (renewal only extends) and
 * must be in the future relative to the server clock at renewal time.
 */
export const renewPolicyRequestSchema = z.object({
  expiresAt: z.string().refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n, {
    message: "expiresAt must be a positive epoch-ms integer string",
  }),
}).strict();

export type RenewPolicyRequestBody = z.infer<typeof renewPolicyRequestSchema>;

// ---------------------------------------------------------------------------
// Wallet auth headers
// ---------------------------------------------------------------------------

/**
 * Schema for the three custom HTTP headers used to authenticate wallet
 * ownership.  These are set by the client after signing the authentication
 * message with their wallet.
 *
 * Header names:
 *   x-wallet-address   — 0x-prefixed EVM address
 *   x-wallet-message   — the plaintext message that was signed
 *   x-wallet-signature — 0x-prefixed ECDSA signature hex
 */
export const walletAuthHeadersSchema = z.object({
  walletAddress: z.string().regex(
    /^0x[0-9a-fA-F]{40}$/,
    "Must be a valid 0x-prefixed EVM address",
  ),
  signedMessage: z
    .string()
    .min(1, "Signed message must not be empty"),
  walletSignature: z
    .string()
    .min(1, "Wallet signature must not be empty")
    .regex(
      /^0x[a-fA-F0-9]+$/,
      "Wallet signature must be a 0x-prefixed hex string",
    ),
});

export type WalletAuthHeaders = z.infer<typeof walletAuthHeadersSchema>;
