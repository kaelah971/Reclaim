// ---------------------------------------------------------------------------
// x402 shared utilities — re-exports from @x402/core + custom validators
//
// HTTP header encoding/decoding functions are re-exported from @x402/core/http.
// Our custom verifyPaymentPayload function validates the payment against our
// server configuration (scheme, network, token, recipient, amount).
//
// Settlement-mode awareness: when X402_SETTLEMENT_MODE=celo-facilitator,
// the functions in this module advertise and validate against Celo mainnet
// (eip155:42220) instead of the default Sepolia (eip155:11142220).
// ---------------------------------------------------------------------------

// ---- Re-export official x402 header helpers ----
export {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";

// ---- Custom local helpers ----

import {
  getX402ServerConfig,
  X402_SETTLEMENT_MODE,
  X402_FACILITATOR_NETWORK,
  X402_FACILITATOR_USDC_MAINNET,
  X402_PAY_TO_ADDRESS_FACILITATOR,
  X402_NETWORK,
  X402_USDC_ADDRESS,
  X402_PAY_TO_ADDRESS,
  getDisputeBriefPriceAtomic,
  validatePayToAddress,
} from "./config";
import type {
  PaymentRequirementsLegacy,
  PaymentPayloadCustom,
  PaymentRequirement,
} from "./types";

// ---------------------------------------------------------------------------
// Supported schemas
// ---------------------------------------------------------------------------

/** Supported payment scheme identifier. */
export const SUPPORTED_SCHEME = "exact" as const;

// ---------------------------------------------------------------------------
// Settlement-mode-aware helpers
// ---------------------------------------------------------------------------

/**
 * Returns the active settlement mode's CAIP-2 network identifier.
 * - celo-facilitator → "eip155:42220" (Celo mainnet)
 * - local (default)  → "eip155:11142220" (Celo Sepolia)
 */
export function getActivePaymentNetwork(): string {
  if (X402_SETTLEMENT_MODE === "celo-facilitator") {
    return X402_FACILITATOR_NETWORK;
  }
  return X402_NETWORK;
}

/**
 * Returns the active settlement mode's payTo (revenue wallet) address.
 * - celo-facilitator → the registered Track 2 wallet
 * - local (default)  → X402_PAY_TO_ADDRESS (server env)
 */
export function getActivePaymentPayTo(): string {
  if (X402_SETTLEMENT_MODE === "celo-facilitator") {
    return X402_PAY_TO_ADDRESS_FACILITATOR;
  }
  validatePayToAddress();
  return X402_PAY_TO_ADDRESS;
}

/**
 * Returns a verification config object for the active settlement mode.
 * Contains { network, usdcAddress, payToAddress } — the values that
 * payment payloads will be validated against.
 */
export function getActiveVerificationConfig(): {
  network: string;
  usdcAddress: string;
  payToAddress: string;
} {
  if (X402_SETTLEMENT_MODE === "celo-facilitator") {
    return {
      network: X402_FACILITATOR_NETWORK,
      usdcAddress: X402_FACILITATOR_USDC_MAINNET,
      payToAddress: X402_PAY_TO_ADDRESS_FACILITATOR,
    };
  }
  // local mode — use the server's Sepolia configuration
  validatePayToAddress();
  const config = getX402ServerConfig();
  return {
    network: config.network,
    usdcAddress: config.usdcAddress,
    payToAddress: config.payToAddress,
  };
}

/**
 * Is the server running in Celo-facilitator (mainnet) settlement mode?
 */
export function isFacilitatorMode(): boolean {
  return X402_SETTLEMENT_MODE === "celo-facilitator";
}

/**
 * Returns the facilitator's Track 2 wallet address (payTo).
 * Only meaningful when `isFacilitatorMode()` is true.
 */
export function getFacilitatorPayTo(): string {
  return X402_PAY_TO_ADDRESS_FACILITATOR;
}

// ---------------------------------------------------------------------------
// Payment requirement header helpers (custom — builds our legacy format)
// ---------------------------------------------------------------------------

/**
 * Build the legacy PaymentRequirements object that the server advertises
 * in the PAYMENT-REQUIRED header (402 response).
 */
export function buildPaymentRequirements(): PaymentRequirementsLegacy {
  // Use the active settlement mode's network, asset, and payTo.
  // In celo-facilitator mode this advertises Celo mainnet; in local mode
  // it advertises Celo Sepolia.
  const active = getActiveVerificationConfig();
  const price = X402_SETTLEMENT_MODE === "celo-facilitator"
    ? (process.env.X402_DISPUTE_BRIEF_PRICE || "0.01")
    : getX402ServerConfig().disputeBriefPrice;

  // Asset decimals: USDC always has 6 decimals on both networks.
  const assetDecimals = 6;

  return {
    accepts: [
      {
        scheme: SUPPORTED_SCHEME,
        price: `$${price}`,
        network: active.network,
        payTo: active.payToAddress,
        asset: active.usdcAddress,
        assetDecimals,
        // EIP-3009 requires the token's EIP-712 domain in extra
        ...(X402_SETTLEMENT_MODE === "celo-facilitator"
          ? { extra: { name: "USDC", version: "2" } }
          : {}),
      },
    ],
    description: "Reclaim dispute preparation brief",
    mimeType: "application/json",
  };
}

/**
 * Build the full PAYMENT-REQUIRED header value (requirements + base64).
 * Convenience wrapper using local base64 encoding (avoids @x402/core type mismatch).
 */
export function buildPaymentRequiredHeader(): string {
  return Buffer.from(JSON.stringify(buildPaymentRequirements())).toString("base64");
}

// ---------------------------------------------------------------------------
// Payment signature header helpers
// ---------------------------------------------------------------------------

/**
 * Encode a PaymentPayloadCustom object into a base64 string suitable for
 * the PAYMENT-SIGNATURE HTTP header.
 */
export function encodePaymentSignatureCustomHeader(
  payload: PaymentPayloadCustom,
): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Decode a PAYMENT-SIGNATURE header value into our custom PaymentPayloadCustom.
 * Throws on malformed input (not valid JSON or not valid base64).
 */
export function decodePaymentSignatureCustomHeader(
  header: string,
): PaymentPayloadCustom {
  const decoded = Buffer.from(header, "base64").toString("utf-8");
  const parsed = JSON.parse(decoded) as PaymentPayloadCustom;
  return parsed;
}

// ---------------------------------------------------------------------------
// Payment payload verification (custom — validates against our server config)
// ---------------------------------------------------------------------------

/** Regex for validating EVM hex addresses. */
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Verify a payment payload from the client against our server configuration.
 *
 * Checks scheme, network, required fields, address formats, token match,
 * recipient match, and minimum amount.
 */
export function verifyPaymentPayload(
  payload: PaymentPayloadCustom,
): { valid: boolean; reason?: string } {
  // Use the active settlement mode's expected network, USDC address, and payTo.
  // In celo-facilitator mode: validates against Celo mainnet values.
  // In local mode: validates against Celo Sepolia values (unchanged behavior).
  const verifyConfig = getActiveVerificationConfig();

  // Check scheme
  if (payload.scheme !== SUPPORTED_SCHEME) {
    return {
      valid: false,
      reason: `Unsupported payment scheme: ${payload.scheme}. Expected: ${SUPPORTED_SCHEME}`,
    };
  }

  // Check network against the active mode's expected network
  if (payload.network !== verifyConfig.network) {
    return {
      valid: false,
      reason: `Unsupported network: ${payload.network}. Expected: ${verifyConfig.network}`,
    };
  }

  // Check payment details exist
  if (!payload.payment) {
    return { valid: false, reason: "Missing payment details in payload." };
  }

  const payment = payload.payment;

  // Validate required fields
  if (!payment.from || !payment.to || !payment.token || !payment.signature) {
    return {
      valid: false,
      reason:
        "Payment details missing required fields (from, to, token, signature).",
    };
  }

  // Validate address formats
  if (!ADDR_RE.test(payment.from) || !ADDR_RE.test(payment.to)) {
    return {
      valid: false,
      reason: "Invalid address format in payment details.",
    };
  }

  // Validate token matches the active mode's USDC address
  if (payment.token.toLowerCase() !== verifyConfig.usdcAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Payment token ${payment.token} does not match expected ${verifyConfig.usdcAddress}.`,
    };
  }

  // Validate recipient matches the active mode's pay-to address
  if (payment.to.toLowerCase() !== verifyConfig.payToAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Payment recipient ${payment.to} does not match service wallet ${verifyConfig.payToAddress}.`,
    };
  }

  // Validate amount is at least the dispute brief price
  const expectedAmount = getDisputeBriefPriceAtomic();
  try {
    const providedAmount = BigInt(payment.amount);
    if (providedAmount < expectedAmount) {
      return {
        valid: false,
        reason: `Payment amount ${payment.amount} is less than required ${expectedAmount.toString()}.`,
      };
    }
  } catch {
    return { valid: false, reason: "Invalid payment amount format." };
  }

  // Validate signature is present (non-empty, non-placeholder)
  if (!payment.signature || payment.signature === "0x") {
    return {
      valid: false,
      reason: "Payment signature is missing or is a placeholder.",
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Helper: get a single PaymentRequirement for facilitator.verify() calls
// ---------------------------------------------------------------------------

export function getVerificationRequirement(): PaymentRequirement {
  const active = getActiveVerificationConfig();
  const price = X402_SETTLEMENT_MODE === "celo-facilitator"
    ? (process.env.X402_DISPUTE_BRIEF_PRICE || "0.01")
    : getX402ServerConfig().disputeBriefPrice;

  return {
    scheme: SUPPORTED_SCHEME,
    price: `$${price}`,
    network: active.network,
    payTo: active.payToAddress,
    asset: active.usdcAddress,
    assetDecimals: 6, // USDC always 6 decimals
    ...(X402_SETTLEMENT_MODE === "celo-facilitator"
      ? { extra: { name: "USDC", version: "2" } }
      : {}),
  };
}
