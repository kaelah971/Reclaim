// ---------------------------------------------------------------------------
// Resolution Agent Control Room — status labels, budget formatting, and
// activity descriptions.  Pure functions, no React dependency needed for
// the mapping layer.
// ---------------------------------------------------------------------------

import { formatUSDC } from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Status Label Mapping
// ---------------------------------------------------------------------------

export type AgentStatusLabel =
  | "Draft"
  | "Awaiting funding"
  | "Ready to start"
  | "Agent active"
  | "Running tool"
  | "Waiting for evidence"
  | "Waiting for approval"
  | "Ready for human review"
  | "Budget exhausted"
  | "Expired"
  | "Paused"
  | "Closing"
  | "Closed"
  | "Needs attention";

export function getAgentStatusLabel(rawStatus: string): AgentStatusLabel {
  switch (rawStatus) {
    case "draft": return "Draft";
    case "awaiting_funding": return "Awaiting funding";
    case "funded": return "Ready to start";
    case "awaiting_activation": return "Ready to start";
    case "active": return "Agent active";
    case "running_tool": return "Running tool";
    case "waiting_for_evidence": return "Waiting for evidence";
    case "waiting_for_human_approval": return "Waiting for approval";
    case "ready_for_human_review": return "Ready for human review";
    case "budget_exhausted": return "Budget exhausted";
    case "expired": return "Expired";
    case "paused": return "Paused";
    case "closing": return "Closing";
    case "closed": return "Closed";
    case "failed_recoverable": return "Needs attention";
    default: return "Draft";
  }
}

export function getAgentStatusVariant(
  rawStatus: string,
): "protected" | "disputed" | "pending" | "settled" | "submitted" | "missing" | "verified" {
  switch (rawStatus) {
    case "active":
    case "running_tool":
      return "protected";
    case "waiting_for_evidence":
    case "waiting_for_human_approval":
      return "pending";
    case "ready_for_human_review":
      return "settled";
    case "budget_exhausted":
    case "expired":
      return "disputed";
    case "paused":
      return "missing";
    case "failed_recoverable":
      return "disputed";
    case "closed":
      return "settled";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Budget Formatting
// ---------------------------------------------------------------------------

export interface FormattedBudget {
  approved: string;
  spent: string;
  reserved: string;
  remaining: string;
}

export function formatAgentBudget(
  approvedAtomic: string,
  spentAtomic: string,
  reservedAtomic: string,
  remainingAtomic: string,
): FormattedBudget {
  const toBigInt = (s: string) => {
    try { return BigInt(s); } catch { return BigInt(0); }
  };
  return {
    approved: formatUSDC(toBigInt(approvedAtomic)),
    spent: formatUSDC(toBigInt(spentAtomic)),
    reserved: formatUSDC(toBigInt(reservedAtomic)),
    remaining: formatUSDC(toBigInt(remainingAtomic)),
  };
}

export function computeBudgetPercent(
  spentAtomic: string,
  approvedAtomic: string,
): number {
  const spent = Number(spentAtomic);
  const approved = Number(approvedAtomic);
  if (approved === 0) return 0;
  return Math.round((spent / approved) * 100);
}

// ---------------------------------------------------------------------------
// Activity Description
// ---------------------------------------------------------------------------

export function getActivityDescription(
  status: string,
  currentRunningToolId: string | null,
): string {
  if (currentRunningToolId) {
    switch (currentRunningToolId) {
      case "evidence-quality-check":
        return "Checking whether the submitted evidence is strong enough.";
      case "case-refresh":
        return "Reassessing the case after new evidence arrived.";
      case "reclaim-dispute-brief-v1":
        return "Preparing the case for human review.";
      default:
        return "Running an automated check on the case.";
    }
  }

  switch (status) {
    case "draft":
      return "Setting up the resolution agent for this payment case.";
    case "awaiting_funding":
      return "Waiting for the case wallet to be funded with the approved budget.";
    case "funded":
    case "awaiting_activation":
      return "Case wallet is funded. Review the plan and start the agent.";
    case "active":
      return "Assessing the case and deciding what to do next.";
    case "waiting_for_evidence":
      return "Waiting for the requested evidence to be provided.";
    case "waiting_for_human_approval":
      return "Waiting for a person to approve the next step.";
    case "ready_for_human_review":
      return "Case prepared for human review.";
    case "budget_exhausted":
      return "The approved budget has been fully spent. No further automated actions are possible.";
    case "expired":
      return "The case has exceeded its time window.";
    case "paused":
      return "The agent has been paused.";
    case "failed_recoverable":
      return "The agent encountered a problem and needs attention.";
    case "closed":
      return "The resolution case has been closed.";
    default:
      return "Waiting for the agent to start.";
  }
}

// ---------------------------------------------------------------------------
// Timeline event → human-readable label
// ---------------------------------------------------------------------------

export function getEventDisplayLabel(eventType: string): string {
  switch (eventType) {
    case "created": return "Agent created";
    case "status_change": return "Status updated";
    case "case_observed": return "Case observed";
    case "case_version_changed": return "Case changed";
    case "plan_created": return "Plan created";
    case "plan_updated": return "Plan updated";
    case "evidence_request_created": return "Evidence requested";
    case "evidence_request_fulfilled": return "Evidence fulfilled";
    case "evidence_request_already_open": return "Request already pending";
    case "agent_resumed_after_evidence": return "Agent resumed";
    case "agent_resumption_deferred": return "Waiting continues";
    case "agent_resumption_failed": return "Resumption check failed";
    case "tool_execution_recovered": return "Tool execution recovered";
    case "tool_execution_recovery_failed": return "Recovery failed";
    default: return eventType.replace(/_/g, " ");
  }
}
