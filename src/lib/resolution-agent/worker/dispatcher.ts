// ---------------------------------------------------------------------------
// Control-only Action Dispatcher — handles non-payment agent lifecycle
// transitions that the worker can perform without external tool adapters.
//
// All "run_tool" and "create_evidence_request" actions return
// "unsupported_action" — no real tool execution occurs in this phase.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type {
  LeaseContext,
  ActionExecutionResult,
  ResolutionAgentActionExecutor,
} from "./types";
import type { ResolutionAgentStore } from "../api/service";
import { transitionAgentStatus, type TransitionContext } from "../state-machine";

// ---------------------------------------------------------------------------
// Dispatch a control-only action
// ---------------------------------------------------------------------------

export async function dispatchControlAction(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction;
  leaseContext: LeaseContext;
  now: number;
  store: ResolutionAgentStore;
  executor: ResolutionAgentActionExecutor;
}): Promise<{ result: ActionExecutionResult; agent: ResolutionAgent }> {
  const { agent, action, now, store } = params;
  const transitionCtx: TransitionContext = { now };

  switch (action.kind) {
    // -----------------------------------------------------------------------
    // No action — just skip
    // -----------------------------------------------------------------------
    case "no_action":
      return {
        result: { kind: "skipped", reason: "Planner indicated no action is needed" },
        agent,
      };

    // -----------------------------------------------------------------------
    // Budget exhausted — transition if valid
    // -----------------------------------------------------------------------
    case "budget_exhausted": {
      if (agent.status === "budget_exhausted") {
        return {
          result: { kind: "skipped", reason: "Agent is already in budget_exhausted state" },
          agent,
        };
      }
      const version = await store.getAgentVersion(agent.id);
      const updated = transitionAgentStatus(agent, "budget_exhausted", transitionCtx);
      await store.updateAgent(updated, version);
      await store.appendEvent(
        agent.id,
        "status_change",
        "Worker transitioned agent to budget_exhausted",
        agent.status,
        updated.status,
      );
      return { result: { kind: "executed" }, agent: updated };
    }

    // -----------------------------------------------------------------------
    // Waiting for human approval — transition if valid
    // -----------------------------------------------------------------------
    case "waiting_for_human_approval": {
      if (agent.status === "waiting_for_human_approval") {
        return {
          result: { kind: "skipped", reason: "Agent is already awaiting human approval" },
          agent,
        };
      }
      const version = await store.getAgentVersion(agent.id);
      const updated = transitionAgentStatus(agent, "waiting_for_human_approval", transitionCtx);
      await store.updateAgent(updated, version);
      await store.appendEvent(
        agent.id,
        "status_change",
        "Worker transitioned agent to waiting_for_human_approval",
        agent.status,
        updated.status,
      );
      return { result: { kind: "executed" }, agent: updated };
    }

    // -----------------------------------------------------------------------
    // Ready for human review — transition, do NOT settle escrow
    // -----------------------------------------------------------------------
    case "ready_for_human_review": {
      if (agent.status === "ready_for_human_review") {
        return {
          result: { kind: "skipped", reason: "Agent is already ready for human review" },
          agent,
        };
      }
      const version = await store.getAgentVersion(agent.id);
      const updated = transitionAgentStatus(agent, "ready_for_human_review", transitionCtx);
      await store.updateAgent(updated, version);
      await store.appendEvent(
        agent.id,
        "status_change",
        "Case is ready for human review — agent stops here",
        agent.status,
        updated.status,
      );
      return { result: { kind: "executed" }, agent: updated };
    }

    // -----------------------------------------------------------------------
    // Wait for evidence — no state change (Task 11 handles this)
    // -----------------------------------------------------------------------
    case "wait_for_evidence":
      return {
        result: { kind: "waiting", reason: "Waiting for evidence — no state change" },
        agent,
      };

    // -----------------------------------------------------------------------
    // Create evidence request — unsupported (Task 11 handles this)
    // -----------------------------------------------------------------------
    case "create_evidence_request":
      return {
        result: { kind: "unsupported_action", actionKind: "create_evidence_request" },
        agent,
      };

    // -----------------------------------------------------------------------
    // Run tool — unsupported (no real adapters exist yet)
    // -----------------------------------------------------------------------
    case "run_tool":
      return {
        result: { kind: "unsupported_action", actionKind: "run_tool" },
        agent,
      };

    // -----------------------------------------------------------------------
    // Unknown action — fallback
    // -----------------------------------------------------------------------
    default:
      return {
        result: {
          kind: "unsupported_action",
          actionKind: (action as { kind: string }).kind ?? "unknown",
        },
        agent,
      };
  }
}

// ---------------------------------------------------------------------------
// Stale-plan detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the plan that produced the proposed next action is stale
 * relative to the agent's current observation.
 *
 * A plan is stale when:
 *  - The agent has no observation (nothing to compare against), OR
 *  - The observation's caseVersionHash differs from the plan's, OR
 *  - The observation's evidenceVersionHash differs from the plan's
 */
export function isPlanStale(params: {
  agent: ResolutionAgent;
  planVersion: number;
  caseVersionHash: string;
  evidenceVersionHash: string;
}): boolean {
  const { agent, caseVersionHash, evidenceVersionHash } = params;

  if (!agent.observation) {
    return true;
  }

  if (agent.observation.caseVersionHash !== caseVersionHash) {
    return true;
  }

  if (agent.observation.evidenceVersionHash !== evidenceVersionHash) {
    return true;
  }

  return false;
}
