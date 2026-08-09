// ---------------------------------------------------------------------------
// Control-only Action Dispatcher — handles non-payment agent lifecycle
// transitions that the worker can perform without external tool adapters.
//
// "run_tool" actions return "unsupported_action" — no real tool execution
// occurs in this phase (handled by the executor registry).
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type {
  LeaseContext,
  ActionExecutionResult,
  ResolutionAgentActionExecutor,
} from "./types";
import type { ResolutionAgentStore } from "../api/service";
import type { EvidenceRequestRow } from "../store/types";
import { transitionAgentStatus, type TransitionContext } from "../state-machine";
import { executeCreateEvidenceRequest, executeWaitForEvidence } from "../evidence-request/service";
import type { EvidenceRequestStore } from "../evidence-request/types";

// ---------------------------------------------------------------------------
// Dispatch a control-only action
// ---------------------------------------------------------------------------

/**
 * Extended store shape accepted by dispatchControlAction.
 * Must support evidence-request operations in addition to the
 * standard ResolutionAgentStore interface.
 */
export type DispatchStore = ResolutionAgentStore & {
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
  createEvidenceRequest(
    agentId: string,
    responsibleParty: "client" | "worker",
    evidenceItem: string,
    reason: string,
    caseVersionHash?: string,
    evidenceVersionHash?: string,
  ): Promise<EvidenceRequestRow>;
};

export async function dispatchControlAction(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction;
  leaseContext: LeaseContext;
  now: number;
  store: DispatchStore;
  executor: ResolutionAgentActionExecutor;
}): Promise<{ result: ActionExecutionResult; agent: ResolutionAgent }> {
  const { agent, plan, action, leaseContext, now, store } = params;
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
    // Wait for evidence — delegate to evidence-request service
    // -----------------------------------------------------------------------
    case "wait_for_evidence":
      return executeWaitForEvidence({
        agent,
        plan,
        action,
        leaseContext,
        now,
        store: store as EvidenceRequestStore,
      });

    // -----------------------------------------------------------------------
    // Create evidence request — delegate to evidence-request service
    // -----------------------------------------------------------------------
    case "create_evidence_request":
      return executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext,
        now,
        store: store as EvidenceRequestStore,
      });

    // -----------------------------------------------------------------------
    // Run tool — delegate to the injected action executor (real adapters).
    // The executor re-validates policy/budget at execution time and is
    // responsible for the full paid-tool lifecycle (reserve → settle →
    // verify → generate → persist). Falls back to unsupported_action when
    // no executor is wired (defensive only).
    // -----------------------------------------------------------------------
    case "run_tool": {
      if (params.executor) {
        const result = await params.executor.executeOneAction({
          agent,
          plan,
          action,
          leaseContext,
          now,
        });
        return { result, agent };
      }
      return {
        result: { kind: "unsupported_action", actionKind: "run_tool" },
        agent,
      };
    }

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
