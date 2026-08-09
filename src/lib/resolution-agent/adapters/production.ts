// ---------------------------------------------------------------------------
// Production adapter dependencies — the real x402 execution stack for
// Resolution Agent paid tools.
//
// SERVER-ONLY. Wires:
//   - walletDecryptor  → secure case-wallet access (AES-256-GCM decrypt +
//                        viem Account). Secrets are never logged/emitted.
//   - settlementClient → official Celo x402 facilitator
//                        (https://api.x402.celo.org), Celo Mainnet
//                        eip155:42220, USDC mainnet, scheme "exact",
//                        EIP-3009 TransferWithAuthorization signed by the
//                        AGENT CASE wallet. Success requires the
//                        facilitator's settlement proof
//                        (txHash + receipt.settlementSuccess) — never an
//                        HTTP 200 alone.
//   - generator        → evidence quality assessment (AI with fallback).
//   - paymentStore     → durable payment proof via agent events.
//
// Also assembles the full ResolutionAgentWorkerDependencies so a worker
// iteration can run observe → plan → execute → verify → persist.
// ---------------------------------------------------------------------------

import type { Account, LocalAccount } from "viem/accounts";
import type { PaymentRequirements } from "@x402/core/types";
import { getSettlementProvider, type FacilitatorSettlementReceipt } from "@/lib/x402/settlementProvider";
import { X402_SETTLEMENT_MODE } from "@/lib/x402/config";
import { generateEvidenceQuality } from "@/lib/x402/ai/evidenceQualityGenerate";
import { computeEvidenceInputHash, type ServiceInput } from "./evidence-quality-input";
import { withDecryptedCaseWalletAccount } from "../server/encryption";
import { parseWalletEncryptionKey } from "../server/config";
import { SupabaseResolutionAgentStore } from "../store/supabase";
import { observeResolutionAgentCase } from "../observation/service";
import { planResolutionAgentNextAction } from "../planner/service";
import { createProductionActionExecutor, createProductionRecoveryHandler } from "./executor-registry";
import type {
  EvidenceQualityCheckDependencies,
  EvidenceQualityCheckGenerator,
  ResolutionAgentPaymentStore,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentX402SettlementClient,
  X402SettlementResult,
} from "./types";
import type { ResolutionAgentWorkerDependencies } from "../worker/types";
import { CeloSepoliaEscrowCaseReader } from "../api/escrow-reader";
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
} from "../types";
import { EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC } from "../tools";

// ---------------------------------------------------------------------------
// Canonical x402 constants (must match planner/tool definitions exactly)
// ---------------------------------------------------------------------------

export const AGENT_SETTLEMENT_REQUIREMENT: PaymentRequirements = {
  scheme: "exact",
  network: AGENT_FACILITATOR_NETWORK,
  asset: AGENT_MAINNET_USDC_ADDRESS,
  payTo: AGENT_PAY_TO_ADDRESS,
  amount: EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC.toString(),
  maxTimeoutSeconds: 3600,
  extra: {},
};

/** EIP-712 domain for USDC on Celo mainnet (verified on-chain). */
const USDC_EIP3009_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: 42220,
  verifyingContract: AGENT_MAINNET_USDC_ADDRESS,
} as const;

/** EIP-3009 TransferWithAuthorization typed-data types. */
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Sign an EIP-3009 TransferWithAuthorization with the AGENT CASE wallet.
 * Pure helper — exported for focused testing.
 */
export async function buildAgentEip3009Payment(params: {
  payerAccount: LocalAccount;
  amountAtomic: bigint;
  payTo: string;
  validBefore: bigint;
}): Promise<{ authorization: Record<string, unknown>; signature: `0x${string}` }> {
  const { payerAccount, amountAtomic, payTo, validBefore } = params;

  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce =
    "0x" +
    Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const authorization = {
    from: payerAccount.address as `0x${string}`,
    to: payTo as `0x${string}`,
    value: amountAtomic,
    validAfter: 0n,
    validBefore,
    nonce: nonce as `0x${string}`,
  };

  const signature = await payerAccount.signTypedData({
    domain: USDC_EIP3009_DOMAIN,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  return { authorization, signature };
}

// ---------------------------------------------------------------------------
// Settlement client (official Celo x402 facilitator)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Facilitator failure observability (RA1R.7L)
// ---------------------------------------------------------------------------

/**
 * Extract a SANITIZED facilitator failure detail from a thrown error.
 * The @x402 HTTPFacilitatorClient surfaces the HTTP status and a body
 * excerpt ("Facilitator settle failed (401): ..."); the provider prefixes
 * it ("Celo facilitator /settle failed: ..."). We preserve endpoint,
 * status, and reason while redacting anything that could carry secrets
 * (API keys, long hex payloads/signatures, authorization blocks).
 */
export function sanitizeFacilitatorFailure(
  err: unknown,
  endpoint: string,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = raw
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/x402_[A-Za-z0-9]+/gi, "[REDACTED_KEY]")
    .replace(/0x[0-9a-fA-F]{40,}/g, "[REDACTED_HEX]")
    .replace(/"[^"]*signature[^"]*"\s*:\s*"[^"]*"/gi, '"signature": "[REDACTED]"')
    .replace(/authorization/g, "[authorization]")
    .replace(/\s+/g, " ")
    .trim();
  return `${endpoint} | ${safe.substring(0, 240) || "unknown facilitator error"}`;
}

export function createProductionSettlementClient(): ResolutionAgentX402SettlementClient {
  return {
    async settleEvidenceQualityCheck(params: {
      payerAccount: Account;
      requestHash: string;
      serviceInput: ServiceInput;
      expectedPriceAtomic: bigint;
      network: string;
      asset: string;
      payTo: string;
    }): Promise<X402SettlementResult> {
      const {
        payerAccount,
        expectedPriceAtomic,
        network,
        asset,
        payTo,
      } = params;

      // The agent purchase path REQUIRES the official facilitator mode.
      if (X402_SETTLEMENT_MODE !== "celo-facilitator") {
        return {
          success: false,
          ambiguous: false,
          error: "Agent purchases require celo-facilitator settlement mode.",
        };
      }
      const settlementProvider = getSettlementProvider();
      if (settlementProvider.identifier !== "celo-facilitator") {
        return {
          success: false,
          ambiguous: false,
          error: "Settlement provider is not the official Celo facilitator.",
        };
      }

      // Fail fast with an EXPLICIT configuration error before any signing:
      // the official facilitator requires X-API-Key on /settle.
      if (!process.env.X402_API_KEY) {
        return {
          success: false,
          ambiguous: false,
          error:
            "X402_API_KEY is not configured. The Celo facilitator requires " +
            "an API key on POST https://api.x402.celo.org/settle.",
        };
      }

      const requirement: PaymentRequirements = {
        scheme: "exact",
        network: network as `${string}:${string}`,
        asset,
        payTo,
        amount: expectedPriceAtomic.toString(),
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      try {
        const localAccount = payerAccount as LocalAccount;
        const { authorization, signature } = await buildAgentEip3009Payment({
          payerAccount: localAccount,
          amountAtomic: expectedPriceAtomic,
          payTo,
          validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
        });

        const settlePayload = {
          x402Version: 2,
          accepted: requirement,
          payload: { authorization, signature },
        };

        // ---- STEP: /verify FIRST ------------------------------------------
        // Never settle an unverified payment. The facilitator cryptographically
        // verifies the exact payload that would be settled.
        const verifyResult = await settlementProvider.verifyPayment(
          settlePayload as Parameters<typeof settlementProvider.verifyPayment>[0],
          requirement,
        );

        if (!verifyResult.valid) {
          const reason = verifyResult.reason ?? "invalid payment";
          const detail = sanitizeFacilitatorFailure(
            new Error(reason),
            "POST https://api.x402.celo.org/verify",
          );
          const rejected =
            `${detail}` +
            (verifyResult.payer
              ? ` | payer: ${verifyResult.payer}`
              : "");
          return {
            success: false,
            ambiguous: false,
            error: rejected,
          };
        }

        const settleResult = await settlementProvider.settlePayment(
          settlePayload as Parameters<typeof settlementProvider.settlePayment>[0],
          requirement,
        );

        if (!settleResult.success) {
          return {
            success: false,
            ambiguous: false,
            error: settleResult.reason ?? "Facilitator settlement failed.",
          };
        }

        // NEVER treat a successful HTTP call alone as proof: require the
        // facilitator's on-chain settlement proof.
        if (
          !settleResult.txHash ||
          !settleResult.receipt ||
          !settleResult.receipt.settlementSuccess
        ) {
          return {
            success: false,
            ambiguous: true,
            error: "Facilitator did not confirm on-chain settlement proof.",
          };
        }

        return {
          success: true,
          txHash: settleResult.txHash,
          receipt: settleResult.receipt,
          ambiguous: false,
        };
      } catch (err) {
        // Preserve a sanitized facilitator failure (endpoint, HTTP status,
        // reason) — never collapse everything into a generic message.
        return {
          success: false,
          ambiguous: true,
          error: sanitizeFacilitatorFailure(err, "POST https://api.x402.celo.org/settle"),
        };
      }
    },

    async settleCaseRefresh(): Promise<X402SettlementResult> {
      return {
        success: false,
        ambiguous: false,
        error: "Case-refresh settlement is not wired for production yet.",
      };
    },

    async settleDisputeBrief(): Promise<X402SettlementResult> {
      return {
        success: false,
        ambiguous: false,
        error: "Dispute-brief settlement is not wired for production yet.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Wallet decryptor (secure case-wallet access)
// ---------------------------------------------------------------------------

function createProductionWalletDecryptor(): ResolutionAgentWalletDecryptor {
  return {
    async decrypt(params: {
      encryptedSecret: Parameters<ResolutionAgentWalletDecryptor["decrypt"]>[0]["encryptedSecret"];
      caseIdentity: Parameters<ResolutionAgentWalletDecryptor["decrypt"]>[0]["caseIdentity"];
      agentId: string;
    }): Promise<Account> {
      const encryptionKey = parseWalletEncryptionKey(
        process.env.RESOLUTION_AGENT_WALLET_ENCRYPTION_KEY,
      );
      return withDecryptedCaseWalletAccount(
        {
          encryptedSecret: params.encryptedSecret,
          caseIdentity: params.caseIdentity,
          agentId: params.agentId,
          encryptionKey,
        },
        (account) => Promise.resolve(account),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Generator (evidence quality assessment)
// ---------------------------------------------------------------------------

function createProductionEvidenceGenerator(): EvidenceQualityCheckGenerator {
  return {
    async generate(params: {
      serviceInput: ServiceInput;
    }): Promise<Awaited<ReturnType<typeof generateEvidenceQuality>>> {
      return generateEvidenceQuality(
        params.serviceInput,
        computeEvidenceInputHash(params.serviceInput),
        crypto.randomUUID(),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Payment proof store (durable, via agent events)
// ---------------------------------------------------------------------------

function createProductionPaymentStore(
  store: Pick<SupabaseResolutionAgentStore, "appendEvent">,
): ResolutionAgentPaymentStore {
  return {
    async persistPaymentProof(params: {
      agentId: string;
      requestHash: string;
      txHash: string;
      receipt?: FacilitatorSettlementReceipt;
    }): Promise<void> {
      await store.appendEvent(
        params.agentId,
        "payment_settled",
        "x402 facilitator settlement confirmed for tool purchase",
        null,
        null,
        {
          requestHash: params.requestHash,
          txHash: params.txHash,
          receipt: params.receipt,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Full adapter dependencies
// ---------------------------------------------------------------------------

export function createProductionAdapterDependencies(
  store?: Pick<SupabaseResolutionAgentStore, "appendEvent">,
): EvidenceQualityCheckDependencies {
  const eventStore = store ?? new SupabaseResolutionAgentStore();
  return {
    store: eventStore as EvidenceQualityCheckDependencies["store"],
    settlementClient: createProductionSettlementClient(),
    generator: createProductionEvidenceGenerator(),
    walletDecryptor: createProductionWalletDecryptor(),
    paymentStore: createProductionPaymentStore(eventStore),
  };
}

// ---------------------------------------------------------------------------
// Worker assembly — observe → plan → execute → verify → persist
// ---------------------------------------------------------------------------

export function createResolutionAgentWorkerDependencies(): ResolutionAgentWorkerDependencies {
  const store = new SupabaseResolutionAgentStore();
  const dependencies = createProductionAdapterDependencies(store);

  return {
    store,
    observer: observeResolutionAgentCase,
    planner: planResolutionAgentNextAction,
    actionExecutor: createProductionActionExecutor(dependencies),
    recoveryHandler: createProductionRecoveryHandler(dependencies),
  };
}

/**
 * Public escrow reader used by the worker's observation step (real RPC).
 * Kept as a helper so the worker service can construct the production
 * reader without importing server-only modules into tests.
 */
export function createProductionEscrowReader(rpcUrl?: string): CeloSepoliaEscrowCaseReader {
  return new CeloSepoliaEscrowCaseReader(rpcUrl);
}

/**
 * Production evidence reader for the worker's observation step.
 */
export function createProductionEvidenceReader(): SupabaseEvidenceReader {
  return new SupabaseEvidenceReader();
}
