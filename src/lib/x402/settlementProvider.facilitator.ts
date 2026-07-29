// ---------------------------------------------------------------------------
// Celo Facilitator settlement provider — delegates to the official Celo x402
// facilitator API (https://api.x402.celo.org) on Celo MAINNET (eip155:42220).
//
// SERVER-ONLY. The official facilitator supports x402Version 2, scheme "exact",
// and Celo mainnet USDC. It handles both verification and settlement — we
// do NOT use X402_RELAYER_PRIVATE_KEY in this mode; the facilitator broadcasts
// the settlement transaction.
//
// CRITICAL: never silently fall back to local settlement. If the facilitator
// is unreachable or returns an error, this provider throws.
// ---------------------------------------------------------------------------

import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from "@x402/core/types";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  X402SettlementProvider,
  VerifyResult,
  SettleResult,
  FacilitatorSettlementReceipt,
} from "./settlementProvider";
import {
  X402_FACILITATOR_NETWORK,
  X402_PAY_TO_ADDRESS_FACILITATOR,
  X402_FACILITATOR_USDC_MAINNET,
  requireFacilitatorApiKey,
} from "./config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** URL of the official Celo x402 facilitator. */
const FACILITATOR_URL = "https://api.x402.celo.org";

/** x402 version supported by the official facilitator. */
const FACILITATOR_X402_VERSION = 2;

// ---------------------------------------------------------------------------
// CeloFacilitatorSettlementProvider
// ---------------------------------------------------------------------------

export class CeloFacilitatorSettlementProvider implements X402SettlementProvider {
  readonly identifier = "celo-facilitator";
  readonly network = X402_FACILITATOR_NETWORK; // "eip155:42220"
  readonly payToAddress = X402_PAY_TO_ADDRESS_FACILITATOR;
  readonly isTrack2Qualifying = true;

  /**
   * Lazy-initialised facilitator client.
   * Created on first use to avoid instantiating HTTP clients at module-load
   * time when this provider isn't the active one.
   */
  private _client: HTTPFacilitatorClient | null = null;

  private get client(): HTTPFacilitatorClient {
    if (!this._client) {
      this._client = new HTTPFacilitatorClient({
        url: FACILITATOR_URL,
        createAuthHeaders: async () => {
          const apiKey = requireFacilitatorApiKey();
          if (!apiKey) return { verify: {}, settle: {}, supported: {} };
          const keyHeader = { "X-API-Key": apiKey };
          return { verify: keyHeader, settle: keyHeader, supported: keyHeader };
        },
      });
    }
    return this._client;
  }

  // -------------------------------------------------------------------------
  // verifyPayment
  // -------------------------------------------------------------------------

  /**
   * Verify a payment with the official Celo x402 facilitator.
   *
   * POSTs the PaymentPayload + PaymentRequirements to the facilitator's
   * /verify endpoint. The facilitator cryptographically verifies the
   * Permit2 signature on Celo mainnet.
   *
   * @throws If the facilitator is unreachable.
   */
  async verifyPayment(
    payload: PaymentPayload,
    requirement: PaymentRequirements,
  ): Promise<VerifyResult> {
    try {
      const response: VerifyResponse = await this.client.verify(
        payload,
        requirement,
      );

      return {
        valid: response.isValid,
        reason: response.invalidReason || response.invalidMessage,
        payer: response.payer,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Facilitator verification error";
      console.error(
        `[x402][celo-facilitator] Verification failed: ${message}`,
      );
      throw new Error(
        `Celo facilitator /verify failed: ${message}. ` +
          "No fallback to local settlement — the facilitator must be reachable.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // settlePayment
  // -------------------------------------------------------------------------

  /**
   * Settle a verified payment via the official Celo x402 facilitator.
   *
   * POSTs the PaymentPayload + PaymentRequirements to the facilitator's
   * /settle endpoint. The facilitator broadcasts the on-chain settlement
   * transaction — we do NOT use X402_RELAYER_PRIVATE_KEY in this mode.
   *
   * @throws If the facilitator is unreachable.
   */
  async settlePayment(
    payload: PaymentPayload,
    requirement: PaymentRequirements,
  ): Promise<SettleResult> {
    try {
      const response: SettleResponse = await this.client.settle(
        payload,
        requirement,
      );

      // Build the structured facilitator receipt from the response.
      const receipt: FacilitatorSettlementReceipt = {
        facilitatorUrl: FACILITATOR_URL,
        x402Version: FACILITATOR_X402_VERSION,
        scheme: requirement.scheme,
        network: this.network,
        payer: response.payer || "",
        payTo: requirement.payTo,
        token: requirement.asset,
        amount: requirement.amount,
        paymentIdentifier: response.transaction,
        settlementTxHash: response.transaction,
        settlementSuccess: response.success,
        settledAt: new Date().toISOString(),
      };

      return {
        success: response.success,
        txHash: response.transaction || undefined,
        reason: !response.success ? (response.errorReason || response.errorMessage) : undefined,
        receipt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Facilitator settlement error";
      console.error(
        `[x402][celo-facilitator] Settlement failed: ${message}`,
      );
      throw new Error(
        `Celo facilitator /settle failed: ${message}. ` +
          "No fallback to local settlement — the facilitator must be reachable.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Build a PaymentRequirements object compatible with the Celo mainnet
   * facilitator for the given amount (in atomic USDC units).
   *
   * The official facilitator requires:
   *  - scheme: "exact"
   *  - network: "eip155:42220"
   *  - asset: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C (USDC on mainnet)
   *  - payTo: the registered Track 2 wallet
   *
   * @param amountAtomic - Amount in atomic USDC units (string for bigint safety).
   * @param maxTimeoutSeconds - Max settlement timeout (default 300 seconds).
   */
  static buildMainnetRequirements(
    amountAtomic: string,
    maxTimeoutSeconds = 300,
  ): PaymentRequirements {
    return {
      scheme: "exact",
      network: X402_FACILITATOR_NETWORK,
      asset: X402_FACILITATOR_USDC_MAINNET,
      amount: amountAtomic,
      payTo: X402_PAY_TO_ADDRESS_FACILITATOR,
      maxTimeoutSeconds,
      extra: {},
    };
  }

  /**
   * Build a PaymentPayload for the facilitator that wraps the given raw
   * payment details (Permit2 signature, etc.) into the @x402/core shape.
   *
   * @param rawPayment - The scheme-specific payment data (Permit2 fields).
   * @param requirements - The matched payment requirements.
   */
  static buildPaymentPayload(
    rawPayment: Record<string, unknown>,
    requirements: PaymentRequirements,
  ): PaymentPayload {
    return {
      x402Version: FACILITATOR_X402_VERSION,
      accepted: requirements,
      payload: rawPayment,
    };
  }
}
