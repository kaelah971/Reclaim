// ---------------------------------------------------------------------------
// x402 public configuration — SAFE FOR BROWSER USE
//
// This module only exposes NEXT_PUBLIC_ environment variables. It can be
// imported from "use client" components. Never import config.ts from a
// client component — it may leak server secrets.
// ---------------------------------------------------------------------------

/** Celo x402 facilitator URL for buyer-side paywall UI. */
export const X402_FACILITATOR_URL =
  process.env.NEXT_PUBLIC_X402_FACILITATOR_URL || "https://x402.celo.org";

/** CAIP-2 network identifier for Celo Sepolia. */
export const X402_NETWORK = "eip155:11142220" as const;

/**
 * Reclaim service-revenue wallet that receives x402 fees.
 * Exposed as NEXT_PUBLIC_ so the pay button can display it.
 */
export const X402_PAY_TO_ADDRESS =
  process.env.NEXT_PUBLIC_X402_PAY_TO_ADDRESS || "";

/**
 * Permit2 spender the buyer authorizes — the server relayer's PUBLIC address.
 * Permit2 binds spender = msg.sender of permitTransferFrom, and the relayer
 * submits that transaction. This is a public address, never a private key.
 * Falls back to the payTo address for self-settling setups.
 */
export const X402_SPENDER_ADDRESS =
  process.env.NEXT_PUBLIC_X402_SPENDER_ADDRESS ||
  process.env.NEXT_PUBLIC_X402_PAY_TO_ADDRESS ||
  "";

/**
 * Price of the dispute brief service in human-readable USDC.
 * Exposed so the pay button can display it before the user pays.
 */
export const X402_DISPUTE_BRIEF_PRICE =
  process.env.NEXT_PUBLIC_X402_DISPUTE_BRIEF_PRICE || "0.01";

/**
 * Price of the evidence quality check service in human-readable USDC.
 * Exposed so the pay button can display it before the user pays.
 */
export const X402_EVIDENCE_CHECK_PRICE =
  process.env.NEXT_PUBLIC_X402_EVIDENCE_CHECK_PRICE || "0.01";

// ---------------------------------------------------------------------------
// Facilitator (Track 2) mainnet configuration
// ---------------------------------------------------------------------------

/** Settlement mode — local (Sepolia) or celo-facilitator (mainnet). */
export const X402_SETTLEMENT_MODE =
  process.env.NEXT_PUBLIC_X402_SETTLEMENT_MODE || "local";

/** CAIP-2 network identifier for Celo Mainnet (used by the official facilitator). */
export const X402_FACILITATOR_NETWORK = "eip155:42220" as const;

/** Celo mainnet chain ID. */
export const CELO_MAINNET_CHAIN_ID = 42220;

/** USDC token address on Celo mainnet. */
export const X402_FACILITATOR_USDC_MAINNET =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

/** Track 2 registered payTo wallet. */
export const X402_PAY_TO_ADDRESS_FACILITATOR =
  process.env.NEXT_PUBLIC_X402_PAY_TO_ADDRESS_FACILITATOR ||
  "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

/** Is the app in facilitator (Track 2) mode? */
export const isFacilitatorMode = () =>
  X402_SETTLEMENT_MODE === "celo-facilitator";
