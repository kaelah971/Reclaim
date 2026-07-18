import { hexToString, stringToHex } from "viem";
import { PAYMENT_TOKEN_DECIMALS } from "@/lib/web3/tokens";

// ---------------------------------------------------------------------------
// Payment state enum (matches the Solidity enum order exactly)
// ---------------------------------------------------------------------------
export type PaymentState =
  | "Created"
  | "Funded"
  | "Accepted"
  | "DeliverySubmitted"
  | "ReleaseRequested"
  | "Released"
  | "Disputed"
  | "Cancelled";

export const PAYMENT_STATE_MAP: Readonly<Record<number, PaymentState>> = {
  0: "Created",
  1: "Funded",
  2: "Accepted",
  3: "DeliverySubmitted",
  4: "ReleaseRequested",
  5: "Released",
  6: "Disputed",
  7: "Cancelled",
};

export function resolvePaymentState(raw: number): PaymentState {
  return PAYMENT_STATE_MAP[raw] ?? "Created";
}

/** Human-readable labels for each payment state. */
export const PAYMENT_STATE_LABELS: Readonly<Record<PaymentState, string>> = {
  Created: "Created",
  Funded: "Funded",
  Accepted: "Accepted",
  DeliverySubmitted: "Delivery Submitted",
  ReleaseRequested: "Release Requested",
  Released: "Released",
  Disputed: "Disputed",
  Cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// bytes32 helpers
//
// The contract stores compact agreement terms as bytes32. Short labels are
// UTF-8 encoded and right-padded; references (evidence / dispute / terms
// hashes) are opaque 32-byte values displayed as hex.
// ---------------------------------------------------------------------------

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const MAX_BYTES32_LABEL_BYTES = 32;

/** UTF-8 byte length of a string (bytes32 labels are limited to 32 bytes). */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Encode a short label into a bytes32 value.
 * Throws if the UTF-8 representation exceeds 32 bytes — callers must
 * validate with `utf8ByteLength` first and surface a friendly error.
 */
export function toBytes32Label(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (trimmed === "") return ZERO_BYTES32;
  if (utf8ByteLength(trimmed) > MAX_BYTES32_LABEL_BYTES) {
    throw new Error(
      `Label exceeds ${MAX_BYTES32_LABEL_BYTES} bytes when UTF-8 encoded.`,
    );
  }
  return stringToHex(trimmed, { size: 32 });
}

/**
 * Decode a bytes32 label back into a readable string.
 * Returns "" for the zero value. Falls back to the raw hex when the
 * content is not valid UTF-8 text (e.g. an opaque hash).
 */
export function fromBytes32Label(value: `0x${string}`): string {
  if (!value || value === ZERO_BYTES32) return "";
  const trimmedHex = value.replace(/(00)+$/, "");
  if (trimmedHex === "0x") return "";
  try {
    const decoded = hexToString(trimmedHex as `0x${string}`);
    // Reject control characters — treat as opaque bytes instead.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)) {
      return value;
    }
    return decoded;
  } catch {
    return value;
  }
}

/** True when a bytes32 reference is set (non-zero). */
export function isBytes32Set(value: `0x${string}`): boolean {
  return Boolean(value) && value !== ZERO_BYTES32;
}

// ---------------------------------------------------------------------------
// Payment data (mirrors the deployed Solidity struct)
// ---------------------------------------------------------------------------

export interface PaymentData {
  readonly id: bigint;
  readonly client: string;
  readonly worker: string;
  /** ERC-20 token the payment is denominated in (USDC on Celo Sepolia). */
  readonly token: string;
  readonly amount: bigint;
  /** Decoded human-readable agreement terms (stored on-chain as bytes32). */
  readonly agreementLabel: string;
  readonly deliverableSummary: string;
  readonly deliveryFormat: string;
  readonly releaseRule: string;
  readonly evidenceExpectation: string;
  /** keccak256 hash of the immutable terms, computed by the contract. */
  readonly termsHash: `0x${string}`;
  /** Evidence manifest hash ("" when not submitted). */
  readonly evidenceReference: string;
  /** Dispute manifest hash ("" when no dispute). */
  readonly disputeReference: string;
  readonly deliveryDeadline: bigint;
  readonly autoReleaseSeconds: bigint;
  readonly disputeWindowSeconds: bigint;
  readonly state: PaymentState;
  readonly createdAt: bigint;
  readonly fundedAt: bigint;
  readonly acceptedAt: bigint;
  readonly deliveryAt: bigint;
  readonly releaseRequestedAt: bigint;
  readonly releasedAt: bigint;
}

/**
 * Shape of the struct viem decodes from `getPayment` using the generated ABI.
 * Field names match the Solidity struct exactly.
 */
export interface RawPaymentStruct {
  readonly paymentId: bigint;
  readonly client: `0x${string}`;
  readonly worker: `0x${string}`;
  readonly token: `0x${string}`;
  readonly amount: bigint;
  readonly agreementLabel: `0x${string}`;
  readonly deliverableSummary: `0x${string}`;
  readonly deliveryFormat: `0x${string}`;
  readonly releaseRule: `0x${string}`;
  readonly evidenceExpectation: `0x${string}`;
  readonly termsHash: `0x${string}`;
  readonly evidenceReference: `0x${string}`;
  readonly disputeReference: `0x${string}`;
  readonly deliveryDeadline: bigint;
  readonly autoReleaseSeconds: bigint;
  readonly disputeWindowSeconds: bigint;
  readonly state: number;
  readonly createdAt: bigint;
  readonly fundedAt: bigint;
  readonly acceptedAt: bigint;
  readonly deliveryAt: bigint;
  readonly releaseRequestedAt: bigint;
  readonly releasedAt: bigint;
}

/**
 * Convert the decoded `getPayment` struct into structured PaymentData with
 * human-readable term labels and "" for unset bytes32 references.
 */
export function parsePaymentData(raw: RawPaymentStruct): PaymentData {
  return {
    id: raw.paymentId,
    client: raw.client,
    worker: raw.worker,
    token: raw.token,
    amount: raw.amount,
    agreementLabel: fromBytes32Label(raw.agreementLabel),
    deliverableSummary: fromBytes32Label(raw.deliverableSummary),
    deliveryFormat: fromBytes32Label(raw.deliveryFormat),
    releaseRule: fromBytes32Label(raw.releaseRule),
    evidenceExpectation: fromBytes32Label(raw.evidenceExpectation),
    termsHash: raw.termsHash,
    evidenceReference: isBytes32Set(raw.evidenceReference)
      ? raw.evidenceReference
      : "",
    disputeReference: isBytes32Set(raw.disputeReference)
      ? raw.disputeReference
      : "",
    deliveryDeadline: raw.deliveryDeadline,
    autoReleaseSeconds: raw.autoReleaseSeconds,
    disputeWindowSeconds: raw.disputeWindowSeconds,
    state: resolvePaymentState(Number(raw.state)),
    createdAt: raw.createdAt,
    fundedAt: raw.fundedAt,
    acceptedAt: raw.acceptedAt,
    deliveryAt: raw.deliveryAt,
    releaseRequestedAt: raw.releaseRequestedAt,
    releasedAt: raw.releasedAt,
  };
}

// ---------------------------------------------------------------------------
// USDC formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a raw bigint USDC amount as a human-readable string.
 * USDC on Celo uses 6 decimals.
 *
 * Example: formatUSDC(1500000n) → "1.5"
 */
export function formatUSDC(amount: bigint, decimals: number = PAYMENT_TOKEN_DECIMALS): string {
  const factor = BigInt(10) ** BigInt(decimals);
  const whole = amount / factor;
  const fraction = amount % factor;
  const padded = fraction.toString().padStart(decimals, "0");
  // Trim trailing zeros, but keep at least one decimal place
  const trimmed = padded.replace(/0+$/, "");
  if (trimmed.length === 0) return whole.toString();
  return `${whole}.${trimmed}`;
}

/**
 * Parse a human-readable USDC string into a bigint representing the raw
 * smallest unit.  Handles up to `decimals` (default 6) fraction digits.
 *
 * Example: parseUSDC("1.50") → 1500000n
 */
export function parseUSDC(value: string, decimals: number = PAYMENT_TOKEN_DECIMALS): bigint {
  const normalized = value.trim();
  if (normalized === "") return BigInt(0);

  const parts = normalized.split(".");
  const whole = parts[0] ?? "0";
  // Allow empty decimal part (e.g. "5.") — treat as ".0"
  const fraction = (parts[1] ?? "").slice(0, decimals).padEnd(decimals, "0");

  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction);
}
