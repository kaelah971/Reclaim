import type {
  ResolutionAgent,
  ResolutionAgentToolRequest,
  ResolutionAgentToolExecutionDecision,
  PolicyDecision,
} from "./types";
import { getToolDefinition, isToolAllowlisted } from "./tools";
import { getRemainingBudget } from "./budget";

// ---------------------------------------------------------------------------
// Policy Engine — evaluate whether a tool execution is allowed
// ---------------------------------------------------------------------------

export function evaluateToolExecution(
  agent: ResolutionAgent,
  toolRequest: ResolutionAgentToolRequest,
  now: number,
): ResolutionAgentToolExecutionDecision {
  const makeDecision = (decision: PolicyDecision): ResolutionAgentToolExecutionDecision => ({
    decision,
    evaluatedAt: now,
  });

  // Agent status checks
  if (agent.status !== "active") {
    if (agent.status === "expired") return makeDecision({ kind: "agent_expired" });
    if (agent.status === "paused") return makeDecision({ kind: "agent_paused" });
    if (agent.status === "closing") return makeDecision({ kind: "agent_closing" });
    if (agent.status === "closed") return makeDecision({ kind: "agent_closed" });
    return makeDecision({ kind: "agent_not_active" });
  }

  // Expiry check
  if (agent.policy.expiresAt <= now) {
    return makeDecision({ kind: "agent_expired" });
  }

  // Concurrency check — no other tool already running
  if (agent.currentRunningToolId !== null) {
    return makeDecision({ kind: "already_running" });
  }

  // Tool allowlist check
  if (!isToolAllowlisted(toolRequest.toolId)) {
    return makeDecision({
      kind: "tool_not_allowlisted",
      requestedToolId: toolRequest.toolId,
    });
  }

  // Get canonical tool definition
  const toolDef = getToolDefinition(toolRequest.toolId);
  if (!toolDef) {
    return makeDecision({
      kind: "tool_not_allowlisted",
      requestedToolId: toolRequest.toolId,
    });
  }

  // Canonical price check
  if (toolRequest.priceAtomic !== toolDef.priceAtomic) {
    return makeDecision({
      kind: "invalid_price",
      expected: toolDef.priceAtomic,
      received: toolRequest.priceAtomic,
    });
  }

  // Canonical network check
  if (toolRequest.network !== toolDef.network) {
    return makeDecision({
      kind: "invalid_network",
      expected: toolDef.network,
      received: toolRequest.network,
    });
  }

  // Canonical asset check
  if (toolRequest.asset !== toolDef.asset) {
    return makeDecision({
      kind: "invalid_asset",
      expected: toolDef.asset,
      received: toolRequest.asset,
    });
  }

  // Canonical payTo check
  if (toolRequest.payTo !== toolDef.payTo) {
    return makeDecision({
      kind: "invalid_recipient",
      expected: toolDef.payTo,
      received: toolRequest.payTo,
    });
  }

  // Duplicate settlement check
  if (agent.settledToolIds.includes(toolRequest.toolId)) {
    return makeDecision({ kind: "already_settled" });
  }

  // Budget sufficiency check
  const remaining = getRemainingBudget(agent.budget);
  if (remaining < toolRequest.priceAtomic) {
    return makeDecision({
      kind: "insufficient_budget",
      remaining,
      requested: toolRequest.priceAtomic,
    });
  }

  // Evidence requirement check
  if (toolDef.requiresEvidence) {
    const observation = agent.observation;
    if (!observation || observation.evidenceCount === 0) {
      return makeDecision({ kind: "evidence_required" });
    }
  }

  // Meaningful change requirement check
  if (toolDef.requiresMeaningfulChange) {
    const observation = agent.observation;
    if (!observation || !observation.hasMeaningfulChange) {
      return makeDecision({ kind: "meaningful_change_required" });
    }
  }

  // All checks passed
  return makeDecision({ kind: "allowed" });
}
