// ---------------------------------------------------------------------------
// x402 settlement provider abstraction
//
// SERVER-ONLY. Defines the interface and factory for payment settlement.
//
// Two implementations:
//  - LocalSettlementProvider  — Permit2 verification + on-chain settlement
//    on Celo Sepolia (existing flow).
//  - CeloFacilitatorSettlementProvider — delegates to the official Celo x402
//    facilitator API (https://api.x402.celo.org) on Celo MAINNET.
//
// The active provider is selected via X402_SETTLEMENT_MODE env var.
// CRITICAL: never silently fall back from celo-facilitator to local.
// ---------------------------------------------------------------------------

import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { X402_SETTLEMENT_MODE } from "./config";
import { CeloFacilitatorSettlementProvider } from "./settlementProvider.facilitator";
import { LocalSettlementProvider } from "./settlementProvider.local";

// ---------------------------------------------------------------------------
// Provider-specific result types
// ---------------------------------------------------------------------------

/**
 * Result of a payment verification call.
 * Mirrors the shape of @x402/core's VerifyResponse with Reclaim additions.
 */
export interface VerifyResult {
  valid: boolean;
  reason?: string;
  payer?: string;
}

/**
 * Result of a payment settlement call.
 * Mirrors @x402/core's SettleResponse with Reclaim-specific receipt fields.
 */
export interface SettleResult {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  reason?: string;
  /** Facilitator settlement receipt — only populated in celo-facilitator mode. */
  receipt?: FacilitatorSettlementReceipt;
}

/**
 * Structured settlement receipt returned by the Celo x402 facilitator.
 * Contains full auditability data from the facilitator's /settle response.
 */
export interface FacilitatorSettlementReceipt {
  /** URL of the facilitator that processed settlement. */
  facilitatorUrl: string;
  /** x402 protocol version (always 2 for the official facilitator). */
  x402Version: number;
  /** Payment scheme (always "exact"). */
  scheme: string;
  /** CAIP-2 network identifier (eip155:42220). */
  network: string;
  /** Payer address (buyer). */
  payer: string;
  /** Destination address (service-revenue wallet). */
  payTo: string;
  /** ERC-20 token contract address. */
  token: string;
  /** Amount settled, in atomic units. */
  amount: string;
  /** Unique payment identifier from the facilitator. */
  paymentIdentifier: string;
  /** On-chain settlement transaction hash. */
  settlementTxHash: string;
  /** Whether settlement succeeded on-chain. */
  settlementSuccess: boolean;
  /** Block number containing the settlement tx (if available). */
  blockNumber?: number;
  /** ISO-8601 timestamp of settlement. */
  settledAt: string;
}

// ---------------------------------------------------------------------------
// X402SettlementProvider interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for x402 payment verification and settlement.
 *
 * Implementations handle the full verify-then-settle lifecycle for a
 * specific network and settlement mechanism. The factory function
 * `getSettlementProvider` selects the correct implementation at runtime
 * based on the X402_SETTLEMENT_MODE environment variable.
 */
export interface X402SettlementProvider {
  /**
   * Unique identifier for this provider.
   * - "local" — local Permit2 settlement on Celo Sepolia
   * - "celo-facilitator" — official Celo x402 facilitator on mainnet
   */
  readonly identifier: string;

  /** CAIP-2 network identifier this provider operates on. */
  readonly network: string;

  /** Address that receives payment (service-revenue wallet). */
  readonly payToAddress: string;

  /**
   * Whether this settlement path qualifies as a Track 2 (production)
   * settlement. For display / auditing purposes.
   */
  readonly isTrack2Qualifying: boolean;

  /**
   * Verify a payment payload against the given payment requirements.
   *
   * For the local provider this runs Permit2 EIP-712 signature recovery
   * and on-chain balance/allowance/nonce checks. For the facilitator
   * provider this POSTs to the facilitator's /verify endpoint.
   *
   * @param payload  - The payment payload (from PAYMENT-SIGNATURE header).
   * @param requirement - The payment requirement matched by the client.
   * @returns VerifyResult with validity, optional payer address, and
   *          a reason string on failure.
   */
  verifyPayment(
    payload: PaymentPayload,
    requirement: PaymentRequirements,
  ): Promise<VerifyResult>;

  /**
   * Settle a verified payment on-chain.
   *
   * For the local provider this submits the Permit2 `permitTransferFrom`
   * transaction via the relayer wallet and waits for confirmation.
   * For the facilitator provider this POSTs to the facilitator's /settle
   * endpoint; the facilitator broadcasts the settlement transaction.
   *
   * @param payload  - The payment payload (from PAYMENT-SIGNATURE header).
   * @param requirement - The payment requirement matched by the client.
   * @returns SettleResult with success status, txHash, blockNumber, and
   *          optional facilitator receipt.
   */
  settlePayment(
    payload: PaymentPayload,
    requirement: PaymentRequirements,
  ): Promise<SettleResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Return the X402SettlementProvider for the current environment.
 *
 * Reads X402_SETTLEMENT_MODE:
 *  - "celo-facilitator" → CeloFacilitatorSettlementProvider (Celo mainnet)
 *  - "local" (default)   → LocalSettlementProvider (Celo Sepolia)
 *
 * CRITICAL: never silently fall back. If celo-facilitator is requested and
 * the provider cannot be instantiated, this function throws.
 *
 * @throws If X402_SETTLEMENT_MODE is unrecognized.
 */
export function getSettlementProvider(): X402SettlementProvider {
  if (X402_SETTLEMENT_MODE === "celo-facilitator") {
    return new CeloFacilitatorSettlementProvider();
  }

  if (X402_SETTLEMENT_MODE === "local") {
    return new LocalSettlementProvider();
  }

  throw new Error(
    `Unknown X402_SETTLEMENT_MODE: "${X402_SETTLEMENT_MODE}". ` +
      `Expected "local" or "celo-facilitator".`,
  );
}

// Re-export for convenience so callers don't need to import from multiple modules.
export { type SettlementMode } from "./types";
