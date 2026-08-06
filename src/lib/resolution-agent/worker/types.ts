// ---------------------------------------------------------------------------
// Worker Types — lease, recovery, dispatch
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type { ToolExecutionRow } from "../store/types";
import type { ResolutionAgentStore } from "../api/service";
import type { EvidenceRequestRow } from "../store/types";
import type { observeResolutionAgentCase } from "../observation/service";
import type { planResolutionAgentNextAction } from "../planner/service";

// ---------------------------------------------------------------------------
// Runnable agent statuses
// ---------------------------------------------------------------------------

export const RUNNABLE_AGENT_STATUSES = [
  "active",
  "running_tool",
  "waiting_for_evidence",
  "waiting_for_human_approval",
  "failed_recoverable",
] as const;

export type RunnableAgentStatus = (typeof RUNNABLE_AGENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Worker configuration constants
// ---------------------------------------------------------------------------

export const DEFAULT_LEASE_DURATION_MS = 60_000;
export const DEFAULT_LEASE_RENEWAL_THRESHOLD_MS = 30_000;
export const DEFAULT_MAX_ITERATION_MS = 45_000;
export const DEFAULT_MAX_CANDIDATES_TO_SCAN = 5;

// ---------------------------------------------------------------------------
// Candidate for worker processing
// ---------------------------------------------------------------------------

export interface WorkerCandidate {
  agentId: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Lease context (server-only, never exposed in results)
// ---------------------------------------------------------------------------

export interface LeaseContext {
  agentId: string;
  ownerToken: string;
  acquiredAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Action execution result (discriminated union)
// ---------------------------------------------------------------------------

export type ActionExecutionResult =
  | { kind: "executed" }
  | { kind: "recovered"; recoveryOutcome: string }
  | { kind: "waiting"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "stale_plan" }
  | { kind: "unsupported_action"; actionKind: string }
  | { kind: "failed_recoverable"; reason: string }
  | { kind: "failed_safe"; reason: string };

// ---------------------------------------------------------------------------
// Action executor interface (injected DI)
// ---------------------------------------------------------------------------

export interface ResolutionAgentActionExecutor {
  executeOneAction(params: {
    agent: ResolutionAgent;
    plan: ResolutionAgentPlan;
    action: ResolutionAgentNextAction;
    leaseContext: LeaseContext;
    now: number;
  }): Promise<ActionExecutionResult>;
}

// ---------------------------------------------------------------------------
// Recovery decision
// ---------------------------------------------------------------------------

export type RecoveryDecisionKind =
  | "no_recovery_needed"
  | "wait_for_in_flight_execution"
  | "recover_paid_result"
  | "reconcile_settled_execution"
  | "mark_failed_recoverable"
  | "manual_review_required";

export interface RecoveryDecision {
  kind: RecoveryDecisionKind;
  reason: string;
}

// ---------------------------------------------------------------------------
// Recovery handler interface (injected DI)
// ---------------------------------------------------------------------------

export interface ResolutionAgentRecoveryHandler {
  recover(params: {
    agent: ResolutionAgent;
    execution: ToolExecutionRow;
    leaseContext: LeaseContext;
    now: number;
  }): Promise<ActionExecutionResult>;
}

// ---------------------------------------------------------------------------
// Worker dependencies (injected)
// ---------------------------------------------------------------------------

export interface ResolutionAgentWorkerDependencies {
  store: ResolutionAgentStore & {
    listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
    listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
    listRunnableAgents(limit: number): Promise<WorkerCandidate[]>;
    tryAcquireAgentLease(
      agentId: string,
      ownerToken: string,
      now: number,
    ): Promise<LeaseContext | null>;
    renewAgentLease(
      agentId: string,
      ownerToken: string,
      now: number,
    ): Promise<boolean>;
    releaseAgentLease(agentId: string, ownerToken: string): Promise<boolean>;
  };
  observer: typeof observeResolutionAgentCase;
  planner: typeof planResolutionAgentNextAction;
  actionExecutor: ResolutionAgentActionExecutor;
  recoveryHandler: ResolutionAgentRecoveryHandler;
}

// ---------------------------------------------------------------------------
// Worker result (public-safe)
// ---------------------------------------------------------------------------

export interface ResolutionAgentWorkerResult {
  workerIterationId: string;
  agentId: string | null;
  outcome: "processed" | "no_work" | "lease_not_acquired" | "error";
  actionDispatched: ActionExecutionResult | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Secure token generator interface
// ---------------------------------------------------------------------------

export interface SecureTokenGenerator {
  generateToken(): string;
}

export const defaultTokenGenerator: SecureTokenGenerator = {
  generateToken: () => crypto.randomUUID(),
};
