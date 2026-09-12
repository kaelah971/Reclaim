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
  X402_PAY_TO_ADDRESS,
  getDisputeBriefPriceAtomic,
  getEvidenceCheckPriceAtomic,
  getCaseRefreshPriceAtomic,
  validatePayToAddress,
  fromAtomicUnits,
  type X402ServiceIdentifier,
  type X402ServicePaymentTerms,
} from "./config";
import type {
  PaymentRequirementsLegacy,
  PaymentPayloadCustom,
  PaymentRequirement,
} from "./types";
import type { PaymentPayload as CorePaymentPayload, PaymentRequirements as CorePaymentRequirements } from "@x402/core/types";

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
  const terms = getActiveServicePaymentTerms("reclaim-dispute-brief-v1");
  const price = fromAtomicUnits(BigInt(terms.amountAtomic), terms.tokenDecimals);

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
        amount: terms.amountAtomic,
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
// Evidence-check-specific payment requirements
// ---------------------------------------------------------------------------

/**
 * Build the legacy PaymentRequirements object for the evidence quality check
 * service. Uses the same settlement-mode-aware configuration as dispute-brief
 * but advertises a different description and uses the evidence-check price.
 */
export function buildEvidenceCheckPaymentRequirements(): PaymentRequirementsLegacy {
  const active = getActiveVerificationConfig();
  const terms = getActiveServicePaymentTerms("evidence-quality-check");
  const price = fromAtomicUnits(BigInt(terms.amountAtomic), terms.tokenDecimals);

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
        amount: terms.amountAtomic,
        ...(X402_SETTLEMENT_MODE === "celo-facilitator"
          ? { extra: { name: "USDC", version: "2" } }
          : {}),
      },
    ],
    description: "Reclaim evidence quality check",
    mimeType: "application/json",
  };
}

/**
 * Build the full PAYMENT-REQUIRED header value for evidence quality check.
 */
export function buildEvidenceCheckHeader(): string {
  return Buffer.from(JSON.stringify(buildEvidenceCheckPaymentRequirements())).toString("base64");
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

/** Mode-aware terms helper used by the request validator and header builder. */
export function getActiveServicePaymentTerms(
  service: X402ServiceIdentifier,
): X402ServicePaymentTerms {
  // Keep one server-owned source of truth for all service prices and active
  // network/token/recipient values.  Routes must never derive a requirement
  // from a client-supplied amount.  This helper intentionally resolves the
  // active mode locally so tests and long-lived workers can switch mode
  // without retaining a stale imported constant.
  const active = getActiveVerificationConfig();
  const amount = (() => {
    switch (service) {
      case "reclaim-dispute-brief-v1":
        return getDisputeBriefPriceAtomic();
      case "evidence-quality-check":
        return getEvidenceCheckPriceAtomic();
      case "case-refresh":
        return getCaseRefreshPriceAtomic();
    }
  })();
  return {
    service,
    network: active.network,
    chainId: active.network === X402_FACILITATOR_NETWORK ? 42220 : 11142220,
    tokenAddress: active.usdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    payToAddress: active.payToAddress,
    amountAtomic: amount.toString(),
    amountDisplay: fromAtomicUnits(amount, 6),
  };
}

/**
 * Resolve only the active server-owned terms. Callers may pass the service
 * snapshot they built for a route, but that snapshot is still untrusted at
 * this boundary and must equal the current server configuration exactly.
 */
export function resolveServerPaymentTerms(
  supplied?: X402ServicePaymentTerms,
): { valid: true; terms: X402ServicePaymentTerms } | { valid: false; reason: string } {
  if (
    supplied &&
    supplied.service !== "reclaim-dispute-brief-v1" &&
    supplied.service !== "evidence-quality-check" &&
    supplied.service !== "case-refresh"
  ) {
    return { valid: false, reason: "Payment terms contain an unsupported service identifier." };
  }
  const expected = getActiveServicePaymentTerms(
    supplied?.service ?? "reclaim-dispute-brief-v1",
  );
  if (!supplied) return { valid: true, terms: expected };

  const addressFields: Array<keyof X402ServicePaymentTerms> = [
    "tokenAddress",
    "payToAddress",
  ];
  const exactFields: Array<keyof X402ServicePaymentTerms> = [
    "service",
    "network",
    "chainId",
    "tokenSymbol",
    "tokenDecimals",
    "amountAtomic",
    "amountDisplay",
  ];

  for (const field of exactFields) {
    if (supplied[field] !== expected[field]) {
      return { valid: false, reason: "Payment terms are not the active server-configured terms." };
    }
  }
  for (const field of addressFields) {
    const suppliedValue = supplied[field];
    const expectedValue = expected[field];
    if (
      typeof suppliedValue !== "string" ||
      typeof expectedValue !== "string" ||
      suppliedValue.toLowerCase() !== expectedValue.toLowerCase()
    ) {
      return { valid: false, reason: "Payment terms are not the active server-configured terms." };
    }
  }

  return { valid: true, terms: expected };
}

/** Build the PAYMENT-REQUIRED payload for the case-refresh service. */
export function buildCaseRefreshPaymentRequirements(): PaymentRequirementsLegacy {
  const active = getActiveVerificationConfig();
  const terms = getActiveServicePaymentTerms("case-refresh");

  return {
    accepts: [
      {
        scheme: SUPPORTED_SCHEME,
        price: `$${terms.amountDisplay}`,
        network: active.network,
        payTo: active.payToAddress,
        asset: active.usdcAddress,
        assetDecimals: terms.tokenDecimals,
        amount: terms.amountAtomic,
        ...(X402_SETTLEMENT_MODE === "celo-facilitator"
          ? { extra: { name: "USDC", version: "2" } }
          : {}),
      },
    ],
    description: "Reclaim case refresh",
    mimeType: "application/json",
  };
}

/** Build the full PAYMENT-REQUIRED header for case refresh. */
export function buildCaseRefreshHeader(): string {
  return Buffer.from(JSON.stringify(buildCaseRefreshPaymentRequirements())).toString("base64");
}

function expectedPaymentFields(
  expected: X402ServicePaymentTerms | PaymentRequirement,
): { network: string; asset: string; payTo: string; amount: string; decimals: number } {
  if ("tokenAddress" in expected) {
    return {
      network: expected.network,
      asset: expected.tokenAddress,
      payTo: expected.payToAddress,
      amount: expected.amountAtomic,
      decimals: expected.tokenDecimals,
    };
  }
  if (!expected.amount) {
    throw new Error("Payment requirement is missing its exact atomic amount.");
  }
  return {
    network: expected.network,
    asset: expected.asset,
    payTo: expected.payTo,
    amount: expected.amount,
    decimals: expected.assetDecimals,
  };
}

/** Extract the payer from either Permit2 or EIP-3009 custom wire payloads. */
export function getPaymentPayloadPayer(payload: PaymentPayloadCustom): string | undefined {
  const payment = payload.payment as unknown as Record<string, unknown> | undefined;
  if (!payment || typeof payment !== "object") return undefined;
  const authorization = payment.authorization;
  if (authorization && typeof authorization === "object") {
    const from = (authorization as Record<string, unknown>).from;
    return typeof from === "string" ? from : undefined;
  }
  return typeof payment.from === "string" ? payment.from : undefined;
}

/**
 * Validate a custom wire payload against server-owned terms. This is a pure
 * check and must run immediately before every facilitator/local provider call.
 */
export function verifyPaymentPayload(
  payload: PaymentPayloadCustom,
  expected?: X402ServicePaymentTerms | PaymentRequirement,
): { valid: boolean; reason?: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, reason: "Payment payload is missing." };
  }
  let fields: ReturnType<typeof expectedPaymentFields>;
  try {
    fields = expectedPaymentFields(
      expected ?? getActiveServicePaymentTerms("reclaim-dispute-brief-v1"),
    );
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "Payment terms are invalid." };
  }

  if (
    typeof fields.network !== "string" ||
    !/^eip155:[0-9]+$/.test(fields.network) ||
    typeof fields.asset !== "string" ||
    !ADDR_RE.test(fields.asset) ||
    typeof fields.payTo !== "string" ||
    !ADDR_RE.test(fields.payTo) ||
    !/^[0-9]+$/.test(fields.amount) ||
    BigInt(fields.amount) <= 0n
  ) {
    return { valid: false, reason: "Server payment terms are invalid." };
  }
  if (payload.scheme !== SUPPORTED_SCHEME) {
    return { valid: false, reason: `Unsupported payment scheme: ${payload.scheme}. Expected: ${SUPPORTED_SCHEME}` };
  }
  if (payload.network !== fields.network) {
    return { valid: false, reason: `Unsupported network: ${payload.network}. Expected: ${fields.network}` };
  }
  if (!payload.payment || typeof payload.payment !== "object") {
    return { valid: false, reason: "Missing payment details in payload." };
  }

  const payment = payload.payment as unknown as Record<string, unknown>;
  const authorization = payment.authorization;
  const isEip3009 = authorization !== undefined;
  if (isEip3009 && (!authorization || typeof authorization !== "object" || Array.isArray(authorization))) {
    return { valid: false, reason: "Invalid EIP-3009 authorization payload." };
  }
  const from = isEip3009 ? (authorization as Record<string, unknown>).from : payment.from;
  const to = isEip3009 ? (authorization as Record<string, unknown>).to : payment.to;
  const amount = isEip3009 ? (authorization as Record<string, unknown>).value : payment.amount;
  const signature = payment.signature;
  const suppliedToken = typeof payment.token === "string"
    ? payment.token
    : typeof payment.asset === "string" ? payment.asset : undefined;

  // Local settlement is Permit2-only. EIP-3009 is accepted only when the
  // explicitly selected provider is the mainnet facilitator.
  if (isEip3009 && X402_SETTLEMENT_MODE !== "celo-facilitator") {
    return { valid: false, reason: "Payment details missing required fields (from, to, token, signature)." };
  }

  if (
    typeof from !== "string" || !from ||
    typeof to !== "string" || !to ||
    typeof signature !== "string" || !signature ||
    (!isEip3009 && !suppliedToken)
  ) {
    return {
      valid: false,
      reason: isEip3009
        ? "Payment details missing required EIP-3009 fields (authorization.from, authorization.to, authorization.value, signature)."
        : "Payment details missing required fields (from, to, token, signature).",
    };
  }
  if (!ADDR_RE.test(from) || !ADDR_RE.test(to)) {
    return { valid: false, reason: "Invalid address format in payment details." };
  }
  if (to.toLowerCase() !== fields.payTo.toLowerCase()) {
    return { valid: false, reason: `Payment recipient ${to} does not match service wallet ${fields.payTo}.` };
  }

  // EIP-3009 binds the token through the server-supplied requirement. If a
  // custom token field is present, it must agree as well; it can never select
  // a different asset. Permit2 carries the token directly in the payload.
  if (!isEip3009 && (!suppliedToken || suppliedToken.toLowerCase() !== fields.asset.toLowerCase())) {
    return { valid: false, reason: `Payment token ${String(suppliedToken)} does not match expected ${fields.asset}.` };
  }
  if (suppliedToken && suppliedToken.toLowerCase() !== fields.asset.toLowerCase()) {
    return { valid: false, reason: `Payment token ${suppliedToken} does not match expected ${fields.asset}.` };
  }

  let providedAmount: bigint;
  try {
    if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) throw new Error();
    providedAmount = BigInt(amount);
  } catch {
    return { valid: false, reason: "Invalid payment amount format." };
  }
  if (providedAmount !== BigInt(fields.amount)) {
    const comparison = providedAmount < BigInt(fields.amount) ? " (less than required)" : "";
    return {
      valid: false,
      reason: `Payment amount ${providedAmount} does not match exact amount ${fields.amount}${comparison}.`,
    };
  }
  if (signature === "0x") {
    return { valid: false, reason: "Payment signature is missing or is a placeholder." };
  }
  if (isEip3009) {
    const auth = authorization as Record<string, unknown>;
    if (
      typeof auth.validAfter !== "string" || !/^[0-9]+$/.test(auth.validAfter) ||
      typeof auth.validBefore !== "string" || !/^[0-9]+$/.test(auth.validBefore) ||
      typeof auth.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)
    ) {
      return { valid: false, reason: "Payment details missing required EIP-3009 authorization fields." };
    }
  }
  return { valid: true };
}

/** Validate the @x402/core envelope before invoking a provider. */
export function validateCorePaymentPayload(
  payload: CorePaymentPayload,
  requirement: CorePaymentRequirements,
  terms?: X402ServicePaymentTerms,
): { valid: boolean; reason?: string } {
  if (!payload || typeof payload !== "object" || !requirement || typeof requirement !== "object") {
    return { valid: false, reason: "Payment payload or requirement is missing." };
  }
  const resolvedTerms = resolveServerPaymentTerms(terms);
  if (!resolvedTerms.valid) return resolvedTerms;
  const configuredFields = expectedPaymentFields(resolvedTerms.terms);
  const requirementFields = {
    network: requirement.network,
    asset: requirement.asset,
    payTo: requirement.payTo,
    amount: requirement.amount,
  };
  if (
    !requirement.amount ||
    requirement.scheme !== SUPPORTED_SCHEME ||
    typeof requirementFields.network !== "string" ||
    requirementFields.network !== configuredFields.network ||
    typeof requirementFields.asset !== "string" ||
    requirementFields.asset.toLowerCase() !== configuredFields.asset.toLowerCase() ||
    typeof requirementFields.payTo !== "string" ||
    requirementFields.payTo.toLowerCase() !== configuredFields.payTo.toLowerCase() ||
    requirementFields.amount !== configuredFields.amount
  ) {
    return { valid: false, reason: "Payment requirement does not match the server-configured exact USDC terms." };
  }
  const accepted = payload.accepted;
  if (
    !accepted ||
    payload.x402Version !== 2 ||
    accepted.scheme !== requirement.scheme ||
    accepted.network !== requirement.network ||
    typeof accepted.asset !== "string" ||
    typeof requirement.asset !== "string" ||
    accepted.asset.toLowerCase() !== requirement.asset.toLowerCase() ||
    typeof accepted.payTo !== "string" ||
    typeof requirement.payTo !== "string" ||
    accepted.payTo.toLowerCase() !== requirement.payTo.toLowerCase() ||
    accepted.amount !== requirement.amount
  ) {
    return { valid: false, reason: "Payment payload accepted terms do not match the server requirement." };
  }

  const rawPayload = payload.payload;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return { valid: false, reason: "Payment scheme payload is missing or invalid." };
  }
  const raw = rawPayload as Record<string, unknown>;
  const authorizationValue = raw.authorization;
  if (
    authorizationValue !== undefined &&
    (!authorizationValue || typeof authorizationValue !== "object" || Array.isArray(authorizationValue))
  ) {
    return { valid: false, reason: "Invalid EIP-3009 authorization payload." };
  }
  const authorization = authorizationValue as Record<string, unknown> | undefined;
  const to = authorization?.to ?? raw?.to;
  const amount = authorization?.value ?? raw?.amount;
  const token = raw?.token ?? raw?.asset;
  const signature = raw?.signature;
  if (!authorization && typeof token !== "string") return { valid: false, reason: "Payment token is missing." };
  const from = authorization?.from ?? raw?.from;
  if (typeof from !== "string" || !ADDR_RE.test(from)) return { valid: false, reason: "Payment payer is missing or invalid." };
  if (typeof to !== "string" || to.toLowerCase() !== requirement.payTo.toLowerCase()) return { valid: false, reason: "Payment recipient does not match the server requirement." };
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) return { valid: false, reason: "Payment amount is missing or invalid." };
  try {
    if (BigInt(amount) !== BigInt(requirement.amount)) return { valid: false, reason: "Payment amount does not match the exact server amount." };
  } catch {
    return { valid: false, reason: "Payment amount has an invalid format." };
  }
  if (typeof token === "string" && token.toLowerCase() !== requirement.asset.toLowerCase()) return { valid: false, reason: "Payment token does not match the server requirement." };
  if (typeof signature !== "string" || !signature || signature === "0x") return { valid: false, reason: "Payment signature is missing or is a placeholder." };
  if (authorization && (
    typeof authorization.validAfter !== "string" || !/^[0-9]+$/.test(authorization.validAfter) ||
    typeof authorization.validBefore !== "string" || !/^[0-9]+$/.test(authorization.validBefore) ||
    typeof authorization.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)
  )) {
    return { valid: false, reason: "Payment details missing required EIP-3009 authorization fields." };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Helper: get a single PaymentRequirement for facilitator.verify() calls
// ---------------------------------------------------------------------------

export function getVerificationRequirement(
  service: X402ServiceIdentifier = "reclaim-dispute-brief-v1",
): PaymentRequirement {
  const terms = getActiveServicePaymentTerms(service);

  return {
    scheme: SUPPORTED_SCHEME,
    price: `$${terms.amountDisplay}`,
    network: terms.network,
    payTo: terms.payToAddress,
    asset: terms.tokenAddress,
    assetDecimals: terms.tokenDecimals,
    amount: terms.amountAtomic,
    ...(X402_SETTLEMENT_MODE === "celo-facilitator"
      ? { extra: { name: "USDC", version: "2" } }
      : {}),
  };
}
