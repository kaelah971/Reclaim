import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent Goal
// ---------------------------------------------------------------------------

export const FIXED_AGENT_GOAL =
  "Prepare this payment case for fair human review." as const;

// ---------------------------------------------------------------------------
// Agent States
// ---------------------------------------------------------------------------

export const AGENT_STATES = [
  "draft",
  "awaiting_funding",
  "funded",
  "awaiting_activation",
  "active",
  "running_tool",
  "waiting_for_evidence",
  "waiting_for_human_approval",
  "ready_for_human_review",
  "budget_exhausted",
  "expired",
  "paused",
  "closing",
  "closed",
  "failed_recoverable",
] as const;

export type ResolutionAgentStatus = (typeof AGENT_STATES)[number];

// ---------------------------------------------------------------------------
// Tool Identifiers (V1 — exactly three)
// ---------------------------------------------------------------------------

export const AGENT_TOOL_IDS = [
  "evidence-quality-check",
  "case-refresh",
  "reclaim-dispute-brief-v1",
] as const;

export type ResolutionAgentToolId = (typeof AGENT_TOOL_IDS)[number];

// ---------------------------------------------------------------------------
// Canonical x402 Configuration Values (server-owned, never user-provided)
// ---------------------------------------------------------------------------

export const AGENT_FACILITATOR_NETWORK = "eip155:42220" as const;

export const AGENT_MAINNET_USDC_ADDRESS =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;

export const AGENT_PAY_TO_ADDRESS =
  "0x85522bdE267d05bf8CE8813F97c75417b7894A33" as const;

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export interface ResolutionAgentToolDefinition {
  id: ResolutionAgentToolId;
  displayName: string;
  priceAtomic: bigint;
  network: typeof AGENT_FACILITATOR_NETWORK;
  asset: typeof AGENT_MAINNET_USDC_ADDRESS;
  payTo: typeof AGENT_PAY_TO_ADDRESS;
  requiresMeaningfulChange: boolean;
  requiresEvidence: boolean;
  purpose: string;
}

// ---------------------------------------------------------------------------
// Tool Request (what the planner proposes to execute)
// ---------------------------------------------------------------------------

export interface ResolutionAgentToolRequest {
  toolId: ResolutionAgentToolId;
  priceAtomic: bigint;
  network: string;
  asset: string;
  payTo: string;
  caseVersionHash: string;
  evidenceVersionHash: string;
}

// ---------------------------------------------------------------------------
// Policy Decision (discriminated union)
// ---------------------------------------------------------------------------

export type PolicyDecision =
  | { kind: "allowed" }
  | { kind: "agent_not_active" }
  | { kind: "agent_expired" }
  | { kind: "agent_paused" }
  | { kind: "agent_closing" }
  | { kind: "agent_closed" }
  | { kind: "tool_not_allowlisted"; requestedToolId: string }
  | { kind: "invalid_price"; expected: bigint; received: bigint }
  | { kind: "invalid_network"; expected: string; received: string }
  | { kind: "invalid_asset"; expected: string; received: string }
  | { kind: "invalid_recipient"; expected: string; received: string }
  | { kind: "insufficient_budget"; remaining: bigint; requested: bigint }
  | { kind: "evidence_required" }
  | { kind: "meaningful_change_required" }
  | { kind: "already_running" }
  | { kind: "already_settled" };

export interface ResolutionAgentToolExecutionDecision {
  decision: PolicyDecision;
  evaluatedAt: number;
}

// ---------------------------------------------------------------------------
// Budget Model
// ---------------------------------------------------------------------------

export interface AgentBudget {
  approvedAtomic: bigint;
  spentAtomic: bigint;
  reservedAtomic: bigint;
}

// ---------------------------------------------------------------------------
// Agent Expiry
// ---------------------------------------------------------------------------

export interface AgentExpiry {
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Encrypted Wallet Secret (opaque — ciphertext only)
// ---------------------------------------------------------------------------

export interface EncryptedWalletSecret {
  _brand: "EncryptedWalletSecret";
  ciphertext: string;
  iv: string;
  tag: string;
}

// ---------------------------------------------------------------------------
// Case Identity
// ---------------------------------------------------------------------------

export interface AgentCaseIdentity {
  escrowPaymentId: string;
  escrowChainId: string;
  escrowContractAddress: string;
}

// ---------------------------------------------------------------------------
// Agent Policy
// ---------------------------------------------------------------------------

export interface ResolutionAgentPolicy {
  allowedTools: ResolutionAgentToolId[];
  approvedBudgetAtomic: bigint;
  expiresAt: number;
  funderAddress: string;
}

// ---------------------------------------------------------------------------
// Plan & Observation
// ---------------------------------------------------------------------------

export type PlanStepKind =
  | "read_agreement"
  | "check_evidence"
  | "purchase_evidence_check"
  | "purchase_case_refresh"
  | "purchase_dispute_brief"
  | "request_evidence"
  | "wait_for_evidence"
  | "wait_for_human_approval"
  | "finalize";

export interface ResolutionAgentPlanStep {
  kind: PlanStepKind;
  description: string;
  toolId?: ResolutionAgentToolId;
}

export interface ResolutionAgentPlan {
  steps: ResolutionAgentPlanStep[];
  currentStepIndex: number;
  lastUpdated: number;
  caseVersionHash: string;
  evidenceVersionHash: string;
}

export interface EvidenceGap {
  id: string;
  description: string;
  responsibleParty: "client" | "worker";
  status: "open" | "fulfilled" | "cancelled";
  createdAt: number;
  fulfilledAt?: number;
  caseChangedAfterFulfillment: boolean;
}

export interface ResolutionAgentObservation {
  escrowState: string;
  evidenceCount: number;
  evidenceVersionHash: string;
  caseVersionHash: string;
  unresolvedGaps: EvidenceGap[];
  hasMeaningfulChange: boolean;
  observedAt: number;
}

// ---------------------------------------------------------------------------
// ResolutionAgent (main domain object)
// ---------------------------------------------------------------------------

export interface ResolutionAgent {
  id: string;
  goal: typeof FIXED_AGENT_GOAL;
  status: ResolutionAgentStatus;
  identity: AgentCaseIdentity;
  policy: ResolutionAgentPolicy;
  budget: AgentBudget;
  plan: ResolutionAgentPlan | null;
  observation: ResolutionAgentObservation | null;
  caseWalletAddress: string;
  encryptedSecret: EncryptedWalletSecret;
  settledToolIds: ResolutionAgentToolId[];
  currentRunningToolId: ResolutionAgentToolId | null;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const agentStatusSchema = z.enum(AGENT_STATES);

export const agentToolIdSchema = z.enum(AGENT_TOOL_IDS);

export const encryptedWalletSecretSchema = z.object({
  _brand: z.literal("EncryptedWalletSecret"),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
});

export const agentCaseIdentitySchema = z.object({
  escrowPaymentId: z.string().min(1),
  escrowChainId: z.string().min(1),
  escrowContractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address"),
});

export const agentBudgetSchema = z.object({
  approvedAtomic: z.bigint().nonnegative(),
  spentAtomic: z.bigint().nonnegative(),
  reservedAtomic: z.bigint().nonnegative(),
});

export const resolutionAgentPolicySchema = z.object({
  allowedTools: z.array(agentToolIdSchema).min(1),
  approvedBudgetAtomic: z.bigint().positive(),
  expiresAt: z.number().positive(),
  funderAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address"),
});

export const resolutionAgentToolRequestSchema = z.object({
  toolId: agentToolIdSchema,
  priceAtomic: z.bigint().positive(),
  network: z.string().min(1),
  asset: z.string().min(1),
  payTo: z.string().min(1),
  caseVersionHash: z.string().min(1),
  evidenceVersionHash: z.string().min(1),
});
