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
import type { CaseRefreshInput } from "../../x402/caseRefreshValidation";
import type { CaseRefreshGenerationResult } from "../../x402/caseRefreshGenerate";
import type { DisputeBriefAgentInput } from "./dispute-brief-input";

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

  settleCaseRefresh(params: {
    payerAccount: Account;
    requestHash: string;
    serviceInput: CaseRefreshInput;
    expectedPriceAtomic: bigint;
    network: string;
    asset: string;
    payTo: string;
  }): Promise<X402SettlementResult>;

  settleDisputeBrief(params: {
    payerAccount: Account;
    requestHash: string;
    serviceInput: DisputeBriefAgentInput;
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
// Case Refresh Generator (injected)
// ---------------------------------------------------------------------------

export interface CaseRefreshGenerator {
  generate(params: {
    serviceInput: CaseRefreshInput;
  }): Promise<CaseRefreshGenerationResult>;
}

// ---------------------------------------------------------------------------
// Dispute Brief Generation Result
// ---------------------------------------------------------------------------

export interface DisputeBriefGenerationResult {
  briefId: string;
  generatedAt: string;
  generationMode: string;
  reviewerPacketReady: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Dispute Brief Generator (injected)
// ---------------------------------------------------------------------------

export interface DisputeBriefGenerator {
  generate(params: {
    serviceInput: DisputeBriefAgentInput;
  }): Promise<DisputeBriefGenerationResult>;
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
  getAgentById(agentId: string): Promise<ResolutionAgent | null>;
  listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
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
  reserveToolExecutionAtomically(params: {
    agentId: string;
    expectedAgentVersion: number;
    requestHash: string;
    toolId: string;
    caseVersionHash: string;
    evidenceVersionHash: string;
    priceAtomic: bigint;
    network: string;
    asset: string;
    payTo: string;
    serviceIdentifier: string;
    policyVersion: string;
    now: number;
  }): Promise<
    | { kind: "created"; agentId: string; requestHash: string; state: string }
    | { kind: "existing"; agentId: string; requestHash: string; state: string }
  >;
  releaseUnpaidToolExecution(params: {
    agentId: string;
    requestHash: string;
    expectedAgentVersion: number;
    now: number;
  }): Promise<
    | { kind: "released"; agentId: string; requestHash: string }
    | { kind: "already_released"; agentId: string; requestHash: string }
  >;
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

// ---------------------------------------------------------------------------
// Case Refresh Dependencies
// ---------------------------------------------------------------------------

export interface CaseRefreshDependencies {
  store: EvidenceQualityCheckStore;
  settlementClient: ResolutionAgentX402SettlementClient;
  generator: CaseRefreshGenerator;
  walletDecryptor: ResolutionAgentWalletDecryptor;
  paymentStore: ResolutionAgentPaymentStore;
}

// ---------------------------------------------------------------------------
// Dispute Brief Dependencies
// ---------------------------------------------------------------------------

export interface DisputeBriefDependencies {
  store: EvidenceQualityCheckStore;
  settlementClient: ResolutionAgentX402SettlementClient;
  generator: DisputeBriefGenerator;
  walletDecryptor: ResolutionAgentWalletDecryptor;
  paymentStore: ResolutionAgentPaymentStore;
}
