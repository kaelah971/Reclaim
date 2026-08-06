// ---------------------------------------------------------------------------
// Planner Rules — pure, deterministic functions evaluated in priority order.
// Each returns null to fall through to the next rule.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentToolId, ResolutionAgentToolRequest } from "../types";
import type {
  ResolutionAgentPlannerInput,
  ResolutionAgentNextAction,
  NormalizedToolOutcome,
  EvidenceQualityOutcome,
} from "./types";
import type { ToolExecutionRow, EvidenceRequestRow } from "../store/types";
import { evaluateToolExecution } from "../policy";
import { getRemainingBudget } from "../budget";
import { getToolDefinition } from "../tools";

// ---------------------------------------------------------------------------
// Non-executable statuses (cannot run paid actions)
// ---------------------------------------------------------------------------

const NON_EXECUTABLE_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "awaiting_funding",
  "funded",
  "awaiting_activation",
  "paused",
  "expired",
  "closing",
  "closed",
  "failed_recoverable",
]);

const IN_FLIGHT_STATES: ReadonlySet<string> = new Set([
  "pending",
  "paid_pending_result",
]);

// ---------------------------------------------------------------------------
// Rule 1: nonExecutableAgent
// ---------------------------------------------------------------------------

export function nonExecutableAgent(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { status } = input.agent;

  if (!NON_EXECUTABLE_STATUSES.has(status)) return null;

  let reason: import("./types").PlannerReasonCode;
  if (status === "paused") reason = "agent_paused";
  else if (status === "expired") reason = "agent_expired";
  else if (status === "closing" || status === "closed") reason = "agent_closed";
  else reason = "agent_not_active";

  return { kind: "no_action", reason };
}

// ---------------------------------------------------------------------------
// Rule 2: existingInFlightTool
// ---------------------------------------------------------------------------

export function existingInFlightTool(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions } = input;

  if (agent.currentRunningToolId !== null || agent.status === "running_tool") {
    return { kind: "no_action", reason: "tool_already_running" };
  }

  const hasInFlight = toolExecutions.some((te) => IN_FLIGHT_STATES.has(te.state));
  if (hasInFlight) {
    return { kind: "no_action", reason: "awaiting_existing_paid_result" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rule 3: noEvidence
// ---------------------------------------------------------------------------

export function noEvidence(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent } = input;
  const observation = agent.observation;
  if (!observation) return null;

  if (observation.evidenceCount > 0) return null;

  return {
    kind: "create_evidence_request",
    responsibleParty: "worker",
    evidenceItem: "Initial evidence submission for this case",
    reason: "No evidence has been submitted yet. Worker must provide evidence to proceed.",
    plannerReason: "evidence_missing",
  };
}

// ---------------------------------------------------------------------------
// Rule 4: openEvidenceRequest
// ---------------------------------------------------------------------------

export function openEvidenceRequest(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { evidenceRequests, agent } = input;

  const openRequests = evidenceRequests.filter((er) => er.status === "open");
  if (openRequests.length === 0) return null;

  const observation = agent.observation;
  const caseHash = observation?.caseVersionHash ?? "";
  const evidenceHash = observation?.evidenceVersionHash ?? "";

  return {
    kind: "wait_for_evidence",
    evidenceRequestIds: openRequests.map((er) => er.id),
    caseVersionHash: caseHash,
    evidenceVersionHash: evidenceHash,
    reason: "evidence_request_already_open",
  };
}

// ---------------------------------------------------------------------------
// Helper: build canonical tool request
// ---------------------------------------------------------------------------

export function buildToolRequestIdentity(
  agent: ResolutionAgent,
  toolId: string,
  caseHash: string,
  evidenceHash: string,
): ResolutionAgentToolRequest {
  const def = getToolDefinition(toolId as ResolutionAgentToolId);
  if (!def) {
    throw new Error(`Cannot build tool request: unknown tool "${toolId}"`);
  }

  return {
    toolId: def.id,
    priceAtomic: def.priceAtomic,
    network: def.network,
    asset: def.asset,
    payTo: def.payTo,
    caseVersionHash: caseHash,
    evidenceVersionHash: evidenceHash,
  };
}

// ---------------------------------------------------------------------------
// Rule 5: evidenceQualityCheckRequired
// ---------------------------------------------------------------------------

export function evidenceQualityCheckRequired(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions, now } = input;
  const observation = agent.observation;
  if (!observation) return null;

  // No evidence to check
  if (observation.evidenceCount === 0) return null;

  const currentEvidenceHash = observation.evidenceVersionHash;

  // Check if a settled quality check exists for current evidence hash
  const settledQC = toolExecutions.find(
    (te) =>
      te.tool_identifier === "evidence-quality-check" &&
      te.state === "settled" &&
      te.evidence_version_hash === currentEvidenceHash,
  );
  if (settledQC) return null;

  // Check if a pending quality check already exists
  const pendingQC = toolExecutions.find(
    (te) =>
      te.tool_identifier === "evidence-quality-check" &&
      IN_FLIGHT_STATES.has(te.state),
  );
  if (pendingQC) return null;

  // Budget check
  const toolDef = getToolDefinition("evidence-quality-check");
  if (!toolDef) return null;
  const remaining = getRemainingBudget(agent.budget);
  if (remaining < toolDef.priceAtomic) return null;

  // Policy check
  const toolRequest = buildToolRequestIdentity(
    agent,
    "evidence-quality-check",
    observation.caseVersionHash,
    currentEvidenceHash,
  );
  const policyResult = evaluateToolExecution(agent, toolRequest, now);
  if (policyResult.decision.kind !== "allowed") return null;

  return {
    kind: "run_tool",
    toolId: "evidence-quality-check",
    reason: "evidence_quality_check_required",
    toolRequest,
  };
}

// ---------------------------------------------------------------------------
// Helper: normalize tool result data
// ---------------------------------------------------------------------------

export function normalizeToolOutcome(
  execution: ToolExecutionRow,
): NormalizedToolOutcome | null {
  const { tool_identifier: toolId, state, result_data: resultData } = execution;

  if (!resultData || typeof resultData !== "object") return null;

  const executionStatus =
    state === "settled" ? "settled" : state === "failed" ? "failed" : "pending";

  if (toolId === "evidence-quality-check") {
    return {
      kind: "evidence_quality",
      outcome: {
        evidenceVersionHash:
          typeof resultData.evidenceVersionHash === "string"
            ? resultData.evidenceVersionHash
            : "",
        readiness: validateReadiness(resultData.readiness),
        missingEvidence: stringArray(resultData.missingEvidence),
        ambiguities: stringArray(resultData.ambiguities),
        recommendedImprovements: stringArray(resultData.recommendedImprovements),
        reviewerQuestions: stringArray(resultData.reviewerQuestions),
        executionStatus,
      },
    };
  }

  if (toolId === "case-refresh") {
    const crReadiness = resultData.readiness;
    return {
      kind: "case_refresh",
      outcome: {
        caseVersionHash:
          typeof resultData.caseVersionHash === "string"
            ? resultData.caseVersionHash
            : "",
        readiness:
          crReadiness === "ready" || crReadiness === "needs_evidence" || crReadiness === "needs_clarification"
            ? crReadiness
            : "needs_evidence",
        unresolvedEvidenceGaps: stringArray(resultData.unresolvedEvidenceGaps),
        newQuestions: stringArray(resultData.newQuestions),
        executionStatus,
      },
    };
  }

  if (toolId === "reclaim-dispute-brief-v1") {
    return {
      kind: "dispute_brief",
      outcome: {
        caseVersionHash:
          typeof resultData.caseVersionHash === "string"
            ? resultData.caseVersionHash
            : "",
        reviewerPacketReady: Boolean(resultData.reviewerPacketReady),
        resultReference:
          typeof resultData.resultReference === "string"
            ? resultData.resultReference
            : null,
        executionStatus,
      },
    };
  }

  return null;
}

function validateReadiness(
  value: unknown,
): EvidenceQualityOutcome["readiness"] {
  if (value === "ready" || value === "needs_improvement" || value === "insufficient") {
    return value;
  }
  return "needs_improvement";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// ---------------------------------------------------------------------------
// Helper: dedup key for evidence requests
// ---------------------------------------------------------------------------

export function buildEvidenceRequestDedupKey(
  agentId: string,
  responsibleParty: string,
  evidenceItem: string,
  caseHash: string,
  evidenceHash: string,
): string {
  return `${agentId}::${responsibleParty}::${evidenceItem.trim().toLowerCase()}::${caseHash}::${evidenceHash}`;
}

// ---------------------------------------------------------------------------
// Helper: determine party from evidence item text
// ---------------------------------------------------------------------------

function inferPartyFromEvidenceItem(item: string): "client" | "worker" {
  const lower = item.toLowerCase();
  if (lower.includes("client")) return "client";
  return "worker";
}

// ---------------------------------------------------------------------------
// Helper: check if an equivalent open evidence request already exists
// ---------------------------------------------------------------------------

function hasEquivalentOpenRequest(
  agentId: string,
  party: "client" | "worker",
  evidenceItem: string,
  caseHash: string,
  evidenceHash: string,
  requests: EvidenceRequestRow[],
): boolean {
  const dedupKey = buildEvidenceRequestDedupKey(agentId, party, evidenceItem, caseHash, evidenceHash);
  return requests.some((er) => {
    if (er.status !== "open") return false;
    const existingKey = buildEvidenceRequestDedupKey(
      er.agent_id,
      er.responsible_party,
      er.evidence_item,
      er.created_case_version_hash ?? "",
      evidenceHash,
    );
    return existingKey === dedupKey;
  });
}

// ---------------------------------------------------------------------------
// Rule 6: qualityCheckFoundGaps
// ---------------------------------------------------------------------------

export function qualityCheckFoundGaps(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions, evidenceRequests } = input;
  const observation = agent.observation;
  if (!observation) return null;

  const currentEvidenceHash = observation.evidenceVersionHash;

  // Find settled quality check for current hash
  const settledQC = toolExecutions.find(
    (te) =>
      te.tool_identifier === "evidence-quality-check" &&
      te.state === "settled" &&
      te.evidence_version_hash === currentEvidenceHash,
  );
  if (!settledQC) return null;

  const outcome = normalizeToolOutcome(settledQC);
  if (!outcome || outcome.kind !== "evidence_quality") return null;

  const eqOutcome = outcome.outcome;
  if (eqOutcome.readiness === "ready") return null;
  if (eqOutcome.missingEvidence.length === 0) return null;

  // Pick the highest-priority gap (first one)
  const gap = eqOutcome.missingEvidence[0];
  const party = inferPartyFromEvidenceItem(gap);

  // Check for duplicate
  if (
    hasEquivalentOpenRequest(
      agent.id,
      party,
      gap,
      observation.caseVersionHash,
      currentEvidenceHash,
      evidenceRequests,
    )
  ) {
    return null;
  }

  return {
    kind: "create_evidence_request",
    responsibleParty: party,
    evidenceItem: gap,
    reason: `Evidence quality check identified missing item: ${gap}`,
    plannerReason: "evidence_gaps_found",
  };
}

// ---------------------------------------------------------------------------
// Rule 7: meaningfulEvidenceChange
// ---------------------------------------------------------------------------

export function meaningfulEvidenceChange(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions, now } = input;
  const observation = agent.observation;
  if (!observation) return null;

  if (!observation.hasMeaningfulChange) return null;

  const currentCaseHash = observation.caseVersionHash;

  // Check if a settled case refresh exists for current case hash
  const settledCR = toolExecutions.find(
    (te) =>
      te.tool_identifier === "case-refresh" &&
      te.state === "settled" &&
      te.case_version_hash === currentCaseHash,
  );
  if (settledCR) return null;

  // Check if a pending case refresh exists
  const pendingCR = toolExecutions.find(
    (te) =>
      te.tool_identifier === "case-refresh" &&
      IN_FLIGHT_STATES.has(te.state),
  );
  if (pendingCR) return null;

  // Budget check
  const toolDef = getToolDefinition("case-refresh");
  if (!toolDef) return null;
  const remaining = getRemainingBudget(agent.budget);
  if (remaining < toolDef.priceAtomic) return null;

  // Policy check
  const toolRequest = buildToolRequestIdentity(
    agent,
    "case-refresh",
    currentCaseHash,
    observation.evidenceVersionHash,
  );
  const policyResult = evaluateToolExecution(agent, toolRequest, now);
  if (policyResult.decision.kind !== "allowed") return null;

  return {
    kind: "run_tool",
    toolId: "case-refresh",
    reason: "evidence_changed_refresh_required",
    toolRequest,
  };
}

// ---------------------------------------------------------------------------
// Rule 8: caseRefreshFoundGaps
// ---------------------------------------------------------------------------

export function caseRefreshFoundGaps(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions, evidenceRequests } = input;
  const observation = agent.observation;
  if (!observation) return null;

  const currentCaseHash = observation.caseVersionHash;

  // Find settled case refresh for current hash
  const settledCR = toolExecutions.find(
    (te) =>
      te.tool_identifier === "case-refresh" &&
      te.state === "settled" &&
      te.case_version_hash === currentCaseHash,
  );
  if (!settledCR) return null;

  const outcome = normalizeToolOutcome(settledCR);
  if (!outcome || outcome.kind !== "case_refresh") return null;

  const crOutcome = outcome.outcome;
  if (crOutcome.readiness === "ready") return null;

  // Collect gaps from unresolvedEvidenceGaps and newQuestions
  const allGaps = [...crOutcome.unresolvedEvidenceGaps, ...crOutcome.newQuestions];
  if (allGaps.length === 0) return null;

  const gap = allGaps[0];
  const party: "client" | "worker" = inferPartyFromEvidenceItem(gap);

  if (
    hasEquivalentOpenRequest(
      agent.id,
      party,
      gap,
      currentCaseHash,
      observation.evidenceVersionHash,
      evidenceRequests,
    )
  ) {
    return null;
  }

  return {
    kind: "create_evidence_request",
    responsibleParty: party,
    evidenceItem: gap,
    reason: `Case refresh identified unresolved gap: ${gap}`,
    plannerReason: "unresolved_gaps_after_refresh",
  };
}

// ---------------------------------------------------------------------------
// Rule 9: caseReadyForBrief
// ---------------------------------------------------------------------------

export function caseReadyForBrief(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions, now } = input;
  const observation = agent.observation;
  if (!observation) return null;

  const currentEvidenceHash = observation.evidenceVersionHash;
  const currentCaseHash = observation.caseVersionHash;

  // Need a settled quality check marked ready
  const settledQC = toolExecutions.find(
    (te) =>
      te.tool_identifier === "evidence-quality-check" &&
      te.state === "settled" &&
      te.evidence_version_hash === currentEvidenceHash,
  );
  if (!settledQC) return null;

  const qcOutcome = normalizeToolOutcome(settledQC);
  if (
    !qcOutcome ||
    qcOutcome.kind !== "evidence_quality" ||
    qcOutcome.outcome.readiness !== "ready"
  ) {
    return null;
  }

  // Check if a settled dispute brief already exists for current case hash
  const settledBrief = toolExecutions.find(
    (te) =>
      te.tool_identifier === "reclaim-dispute-brief-v1" &&
      te.state === "settled" &&
      te.case_version_hash === currentCaseHash,
  );
  if (settledBrief) return null;

  // Budget check
  const toolDef = getToolDefinition("reclaim-dispute-brief-v1");
  if (!toolDef) return null;
  const remaining = getRemainingBudget(agent.budget);
  if (remaining < toolDef.priceAtomic) return null;

  // Policy check
  const toolRequest = buildToolRequestIdentity(
    agent,
    "reclaim-dispute-brief-v1",
    currentCaseHash,
    currentEvidenceHash,
  );
  const policyResult = evaluateToolExecution(agent, toolRequest, now);
  if (policyResult.decision.kind !== "allowed") return null;

  return {
    kind: "run_tool",
    toolId: "reclaim-dispute-brief-v1",
    reason: "dispute_brief_required",
    toolRequest,
  };
}

// ---------------------------------------------------------------------------
// Rule 10: readyForHumanReview
// ---------------------------------------------------------------------------

export function readyForHumanReview(
  input: ResolutionAgentPlannerInput,
): ResolutionAgentNextAction | null {
  const { agent, toolExecutions } = input;
  const observation = agent.observation;
  if (!observation) return null;

  const currentCaseHash = observation.caseVersionHash;

  // Find settled dispute brief for current case hash
  const settledBrief = toolExecutions.find(
    (te) =>
      te.tool_identifier === "reclaim-dispute-brief-v1" &&
      te.state === "settled" &&
      te.case_version_hash === currentCaseHash,
  );
  if (!settledBrief) return null;

  const briefOutcome = normalizeToolOutcome(settledBrief);
  if (
    !briefOutcome ||
    briefOutcome.kind !== "dispute_brief" ||
    !briefOutcome.outcome.reviewerPacketReady
  ) {
    return null;
  }

  return {
    kind: "ready_for_human_review",
    caseVersionHash: currentCaseHash,
    disputeBriefReference: briefOutcome.outcome.resultReference,
    reason: "ready_for_human_review",
  };
}

// ---------------------------------------------------------------------------
// All rules in priority order (first match wins)
// ---------------------------------------------------------------------------

export const ALL_PLANNER_RULES: readonly ((
  input: ResolutionAgentPlannerInput,
) => ResolutionAgentNextAction | null)[] = [
  nonExecutableAgent,
  existingInFlightTool,
  noEvidence,
  openEvidenceRequest,
  evidenceQualityCheckRequired,
  qualityCheckFoundGaps,
  meaningfulEvidenceChange,
  caseRefreshFoundGaps,
  caseReadyForBrief,
  readyForHumanReview,
];
