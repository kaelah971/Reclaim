// ---------------------------------------------------------------------------
// Planner Service — main entry point for resolution agent planning.
//
// Reads agent state, tool executions, and evidence requests; evaluates
// deterministic rules; builds/updates the plan; persists with optimistic
// concurrency.
//
// IMPORTANT: This service does NOT:
//   - Change lifecycle status
//   - Create evidence-request rows
//   - Create tool-execution rows
//   - Reserve budget
//   - Decrypt wallet
//   - Call RPC
//   - Call DeepSeek
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan, ResolutionAgentPlanStep } from "../types";
import type { CaseObservationResult, CaseObservation, CaseChangeSummary } from "../observation/types";
import type { ToolExecutionRow, EvidenceRequestRow } from "../store/types";
import type { ResolutionAgentStore } from "../api/service";
import type {
  ResolutionAgentPlannerInput,
  ResolutionAgentNextAction,
  ResolutionAgentPlanningResult,
  PlannerReasonCode,
} from "./types";
import { ALL_PLANNER_RULES } from "./rules";
import {
  ResolutionAgentMissingObservationError,
  ResolutionAgentPlannerConcurrencyError,
} from "./errors";
import { ResolutionAgentNotFoundError } from "../store/errors";

// ---------------------------------------------------------------------------
// Store type for planner (includes list methods)
// ---------------------------------------------------------------------------

export type PlannerStore = ResolutionAgentStore & {
  listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
};

// ---------------------------------------------------------------------------
// Helper: build a minimal CaseObservationResult from agent observation
// ---------------------------------------------------------------------------

function buildObservationResult(
  agent: ResolutionAgent,
): CaseObservationResult {
  const obs = agent.observation!;
  const minimalObservation: CaseObservation = {
    schemaVersion: "reclaim-case-observation-v1",
    caseIdentity: {
      escrowChainId: agent.identity.escrowChainId,
      escrowContractAddress: agent.identity.escrowContractAddress,
      escrowPaymentId: agent.identity.escrowPaymentId,
    },
    escrow: {
      paymentId: agent.identity.escrowPaymentId,
      client: "",
      worker: "",
      token: "",
      amount: "0",
      agreementLabel: "",
      deliverableSummary: "",
      deliveryFormat: "",
      releaseRule: "",
      evidenceExpectation: "",
      termsHash: "",
      evidenceReference: "",
      disputeReference: "",
      deliveryDeadline: 0,
      autoReleaseSeconds: 0,
      disputeWindowSeconds: 0,
      state: obs.escrowState as CaseObservation["escrow"]["state"],
      createdAt: 0,
      fundedAt: 0,
      acceptedAt: 0,
      deliveryAt: 0,
      releaseRequestedAt: 0,
      releasedAt: 0,
    },
    evidence: {
      evidenceReference: null,
      title: null,
      evidenceType: null,
      description: null,
      relatedDeliverable: null,
      externalReference: null,
      fileCount: obs.evidenceCount,
      latestUpdateTimestamp: obs.observedAt,
      availability: obs.evidenceCount > 0 ? "package_available" : "none",
      substantiveEvidence: obs.evidenceCount > 0,
    },
    priorContext: {
      agentStatus: agent.status,
      openEvidenceRequests: [],
      fulfilledEvidenceRequests: [],
      settledToolResults: [],
      previousCaseVersionHash: agent.plan?.caseVersionHash ?? null,
      previousEvidenceVersionHash: agent.plan?.evidenceVersionHash ?? null,
    },
    observedAt: obs.observedAt,
  };

  const changeSummary: CaseChangeSummary = {
    caseChanged: obs.hasMeaningfulChange,
    evidenceChanged: obs.hasMeaningfulChange,
    firstObservation: agent.plan === null,
    changeType: obs.hasMeaningfulChange ? "evidence_changed" : "no_meaningful_change",
    reason: obs.hasMeaningfulChange ? "Evidence or state has changed" : "No meaningful change detected",
  };

  return {
    agentId: agent.id,
    observation: minimalObservation,
    evidenceVersionHash: obs.evidenceVersionHash,
    caseVersionHash: obs.caseVersionHash,
    changeSummary,
    persisted: true,
  };
}

// ---------------------------------------------------------------------------
// Helper: evaluate all rules — return first matching action
// ---------------------------------------------------------------------------

function evaluateRules(input: ResolutionAgentPlannerInput): ResolutionAgentNextAction | null {
  for (const rule of ALL_PLANNER_RULES) {
    const action = rule(input);
    if (action !== null) return action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: default action for terminal / special states
// ---------------------------------------------------------------------------

function defaultAction(agent: ResolutionAgent): ResolutionAgentNextAction | null {
  const observation = agent.observation;
  const caseHash = observation?.caseVersionHash ?? "";

  if (agent.status === "ready_for_human_review") {
    return {
      kind: "ready_for_human_review",
      caseVersionHash: caseHash,
      disputeBriefReference: null,
      reason: "ready_for_human_review",
    };
  }

  if (agent.status === "budget_exhausted") {
    return {
      kind: "budget_exhausted",
      reason: "insufficient_budget",
    };
  }

  if (agent.status === "waiting_for_human_approval") {
    return {
      kind: "waiting_for_human_approval",
      reason: "ready_for_human_review",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper: build plan from next action
// ---------------------------------------------------------------------------

function buildPlanFromAction(
  agent: ResolutionAgent,
  nextAction: ResolutionAgentNextAction,
  now: number,
): ResolutionAgentPlan {
  const observation = agent.observation!;
  const steps: ResolutionAgentPlanStep[] = [];
  const currentStepIndex = 0;

  switch (nextAction.kind) {
    case "run_tool": {
      const toolId = nextAction.toolId;
      if (toolId === "evidence-quality-check") {
        steps.push({
          kind: "purchase_evidence_check",
          description: "Run evidence quality check to assess review readiness",
          toolId: "evidence-quality-check",
        });
      } else if (toolId === "case-refresh") {
        steps.push({
          kind: "purchase_case_refresh",
          description: "Refresh case snapshot after meaningful change",
          toolId: "case-refresh",
        });
      } else if (toolId === "reclaim-dispute-brief-v1") {
        steps.push({
          kind: "purchase_dispute_brief",
          description: "Produce reviewer-ready case packet",
          toolId: "reclaim-dispute-brief-v1",
        });
      }
      break;
    }
    case "create_evidence_request": {
      steps.push({
        kind: "request_evidence",
        description: `Request evidence: ${nextAction.evidenceItem} from ${nextAction.responsibleParty}`,
      });
      steps.push({
        kind: "wait_for_evidence",
        description: "Wait for requested evidence to be provided",
      });
      break;
    }
    case "wait_for_evidence": {
      steps.push({
        kind: "wait_for_evidence",
        description: "Waiting for open evidence requests to be fulfilled",
      });
      break;
    }
    case "ready_for_human_review": {
      steps.push({
        kind: "finalize",
        description: "Case is ready for human review",
      });
      break;
    }
    case "budget_exhausted": {
      steps.push({
        kind: "finalize",
        description: "Budget exhausted — no further automated actions possible",
      });
      break;
    }
    case "waiting_for_human_approval": {
      steps.push({
        kind: "wait_for_human_approval",
        description: "Awaiting human approval to proceed",
      });
      break;
    }
    case "no_action": {
      steps.push({
        kind: "check_evidence",
        description: "No action — waiting for conditions to change",
      });
      break;
    }
  }

  return {
    steps,
    currentStepIndex,
    lastUpdated: now,
    caseVersionHash: observation.caseVersionHash,
    evidenceVersionHash: observation.evidenceVersionHash,
  };
}

// ---------------------------------------------------------------------------
// Helper: detect whether the planning result changed from what's stored
// ---------------------------------------------------------------------------

function hasPlanChanged(
  existingPlan: ResolutionAgentPlan | null,
  newPlan: ResolutionAgentPlan,
  existingNextAction: ResolutionAgentNextAction | null,
  newNextAction: ResolutionAgentNextAction,
): boolean {
  if (existingPlan === null) return true;

  if (
    existingPlan.caseVersionHash !== newPlan.caseVersionHash ||
    existingPlan.evidenceVersionHash !== newPlan.evidenceVersionHash
  ) {
    return true;
  }

  // Compare next action kinds — if the kind or key fields changed, it's a change
  if (!existingNextAction) return true;
  if (existingNextAction.kind !== newNextAction.kind) return true;

  if (existingNextAction.kind === "run_tool" && newNextAction.kind === "run_tool") {
    return existingNextAction.toolId !== newNextAction.toolId;
  }

  // For non-run_tool actions, compare reason
  return existingNextAction.reason !== newNextAction.reason;
}

// ---------------------------------------------------------------------------
// Helper: extract the next action from an existing plan (best-effort)
// ---------------------------------------------------------------------------

function inferNextActionFromPlan(
  agent: ResolutionAgent,
): ResolutionAgentNextAction | null {
  const plan = agent.plan;
  if (!plan || plan.steps.length === 0) return null;

  const currentStep = plan.steps[plan.currentStepIndex];
  if (!currentStep) return null;

  const observation = agent.observation;
  const caseHash = observation?.caseVersionHash ?? "";
  const evidenceHash = observation?.evidenceVersionHash ?? "";

  switch (currentStep.kind) {
    case "purchase_evidence_check":
      return {
        kind: "run_tool",
        toolId: "evidence-quality-check",
        reason: "evidence_quality_check_required",
        toolRequest: {
          toolId: "evidence-quality-check",
          priceAtomic: 10000n,
          network: "eip155:42220",
          asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
          payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
          caseVersionHash: caseHash,
          evidenceVersionHash: evidenceHash,
        },
      };
    case "purchase_case_refresh":
      return {
        kind: "run_tool",
        toolId: "case-refresh",
        reason: "evidence_changed_refresh_required",
        toolRequest: {
          toolId: "case-refresh",
          priceAtomic: 10000n,
          network: "eip155:42220",
          asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
          payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
          caseVersionHash: caseHash,
          evidenceVersionHash: evidenceHash,
        },
      };
    case "purchase_dispute_brief":
      return {
        kind: "run_tool",
        toolId: "reclaim-dispute-brief-v1",
        reason: "dispute_brief_required",
        toolRequest: {
          toolId: "reclaim-dispute-brief-v1",
          priceAtomic: 10000n,
          network: "eip155:42220",
          asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
          payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
          caseVersionHash: caseHash,
          evidenceVersionHash: evidenceHash,
        },
      };
    case "request_evidence":
      return {
        kind: "create_evidence_request",
        responsibleParty: "worker",
        evidenceItem: currentStep.description,
        reason: currentStep.description,
        plannerReason: "evidence_gaps_found",
      };
    case "wait_for_evidence":
      return {
        kind: "wait_for_evidence",
        evidenceRequestIds: [],
        caseVersionHash: caseHash,
        evidenceVersionHash: evidenceHash,
        reason: "evidence_request_already_open",
      };
    case "wait_for_human_approval":
      return {
        kind: "waiting_for_human_approval",
        reason: "ready_for_human_review",
      };
    case "finalize":
      return {
        kind: "ready_for_human_review",
        caseVersionHash: caseHash,
        disputeBriefReference: null,
        reason: "ready_for_human_review",
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API: planResolutionAgentNextAction
// ---------------------------------------------------------------------------

export async function planResolutionAgentNextAction(params: {
  agentId: string;
  now: number;
  store: PlannerStore;
}): Promise<ResolutionAgentPlanningResult> {
  const { agentId, now, store } = params;

  // 1. Load agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Verify observation
  if (!agent.observation) {
    throw new ResolutionAgentMissingObservationError(
      "Agent has no observation — cannot plan without case state",
      "MISSING_OBSERVATION",
    );
  }

  // 3. Load tool executions and evidence requests
  const [toolExecutions, evidenceRequests] = await Promise.all([
    store.listToolExecutions(agentId),
    store.listEvidenceRequests(agentId),
  ]);

  // 4. Build planner input
  const observationResult = buildObservationResult(agent);
  const input: ResolutionAgentPlannerInput = {
    agent,
    observationResult,
    toolExecutions,
    evidenceRequests,
    now,
  };

  // 5. Evaluate rules
  const evaluatedAction = evaluateRules(input);

  // 6. Default handler for terminal/special states
  const nextAction: ResolutionAgentNextAction =
    evaluatedAction ??
    defaultAction(agent) ??
    { kind: "no_action", reason: "agent_not_active" as PlannerReasonCode };

  const reasonCode: PlannerReasonCode = nextAction.reason as PlannerReasonCode;

  // 7. Build plan
  const newPlan = buildPlanFromAction(agent, nextAction, now);

  // 8. Detect change
  const existingNextAction = inferNextActionFromPlan(agent);
  const changed = hasPlanChanged(agent.plan, newPlan, existingNextAction, nextAction);

  let persisted = false;

  // 9. Persist only if changed
  if (changed) {
    const version = await store.getAgentVersion(agentId);
    const updatedAgent: ResolutionAgent = {
      ...agent,
      plan: newPlan,
      updatedAt: now,
    };

    try {
      await store.updateAgent(updatedAgent, version);
      persisted = true;
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("Concurrency") ||
          (err as unknown as Record<string, unknown>).code === "CONCURRENCY_CONFLICT")
      ) {
        throw new ResolutionAgentPlannerConcurrencyError(
          "Optimistic concurrency conflict during plan persistence",
          "CONCURRENCY_CONFLICT",
        );
      }
      throw err;
    }

    // 10. Append event on plan change
    const isFirstPlan = agent.plan === null;
    if (isFirstPlan) {
      await store.appendEvent(
        agentId,
        "plan_created",
        `Initial plan created: ${nextAction.kind}`,
        agent.status,
        agent.status,
        { nextActionKind: nextAction.kind, reason: reasonCode },
      );
    } else {
      await store.appendEvent(
        agentId,
        "plan_updated",
        `Plan updated: ${nextAction.kind} — ${reasonCode}`,
        agent.status,
        agent.status,
        {
          nextActionKind: nextAction.kind,
          reason: reasonCode,
          previousCaseHash: agent.plan?.caseVersionHash,
          newCaseHash: newPlan.caseVersionHash,
          previousEvidenceHash: agent.plan?.evidenceVersionHash,
          newEvidenceHash: newPlan.evidenceVersionHash,
        },
      );
    }
  }

  // 11. Return result
  return {
    agentId,
    plan: persisted ? newPlan : (agent.plan ?? newPlan),
    nextAction,
    reasonCode,
    caseVersionHash: agent.observation.caseVersionHash,
    evidenceVersionHash: agent.observation.evidenceVersionHash,
    persisted,
  };
}
