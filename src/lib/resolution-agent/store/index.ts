// ---------------------------------------------------------------------------
// Resolution Agent Store — barrel export
//
// SERVER-ONLY — do NOT re-export from the public ../index.ts barrel.
// Consumers should import directly from "@/lib/resolution-agent/store".
// ---------------------------------------------------------------------------

// Row types
export type {
  ResolutionAgentRow,
  AgentEventRow,
  ToolExecutionRow,
  EvidenceRequestRow,
} from "./types";

// Store implementation
export { SupabaseResolutionAgentStore } from "./supabase";

// Serialization helpers
export {
  agentToInsertRow,
  agentToUpdateRow,
  rowToAgent,
} from "./serialization";

// Store-specific errors
export {
  ResolutionAgentStoreError,
  ResolutionAgentNotFoundError,
  ResolutionAgentAlreadyExistsError,
  ResolutionAgentConcurrencyError,
  ResolutionAgentSerializationError,
  ResolutionAgentToolExecutionConflictError,
} from "./errors";
