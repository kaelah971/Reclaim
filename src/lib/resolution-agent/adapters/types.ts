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

/**
 * Validate a successful settlement before any paid state or result is
 * persisted. A truthy provider response is not proof by itself: every
 * successful result must carry both the on-chain transaction hash and the
 * facilitator receipt; the receipt must agree with that hash and confirm
 * success. A provider response without both proofs is never paid.
 */
export function validateX402SettlementResult(
  result: X402SettlementResult,
): string | null {
  if (!result.success) return result.error ?? "Settlement was not successful.";
  if (result.ambiguous) return "Settlement outcome is ambiguous.";
  if (!result.txHash || result.txHash.trim().length === 0) {
    return "Successful settlement is missing its transaction hash.";
  }

  if (!result.receipt) {
    return "Successful settlement is missing its facilitator receipt.";
  }
  if (!result.receipt.settlementSuccess) {
    return "Settlement receipt does not confirm on-chain success.";
  }
  if (
    !result.receipt.settlementTxHash ||
    result.receipt.settlementTxHash !== result.txHash
  ) {
    return "Settlement receipt transaction hash does not match the settlement result.";
  }

  return null;
}

/** Validate the durable proof required by a paid execution recovery path. */
export function validatePersistedSettlementProof(
  execution: Pick<ToolExecutionRow, "settlement_tx_hash">,
): string | null {
  if (!execution.settlement_tx_hash || execution.settlement_tx_hash.trim().length === 0) {
    return "No payment proof — settlement transaction proof is required to recover a paid execution.";
  }
  return null;
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
    | { kind: "reused"; agentId: string; requestHash: string; state: string }
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
  /** Durable evidence metadata reader (RA1R.8D) — supplies substantive
   *  facts (pasted text, claim, date, …) into the QC service input. */
  evidenceReader?: {
    getEvidenceMetadata(escrowPaymentId: string): Promise<{
      evidenceReference: string | null;
      title: string | null;
      evidenceType: string | null;
      description: string | null;
      relatedDeliverable: string | null;
      externalReference: string | null;
      fileCount: number;
      latestUpdateTimestamp: number | null;
      substantiveEvidence: boolean;
      relatedClaim?: string | null;
      pastedText?: string | null;
      evidenceDate?: string | null;
      externalRef?: string | null;
      fileHash?: string | null;
    }>;
  };
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
