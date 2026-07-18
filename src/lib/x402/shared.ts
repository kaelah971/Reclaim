// ---------------------------------------------------------------------------
// x402 shared utilities — re-exports from @x402/core + custom validators
//
// HTTP header encoding/decoding functions are re-exported from @x402/core/http.
// Our custom verifyPaymentPayload function validates the payment against our
// server configuration (scheme, network, token, recipient, amount).
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
  X402_NETWORK,
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
// Payment requirement header helpers (custom — builds our legacy format)
// ---------------------------------------------------------------------------

/**
 * Build the legacy PaymentRequirements object that the server advertises
 * in the PAYMENT-REQUIRED header (402 response).
 */
export function buildPaymentRequirements(): PaymentRequirementsLegacy {
  validatePayToAddress();
  const config = getX402ServerConfig();
  return {
    accepts: [
      {
        scheme: SUPPORTED_SCHEME,
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
  // Check scheme
  if (payload.scheme !== SUPPORTED_SCHEME) {
    return {
      valid: false,
      reason: `Unsupported payment scheme: ${payload.scheme}. Expected: ${SUPPORTED_SCHEME}`,
    };
  }

  // Check network
  if (payload.network !== X402_NETWORK) {
    return {
      valid: false,
      reason: `Unsupported network: ${payload.network}. Expected: ${X402_NETWORK}`,
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

  // Validate token matches our USDC address
  const config = getX402ServerConfig();
  if (payment.token.toLowerCase() !== config.usdcAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Payment token ${payment.token} does not match expected ${config.usdcAddress}.`,
    };
  }

  // Validate recipient matches our pay-to address
  if (payment.to.toLowerCase() !== config.payToAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Payment recipient ${payment.to} does not match service wallet ${config.payToAddress}.`,
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
  validatePayToAddress();
  const config = getX402ServerConfig();
  return {
    scheme: SUPPORTED_SCHEME,
    price: `$${config.disputeBriefPrice}`,
    network: config.network,
    payTo: config.payToAddress,
    asset: config.usdcAddress,
    assetDecimals: config.usdcDecimals,
  };
}
