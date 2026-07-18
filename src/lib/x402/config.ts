// ---------------------------------------------------------------------------
// x402 server-side configuration
//
// SERVER-ONLY — never import this from client components. Use config.public.ts
// for browser-safe values instead.
//
// Uses @x402/core's HTTPFacilitatorClient for cryptographic payment
// verification against the Celo x402 facilitator API.
// ---------------------------------------------------------------------------

import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  PAYMENT_TOKEN_ADDRESS,
  PAYMENT_TOKEN_DECIMALS,
} from "@/lib/web3/tokens";
import { getEscrowContractAddress } from "@/lib/contracts/config";
import type {
  X402Config,
  PaymentRequirement,
  PaymentRequirementsLegacy,
  PaymentIdentifier,
} from "./types";

// ---------------------------------------------------------------------------
// Facilitator client (for cryptographic verification via Celo API)
// ---------------------------------------------------------------------------

export const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.x402.celo.org",
});

// ---------------------------------------------------------------------------
// Environment variables (server-only)
// ---------------------------------------------------------------------------

/** Celo x402 facilitator URL (buyer-side paywall UI). */
export const X402_FACILITATOR_URL =
  process.env.NEXT_PUBLIC_X402_FACILITATOR_URL || "https://x402.celo.org";

/** CAIP-2 network identifier for Celo Sepolia. */
export const X402_NETWORK = "eip155:11142220" as const;

/** USDC token address on the active chain (from shared token config). */
export const X402_USDC_ADDRESS: string =
  process.env.X402_USDC_ADDRESS || PAYMENT_TOKEN_ADDRESS;

/** USDC token decimals. */
export const X402_USDC_DECIMALS: number =
  Number.isFinite(Number(process.env.X402_USDC_DECIMALS))
    ? Number(process.env.X402_USDC_DECIMALS)
    : PAYMENT_TOKEN_DECIMALS;

/**
 * Reclaim service-revenue wallet that receives x402 fees.
 *
 * This address MUST NOT be the escrow contract address. It is the wallet
 * that collects micro-fees for paid services like dispute brief preparation.
 * Set via X402_PAY_TO_ADDRESS (server) or NEXT_PUBLIC_X402_PAY_TO_ADDRESS (fallback).
 */
export const X402_PAY_TO_ADDRESS: string =
  process.env.X402_PAY_TO_ADDRESS ||
  process.env.NEXT_PUBLIC_X402_PAY_TO_ADDRESS ||
  "";

/**
 * Relayer private key for submitting Permit2 settlement transactions on-chain.
 *
 * This is a dedicated gas wallet — it pays Celo gas fees to execute the
 * Permit2 transfer. It does NOT hold user funds and is NOT the deployer key.
 *
 * If unset, server-side settlement is disabled and the server will return
 * an error when settlement is attempted. Set this to enable real on-chain
 * settlement via Permit2.
 */
export const X402_RELAYER_PRIVATE_KEY: string =
  process.env.X402_RELAYER_PRIVATE_KEY || "";

/**
 * Price of the dispute brief service in human-readable USDC.
 * This is a configurable small amount — default "0.01" USDC.
 */
export const X402_DISPUTE_BRIEF_PRICE: string =
  process.env.X402_DISPUTE_BRIEF_PRICE ||
  process.env.NEXT_PUBLIC_X402_DISPUTE_BRIEF_PRICE ||
  "0.01";

/**
 * Price of the dispute brief service in atomic USDC units.
 * USDC on Celo uses 6 decimals, so "0.01" = 10_000 atomic units.
 */
export function getDisputeBriefPriceAtomic(): bigint {
  const price = process.env.X402_DISPUTE_BRIEF_PRICE_ATOMIC;
  if (price) {
    const parsed = BigInt(price);
    if (parsed > BigInt(0)) return parsed;
  }
  // Compute from human-readable string
  const human = X402_DISPUTE_BRIEF_PRICE;
  const parts = human.split(".");
  const whole = BigInt(parts[0] ?? "0");
  const fraction = (parts[1] ?? "")
    .slice(0, X402_USDC_DECIMALS)
    .padEnd(X402_USDC_DECIMALS, "0");
  return whole * (BigInt(10) ** BigInt(X402_USDC_DECIMALS)) + BigInt(fraction);
}

/**
 * Convert a human-readable USDC string to atomic units (bigint).
 * e.g. "0.01" with 6 decimals → 10000n
 */
export function toAtomicUnits(
  humanAmount: string,
  decimals: number = X402_USDC_DECIMALS,
): bigint {
  const parts = humanAmount.split(".");
  const whole = BigInt(parts[0] ?? "0");
  const fraction = (parts[1] ?? "")
    .slice(0, decimals)
    .padEnd(decimals, "0");
  return whole * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction);
}

/**
 * Convert atomic units to a human-readable string with the given decimals.
 * e.g. 10000n with 6 decimals → "0.01"
 */
export function fromAtomicUnits(
  atomicAmount: bigint,
  decimals: number = X402_USDC_DECIMALS,
): string {
  const factor = BigInt(10) ** BigInt(decimals);
  const whole = atomicAmount / factor;
  const fraction = atomicAmount % factor;
  const padded = fraction.toString().padStart(decimals, "0");
  // Trim trailing zeros, keep at least one decimal place when there are decimals
  const trimmed = padded.replace(/0+$/, "");
  if (trimmed.length === 0) return whole.toString();
  return `${whole}.${trimmed}`;
}

/** Networks we accept payments on. */
export const X402_SUPPORTED_NETWORKS: readonly string[] = [
  "eip155:11142220", // Celo Sepolia
];

// ---------------------------------------------------------------------------
// Payment identifier generator
// ---------------------------------------------------------------------------

/**
 * Generate a unique payment identifier for idempotency tracking.
 * Uses crypto.randomUUID() with a "pay_" prefix.
 */
export function generatePaymentId(): PaymentIdentifier {
  return `pay_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

/**
 * Validates that the payTo address is configured and is NOT the escrow
 * contract. Throws with a descriptive message on misconfiguration.
 */
export function validatePayToAddress(): void {
  if (!X402_PAY_TO_ADDRESS) {
    throw new Error(
      "X402_PAY_TO_ADDRESS is not configured. Cannot process payments. " +
        "Set X402_PAY_TO_ADDRESS (server) or NEXT_PUBLIC_X402_PAY_TO_ADDRESS (client).",
    );
  }

  // Must be a valid hex address
  if (!/^0x[0-9a-fA-F]{40}$/.test(X402_PAY_TO_ADDRESS)) {
    throw new Error(
      `X402_PAY_TO_ADDRESS is not a valid hex address: ${X402_PAY_TO_ADDRESS}`,
    );
  }

  // Must NOT be the escrow contract
  const escrow = getEscrowContractAddress();
  if (X402_PAY_TO_ADDRESS.toLowerCase() === escrow.toLowerCase()) {
    throw new Error(
      "X402_PAY_TO_ADDRESS must NOT be the escrow contract address. " +
        "The payTo address receives x402 service fees; the escrow holds protected funds. " +
        `Both are: ${escrow}`,
    );
  }
}

/**
 * Validates that the settlement relayer key is configured.
 * Returns the private key as `0x${string}` or throws.
 */
export function requireRelayerPrivateKey(): `0x${string}` {
  const key = X402_RELAYER_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "X402_RELAYER_PRIVATE_KEY is not configured. " +
        "Server-side settlement requires a relayer wallet for gas. " +
        "Set X402_RELAYER_PRIVATE_KEY to a dedicated gas wallet private key.",
    );
  }
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      "X402_RELAYER_PRIVATE_KEY is not a valid 32-byte hex private key.",
    );
  }
  return normalized as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Derived configuration object
// ---------------------------------------------------------------------------

/**
 * Returns the full x402 configuration for the server.
 * Throws if pay-to address is not configured — the server cannot process
 * payments without a recipient wallet.
 */
export function getX402ServerConfig(): X402Config {
  return {
    facilitatorUrl: X402_FACILITATOR_URL,
    network: X402_NETWORK,
    usdcAddress: X402_USDC_ADDRESS,
    usdcDecimals: X402_USDC_DECIMALS,
    payToAddress: X402_PAY_TO_ADDRESS,
    disputeBriefPrice: X402_DISPUTE_BRIEF_PRICE,
    disputeBriefPriceAtomic: getDisputeBriefPriceAtomic(),
    supportedNetworks: [...X402_SUPPORTED_NETWORKS],
  };
}

/**
 * Check whether the server has the minimum configuration required
 * to process x402 payments (i.e. a pay-to address is set).
 */
export function canProcessPayments(): boolean {
  try {
    validatePayToAddress();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the server can execute on-chain settlement
 * (i.e. a relayer private key is configured).
 */
export function canSettleOnChain(): boolean {
  return X402_RELAYER_PRIVATE_KEY.length > 0;
}

// ---------------------------------------------------------------------------
// Adapter: convert legacy PaymentRequirements to @x402/core PaymentRequirement
// ---------------------------------------------------------------------------

/**
 * Build the legacy PaymentRequirements object that the server advertises
 * in the PAYMENT-REQUIRED header (402 response).
 *
 * Also available as a single PaymentRequirement for compatibility with
 * @x402/core's verify() which expects a single entry.
 */
export function buildLegacyPaymentRequirements(): PaymentRequirementsLegacy {
  validatePayToAddress();
  const config = getX402ServerConfig();

  return {
    accepts: [
      {
        scheme: "exact",
        price: `$${config.disputeBriefPrice}`,
        network: config.network,
        payTo: config.payToAddress,
        asset: config.usdcAddress,
        assetDecimals: config.usdcDecimals,
      },
    ],
    description: "Reclaim dispute preparation brief",
    mimeType: "application/json",
  };
}

/**
 * Returns the single PaymentRequirement (from @x402/core compatible shape)
 * for use with facilitator.verify().
 */
export function getPaymentRequirement(): PaymentRequirement {
  validatePayToAddress();
  const config = getX402ServerConfig();
  return {
    scheme: "exact",
    price: `$${config.disputeBriefPrice}`,
    network: config.network,
    payTo: config.payToAddress,
    asset: config.usdcAddress,
    assetDecimals: config.usdcDecimals,
  };
}
