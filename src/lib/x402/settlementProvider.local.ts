// ---------------------------------------------------------------------------
// Local settlement provider — Permit2 verification + on-chain settlement
// on Celo Sepolia (eip155:11142220)
//
// SERVER-ONLY. Wraps the existing local verify (localVerify.ts) and settle
// (settlement.ts) functions behind the X402SettlementProvider interface.
//
// This provider uses the relayer wallet (X402_RELAYER_PRIVATE_KEY) to submit
// Permit2 transactions on-chain. It is the default provider unless
// X402_SETTLEMENT_MODE is set to "celo-facilitator".
// ---------------------------------------------------------------------------

import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import type {
  X402SettlementProvider,
  VerifyResult,
  SettleResult,
} from "./settlementProvider";
import type { PaymentDetails } from "./types";
import {
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
} from "./config";
import { verifyPermit2Authorization } from "./localVerify";
import { settlePayment as settleOnChain } from "./settlement";

// ---------------------------------------------------------------------------
// LocalSettlementProvider
// ---------------------------------------------------------------------------

export class LocalSettlementProvider implements X402SettlementProvider {
  readonly identifier = "local";
  readonly network = X402_NETWORK; // "eip155:11142220"
  readonly payToAddress = X402_PAY_TO_ADDRESS;
  readonly isTrack2Qualifying = false;

  /**
   * Verify a Permit2-authorized payment locally.
   *
   * Extracts the Permit2 PaymentDetails from the @x402/core PaymentPayload,
   * then delegates to the existing verifyPermit2Authorization function which
   * performs EIP-712 signature recovery, spender/relayer matching, deadline
   * checks, on-chain balance/allowance verification, and nonce-replay
   * detection. Read-only — no state changes.
   */
  async verifyPayment(
    payload: PaymentPayload,
    _requirement: PaymentRequirements, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<VerifyResult> {
    // Extract the Permit2 payment details from the x402 PaymentPayload.
    // The payload.payload field contains our Reclaim-specific PaymentDetails
    // structure when using the local (Permit2) payment scheme.
    const payment = payload.payload as unknown as PaymentDetails;

    const result = await verifyPermit2Authorization(payment);

    return {
      valid: result.isValid,
      reason: result.invalidReason,
      payer: result.payer,
    };
  }

  /**
   * Execute on-chain settlement of a Permit2-authorized payment.
   *
   * Extracts the Permit2 PaymentDetails, then delegates to the existing
   * settlePayment function which submits the permitTransferFrom transaction
   * via the relayer wallet, waits for confirmation, and verifies the USDC
   * Transfer event. Returns a REAL on-chain receipt with txHash and blockNumber.
   */
  async settlePayment(
    payload: PaymentPayload,
    _requirement: PaymentRequirements, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<SettleResult> {
    // Extract the Permit2 payment details from the x402 PaymentPayload.
    const payment = payload.payload as unknown as PaymentDetails;

    try {
      const receipt = await settleOnChain(payment);

      return {
        success: receipt.status === "success",
        txHash: receipt.txHash,
        blockNumber: Number(receipt.blockNumber),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown settlement error";
      console.error(`[x402][local] Settlement failed: ${message}`);
      return {
        success: false,
        reason: message,
      };
    }
  }
}
