// ---------------------------------------------------------------------------
// Resolution Agent Adapters — server-only barrel
//
// WARNING: Do NOT re-export any adapter module from the public barrel
// (../index.ts).  These modules contain server-only logic (wallet
// decryption, settlement, AI generation) and MUST remain server-side.
// ---------------------------------------------------------------------------

export {
  executeEvidenceQualityCheck,
} from "./evidence-quality-check";

export {
  recoverPaidEvidenceQualityCheck,
} from "./recovery";

export {
  createProductionActionExecutor,
  createProductionRecoveryHandler,
} from "./executor-registry";

export {
  buildEvidenceCheckInput,
  computeEvidenceInputHash,
} from "./evidence-quality-input";

export {
  normalizeEvidenceQualityResult,
} from "./evidence-quality-result";

export type {
  ResolutionAgentX402SettlementClient,
  X402SettlementResult,
  EvidenceQualityCheckGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
  EvidenceQualityCheckStore,
  EvidenceQualityCheckDependencies,
} from "./types";

export {
  ResolutionAgentToolAdapterError,
  ResolutionAgentUnsupportedToolError,
  ResolutionAgentToolIdentityMismatchError,
  ResolutionAgentToolStalePlanError,
  ResolutionAgentToolBudgetError,
  ResolutionAgentToolExecutionConflictError,
  ResolutionAgentWalletAddressMismatchError,
  ResolutionAgentSettlementUnpaidError,
  ResolutionAgentSettlementAmbiguousError,
  ResolutionAgentPaidResultRecoveryError,
  ResolutionAgentToolResultValidationError,
} from "./errors";
