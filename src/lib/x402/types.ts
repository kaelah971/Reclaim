// ---------------------------------------------------------------------------
// x402 v2 protocol types
//
// x402 is an HTTP-based payment protocol (RFC-style) that uses standard 402
// Payment Required semantics. A server advertises payment requirements via
// the PAYMENT-REQUIRED header; clients pay and attach a PAYMENT-SIGNATURE
// header when retrying the request.
//
// This module defines the core data structures shared between our server-side
// API endpoint, the dispute-brief generator, and the client-side pay button.
//
// Official @x402/core types are re-exported for consumers that need the wire
// format.  Our custom types extend / complement them with Reclaim-specific
// fields (SettlementReceipt, PaymentIdentifier, etc.).
// ---------------------------------------------------------------------------

// ---- Re-exports from the official @x402/core library ----
export type {
  // PaymentRequired is the full 402 response (v2: x402Version, resource, accepts[], extensions)
  PaymentRequired,
  // A single entry in the "accepts" array (scheme, network, amount, asset, payTo, maxTimeoutSeconds)
  PaymentRequirements,
  // The payment payload sent by the client in PAYMENT-SIGNATURE (v2: x402Version, accepted, payload)
} from "@x402/core/types";

// ---- Re-exports from @x402/core/http ----
export type {
  PaymentPayload,
} from "@x402/core/types";

export type {
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

// ---------------------------------------------------------------------------
// Reclaim-specific types (kept for backward compatibility & domain modelling)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `PaymentRequirements` from @x402/core/types instead.
 * A single accepted payment scheme.
 */
export interface PaymentRequirement {
  /** Payment scheme identifier — "exact" for Permit2-style EVM payments. */
  scheme: "exact";

  /** Human-readable price, e.g. "$0.01". */
  price: string;

  /** CAIP-2 network identifier, e.g. "eip155:11142220" for Celo Sepolia. */
  network: string;

  /** Address that receives the payment (Reclaim service-revenue wallet). */
  payTo: string;

  /** ERC-20 token contract address. */
  asset: string;

  /** Decimals of the payment token (USDC = 6). */
  assetDecimals: number;
}

/**
 * @deprecated Use `PaymentRequired` from @x402/core/types for the 402 header.
 * Server-advertised payment requirements.
 */
export interface PaymentRequirementsLegacy {
  /** Accepted payment schemes. */
  accepts: PaymentRequirement[];

  /** Human-readable description of what the payment buys. */
  description: string;

  /** Expected MIME type of the response body. */
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Payment details (Permit2-style authorization for the "exact" scheme)
// ---------------------------------------------------------------------------

/**
 * Payment details within the x402 payment payload.
 * For the "exact" scheme on EVM, this contains a Permit2 `PermitTransferFrom`
 * signature authorizing a USDC transfer from the buyer to the service wallet.
 */
export interface PaymentDetails {
  /** Buyer address. */
  from: string;

  /** Recipient address (must match payTo from the payment requirement). */
  to: string;

  /** ERC-20 token address. */
  token: string;

  /** Raw amount in atomic units (e.g. 10000 = 0.01 USDC at 6 decimals). */
  amount: string;

  /** EIP-712 typed-data signature authorizing the Permit2 transfer. */
  signature: string;

  /** Permit2 nonce used in the signed message. */
  nonce?: string;

  /** Permit2 deadline (Unix timestamp in seconds). */
  deadline?: string;

  /**
   * The Permit2 `spender` address — who is authorized to submit the transfer.
   * When using a relayer, this is the relayer's address; when self-settling
   * on the client side it is the `payTo` address.
   */
  spender?: string;
}

// ---------------------------------------------------------------------------
// Client payment payload (sent in PAYMENT-SIGNATURE header)
// ---------------------------------------------------------------------------

/**
 * Custom payment payload sent by the client (base64-encoded in the header).
 * This is our Reclaim-specific envelope wrapping the @x402/core PaymentPayload.
 */
export interface PaymentPayloadCustom {
  /** Payment scheme identifier (must match the requirement). */
  scheme: string;

  /** CAIP-2 network identifier. */
  network: string;

  /** Payment details (scheme-specific). */
  payment: PaymentDetails;

  /** Optional correlation ID for request tracing. */
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Payment identifier & idempotency types
// ---------------------------------------------------------------------------

/** Unique identifier for a payment attempt (used for idempotency). */
export type PaymentIdentifier = string;

/**
 * Status of a payment attempt in the idempotency store.
 */
export type PaymentStatus = "pending" | "settled" | "failed";

/**
 * A record in the payment idempotency store.
 */
export interface PendingPayment {
  /** Current lifecycle status. */
  status: PaymentStatus;

  /** When the record was created (epoch ms). */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Settlement receipt (real on-chain transaction result)
// ---------------------------------------------------------------------------

/**
 * Verified on-chain settlement receipt — only created AFTER a confirmed
 * transaction.  This type is NEVER populated with fabricated data.
 */
export interface SettlementReceipt {
  /** Transaction hash of the on-chain USDC transfer. */
  txHash: string;

  /** Block number where the transfer was confirmed. */
  blockNumber: bigint;

  /** Block hash of the confirmation block. */
  blockHash: string;

  /** Settlement status: true only when the on-chain tx succeeded. */
  status: "success" | "reverted";

  /** Address that sent the USDC (buyer). */
  from: string;

  /** Address that received the USDC (service revenue wallet). */
  to: string;

  /** Amount transferred, in atomic units (string to preserve precision). */
  amount: string;

  /** The USDC token contract address on which the Transfer event was emitted. */
  tokenAddress: string;

  /**
   * The raw Transfer event log emitted by the USDC contract.
   * Stored for auditability — contains the indexed + non-indexed params.
   */
  transferEventLog?: {
    logIndex: number;
    /** Topic[1] = indexed `from` (padded 32 bytes). */
    topics: string[];
    /** ABI-encoded non-indexed params. */
    data: string;
  };
}

// ---------------------------------------------------------------------------
// Legacy types (kept for backward compatibility with existing code)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use SettlementReceipt instead.
 */
export interface SettlementResponse {
  /** Whether the payment was verified and settled. */
  success: boolean;

  /** Transaction hash if settlement was executed on-chain. */
  txHash?: string;

  /** Block number of the settlement transaction. */
  blockNumber?: number;

  /** Human-readable confirmation message. */
  message: string;
}

// ---------------------------------------------------------------------------
// x402 configuration interface
// ---------------------------------------------------------------------------

export interface X402Config {
  /** URL of the Celo x402 facilitator for buyer-side paywall UI. */
  facilitatorUrl: string;

  /** CAIP-2 network identifier for the active chain. */
  network: string;

  /** USDC token address on the active chain. */
  usdcAddress: string;

  /** USDC token decimals. */
  usdcDecimals: number;

  /** Address that receives x402 service fees (Reclaim revenue wallet). */
  payToAddress: string;

  /** Price of the dispute brief service in human-readable USDC. */
  disputeBriefPrice: string;

  /** Price of the dispute brief service in atomic units (e.g. 10000 = 0.01). */
  disputeBriefPriceAtomic: bigint;

  /** Array of CAIP-2 networks the service supports. */
  supportedNetworks: string[];
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

/** Successful dispute brief response. */
export interface DisputeBriefResponse {
  /** Correlation ID for tracing. */
  correlationId: string;

  /** The generated dispute brief. */
  brief: import("./disputeBrief").DisputeBrief;

  /** Settlement confirmation (real on-chain receipt). */
  settlement: SettlementReceipt;
}

/** Error response body. */
export interface X402ErrorResponse {
  /** Correlation ID for tracing. */
  correlationId: string;

  /** HTTP status code. */
  status: number;

  /** Human-readable error message. */
  error: string;

  /** Optional structured validation errors. */
  details?: Record<string, string[]>;
}
