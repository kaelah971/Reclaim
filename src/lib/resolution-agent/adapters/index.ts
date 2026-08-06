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
  executeCaseRefresh,
} from "./case-refresh";

export {
  recoverPaidEvidenceQualityCheck,
} from "./recovery";

export {
  recoverPaidCaseRefresh,
} from "./case-refresh-recovery";

export {
  createProductionActionExecutor,
  createProductionRecoveryHandler,
} from "./executor-registry";

export {
  buildEvidenceCheckInput,
  computeEvidenceInputHash,
} from "./evidence-quality-input";

export {
  buildCaseRefreshInput,
} from "./case-refresh-input";

export {
  normalizeEvidenceQualityResult,
} from "./evidence-quality-result";

export {
  normalizeCaseRefreshResult,
} from "./case-refresh-result";

export type {
  ResolutionAgentX402SettlementClient,
  X402SettlementResult,
  EvidenceQualityCheckGenerator,
  CaseRefreshGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
  EvidenceQualityCheckStore,
  EvidenceQualityCheckDependencies,
  CaseRefreshDependencies,
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
