// ---------------------------------------------------------------------------
// Resolution Agent API — barrel export
//
// SERVER-ONLY — do NOT re-export from the public ../../index.ts barrel.
// Route handlers should import directly from
//   "@/lib/resolution-agent/api"
//
// This module exposes the public API surface: request/response schemas,
// authentication, funding, and the core business-logic service.
// ---------------------------------------------------------------------------

// ---- Request/response schemas and types ----
export {
  SUPPORTED_BUDGETS,
  createAgentRequestSchema,
  activateAgentRequestSchema,
  walletAuthHeadersSchema,
} from "./types";

export type {
  SupportedBudget,
  CreateAgentRequestBody,
  ActivateAgentRequestBody,
  WalletAuthHeaders,
} from "./types";

// ---- Authentication service ----
export {
  buildCreateAgentMessage,
  buildActivationMessage,
  verifyAuth,
} from "./auth";

// ---- Funding (on-chain balance reader) ----
export {
  FUNDING_CHAIN_ID,
  USDC_MAINNET_ADDRESS,
  CeloMainnetFundingReader,
  MockFundingReader,
} from "./funding";

export type { FundingReader } from "./funding";

// ---- Core business logic service ----
export {
  DEFAULT_EXPIRY_MS,
  createResolutionAgentForCase,
  getResolutionAgentPublicView,
  refreshFundingStatus,
  activateResolutionAgent,
  createStore,
} from "./service";

export type {
  ResolutionAgentStore,
  FundingStatusResponse,
  CreateAgentParams,
  FundingStatusParams,
  ActivateAgentParams,
} from "./service";
