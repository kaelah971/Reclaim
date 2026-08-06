// ---------------------------------------------------------------------------
// Adapter Dependency Interfaces
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { Account } from "viem/accounts";
import type {
  ResolutionAgent,
  AgentCaseIdentity,
  EncryptedWalletSecret,
} from "../types";
import type { ToolExecutionRow } from "../store/types";
import type { EvidenceQualityGenerationResult } from "../../x402/ai/evidenceQualityGenerate";
import type { FacilitatorSettlementReceipt } from "../../x402/settlementProvider";
import type { ServiceInput } from "./evidence-quality-input";

// ---------------------------------------------------------------------------
// X402 Settlement Client (injected)
// ---------------------------------------------------------------------------

export interface X402SettlementResult {
  success: boolean;
  txHash?: string;
  receipt?: FacilitatorSettlementReceipt;
  error?: string;
  /** true when the settlement outcome is unknown (network error, etc.) */
  ambiguous: boolean;
}

export interface ResolutionAgentX402SettlementClient {
  settleEvidenceQualityCheck(params: {
    payerAccount: Account;
    requestHash: string;
    serviceInput: ServiceInput;
    expectedPriceAtomic: bigint;
    network: string;
    asset: string;
    payTo: string;
  }): Promise<X402SettlementResult>;
}

// ---------------------------------------------------------------------------
// Evidence Quality Check Generator (injected)
// ---------------------------------------------------------------------------

export interface EvidenceQualityCheckGenerator {
  generate(params: {
    serviceInput: ServiceInput;
  }): Promise<EvidenceQualityGenerationResult>;
}

// ---------------------------------------------------------------------------
// Wallet Decryptor (injected)
// ---------------------------------------------------------------------------

export interface ResolutionAgentWalletDecryptor {
  decrypt(params: {
    encryptedSecret: EncryptedWalletSecret;
    caseIdentity: AgentCaseIdentity;
    agentId: string;
  }): Promise<Account>;
}

// ---------------------------------------------------------------------------
// Payment Store (injected)
// ---------------------------------------------------------------------------

export interface ResolutionAgentPaymentStore {
  persistPaymentProof(params: {
    agentId: string;
    requestHash: string;
    txHash: string;
    receipt?: FacilitatorSettlementReceipt;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Canonical Store Interface (subset needed by adapters)
// ---------------------------------------------------------------------------

export interface EvidenceQualityCheckStore {
  createToolExecution(
    agentId: string,
    toolIdentifier: string,
    requestHash: string,
    priceAtomic: bigint,
    network: string,
    asset: string,
    payTo: string,
  ): Promise<void>;
  getToolExecutionByRequestHash(
    agentId: string,
    requestHash: string,
  ): Promise<ToolExecutionRow | null>;
  updateToolExecution(
    agentId: string,
    requestHash: string,
    updates: Partial<
      Pick<
        ToolExecutionRow,
        | "state"
        | "payment_reference"
        | "settlement_tx_hash"
        | "result_reference"
        | "result_data"
        | "failure_reason"
        | "case_version_hash"
        | "evidence_version_hash"
      >
    >,
  ): Promise<void>;
  getAgentVersion(agentId: string): Promise<number>;
  updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent>;
  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Complete Adapter Dependencies
// ---------------------------------------------------------------------------

export interface EvidenceQualityCheckDependencies {
  store: EvidenceQualityCheckStore;
  settlementClient: ResolutionAgentX402SettlementClient;
  generator: EvidenceQualityCheckGenerator;
  walletDecryptor: ResolutionAgentWalletDecryptor;
  paymentStore: ResolutionAgentPaymentStore;
}
