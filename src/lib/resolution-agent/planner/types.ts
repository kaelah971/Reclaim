// ---------------------------------------------------------------------------
// Planner Types — additive (do not modify existing ResolutionAgent types)
// ---------------------------------------------------------------------------

import type {
  ResolutionAgent,
  ResolutionAgentToolId,
  ResolutionAgentToolRequest,
  ResolutionAgentPlan,
} from "../types";
import type { CaseObservationResult } from "../observation/types";
import type { ToolExecutionRow, EvidenceRequestRow } from "../store/types";

// ---------------------------------------------------------------------------
// Planner reason codes
// ---------------------------------------------------------------------------

export type PlannerReasonCode =
  | "agent_not_active"
  | "agent_paused"
  | "agent_closed"
  | "agent_expired"
  | "tool_already_running"
  | "awaiting_existing_paid_result"
  | "evidence_missing"
  | "evidence_request_already_open"
  | "evidence_quality_check_required"
  | "evidence_gaps_found"
  | "evidence_changed_refresh_required"
  | "unresolved_gaps_after_refresh"
  | "dispute_brief_required"
  | "dispute_brief_ready"
  | "insufficient_budget"
  | "no_meaningful_change"
  | "ready_for_human_review";

// ---------------------------------------------------------------------------
// Discriminated next action union
// ---------------------------------------------------------------------------

export type ResolutionAgentNextAction =
  | {
      kind: "run_tool";
      toolId: ResolutionAgentToolId;
      reason: PlannerReasonCode;
      toolRequest: ResolutionAgentToolRequest;
    }
  | {
      kind: "create_evidence_request";
      responsibleParty: "client" | "worker";
      evidenceItem: string;
      reason: string;
      plannerReason: PlannerReasonCode;
    }
  | {
      kind: "wait_for_evidence";
      evidenceRequestIds: string[];
      caseVersionHash: string;
      evidenceVersionHash: string;
      reason: PlannerReasonCode;
    }
  | {
      kind: "ready_for_human_review";
      caseVersionHash: string;
      disputeBriefReference: string | null;
      reason: PlannerReasonCode;
    }
  | {
      kind: "budget_exhausted";
      reason: PlannerReasonCode;
    }
  | {
      kind: "waiting_for_human_approval";
      reason: PlannerReasonCode;
    }
  | {
      kind: "no_action";
      reason: PlannerReasonCode;
    };

// ---------------------------------------------------------------------------
// Normalized tool outcomes (planner-facing summaries only)
// ---------------------------------------------------------------------------

export interface EvidenceQualityOutcome {
  evidenceVersionHash: string;
  readiness: "ready" | "needs_improvement" | "insufficient";
  missingEvidence: string[];
  ambiguities: string[];
  recommendedImprovements: string[];
  reviewerQuestions: string[];
  executionStatus: "settled" | "pending" | "failed";
}

export interface CaseRefreshOutcome {
  caseVersionHash: string;
  readiness: "ready" | "needs_evidence" | "needs_clarification";
  unresolvedEvidenceGaps: string[];
  newQuestions: string[];
  executionStatus: "settled" | "pending" | "failed";
}

export interface DisputeBriefOutcome {
  caseVersionHash: string;
  reviewerPacketReady: boolean;
  resultReference: string | null;
  executionStatus: "settled" | "pending" | "failed";
}

export type NormalizedToolOutcome =
  | { kind: "evidence_quality"; outcome: EvidenceQualityOutcome }
  | { kind: "case_refresh"; outcome: CaseRefreshOutcome }
  | { kind: "dispute_brief"; outcome: DisputeBriefOutcome };

// ---------------------------------------------------------------------------
// Planner input / output
// ---------------------------------------------------------------------------

export interface ResolutionAgentPlannerInput {
  agent: ResolutionAgent;
  observationResult: CaseObservationResult;
  toolExecutions: ToolExecutionRow[];
  evidenceRequests: EvidenceRequestRow[];
  now: number;
}

export interface ResolutionAgentPlanningResult {
  agentId: string;
  plan: ResolutionAgentPlan;
  nextAction: ResolutionAgentNextAction;
  reasonCode: PlannerReasonCode;
  caseVersionHash: string;
  evidenceVersionHash: string;
  persisted: boolean;
}
