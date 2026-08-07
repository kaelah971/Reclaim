// ---------------------------------------------------------------------------
// Evidence Request Service — create and wait-for-evidence action handlers.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type { LeaseContext, ActionExecutionResult } from "../worker/types";
import type { EvidenceRequestRow } from "../store/types";
import type { EvidenceRequestStore } from "./types";
import { computeEvidenceRequestDedupIdentity, normalizeEvidenceItem, normalizeReason } from "./identity";
import { transitionAgentStatus } from "../state-machine";
import {
  ResolutionAgentEvidenceRequestStalePlanError,
  ResolutionAgentEvidenceRequestUnauthorizedPartyError,
  ResolutionAgentEvidenceRequestConflictError,
} from "./errors";

// ---------------------------------------------------------------------------
// Plan staleness check (mirrors dispatcher logic for self-contained validation)
// ---------------------------------------------------------------------------

function isPlanStaleForAction(params: {
  agent: ResolutionAgent;
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

// ---------------------------------------------------------------------------
// Dedup check: find an equivalent open evidence request
// ---------------------------------------------------------------------------

/**
 * Checks whether an equivalent open evidence request already exists for
 * the given dedup identity.
 *
 * Two requests are equivalent when:
 *  - Same responsible_party
 *  - Same normalized evidence_item
 *  - Same (or matching) created_case_version_hash
 *  - Same (or matching) fulfilled_case_version_hash (for open: both NULL)
 *  - Status is "open"
 *
 * Returns the matching row or null.
 */
function findEquivalentOpenRequest(
  existingRequests: EvidenceRequestRow[],
  dedupIdentity: { responsibleParty: string; evidenceItem: string; caseVersionHash: string; evidenceVersionHash: string },
): EvidenceRequestRow | null {
  return existingRequests.find((req) => {
    // Same responsible party
    if (req.responsible_party !== dedupIdentity.responsibleParty) return false;
    // Same normalized evidence item
    if (normalizeEvidenceItem(req.evidence_item) !== dedupIdentity.evidenceItem) return false;
    // Status must be "open"
    if (req.status !== "open") return false;
    // Case version hash must match (or both be nullish)
    if (req.created_case_version_hash !== dedupIdentity.caseVersionHash) return false;
    return true;
  }) ?? null;
}

// ---------------------------------------------------------------------------
// executeCreateEvidenceRequest
// ---------------------------------------------------------------------------

/**
 * Execute a `create_evidence_request` action.
 *
 * Flow:
 *  1. Validate action kind
 *  2. Validate responsibleParty
 *  3. Validate lease context (agentId must match)
 *  4. Validate plan hashes match current observation (stale-plan guard)
 *  5. Normalize evidenceItem and reason
 *  6. Compute dedup identity
 *  7. Load existing evidence requests
 *  8. Check for equivalent open request → idempotent return if exists
 *  9. Create new evidence request via store
 * 10. Transition agent to waiting_for_evidence (if not already)
 * 11. Append event
 * 12. Return result
 *
 * Safety invariants:
 *  - No budget change
 *  - No wallet decryption
 *  - No settlement
 *  - No secrets in results
 */
export async function executeCreateEvidenceRequest(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction & { kind: "create_evidence_request" };
  leaseContext: LeaseContext;
  now: number;
  store: EvidenceRequestStore;
}): Promise<{ result: ActionExecutionResult; agent: ResolutionAgent }> {
  const { agent, plan, action, leaseContext, now, store } = params;

  // 1. Validate action kind
  if (action.kind !== "create_evidence_request") {
    return {
      result: { kind: "unsupported_action", actionKind: action.kind },
      agent,
    };
  }

  // 2. Validate responsibleParty
  if (action.responsibleParty !== "client" && action.responsibleParty !== "worker") {
    throw new ResolutionAgentEvidenceRequestUnauthorizedPartyError(
      `Invalid responsible party: "${action.responsibleParty}". Must be "client" or "worker".`,
    );
  }

  // 3. Validate lease context
  if (leaseContext.agentId !== agent.id) {
    throw new ResolutionAgentEvidenceRequestConflictError(
      `Lease context agentId "${leaseContext.agentId}" does not match agent id "${agent.id}".`,
    );
  }

  // 4. Validate plan hashes match current observation
  if (
    isPlanStaleForAction({
      agent,
      caseVersionHash: plan.caseVersionHash,
      evidenceVersionHash: plan.evidenceVersionHash,
    })
  ) {
    throw new ResolutionAgentEvidenceRequestStalePlanError(
      "Plan hashes do not match agent's current observation — plan is stale.",
    );
  }

  // 5. Normalize evidenceItem and reason
  const normalizedItem = normalizeEvidenceItem(action.evidenceItem);
  const normalizedReason = normalizeReason(action.reason);

  // 6. Compute dedup identity
  const dedupIdentity = computeEvidenceRequestDedupIdentity({
    agentId: agent.id,
    responsibleParty: action.responsibleParty,
    evidenceItem: action.evidenceItem,
    caseVersionHash: plan.caseVersionHash,
    evidenceVersionHash: plan.evidenceVersionHash,
  });

  // 7. Load existing evidence requests
  const existingRequests = await store.listEvidenceRequests(agent.id);

  // 8. Check if equivalent open request already exists
  const existingOpen = findEquivalentOpenRequest(existingRequests, {
    responsibleParty: dedupIdentity.responsibleParty,
    evidenceItem: dedupIdentity.evidenceItem,
    caseVersionHash: dedupIdentity.caseVersionHash,
    evidenceVersionHash: dedupIdentity.evidenceVersionHash,
  });

  let request: EvidenceRequestRow;

  if (existingOpen) {
    // Idempotent: return existing request
    request = existingOpen;

    // Ensure agent is in waiting_for_evidence if not already
    let updatedAgent = agent;
    if (agent.status !== "waiting_for_evidence") {
      const version = await store.getAgentVersion(agent.id);
      updatedAgent = transitionAgentStatus(agent, "waiting_for_evidence", { now });
      await store.updateAgent(updatedAgent, version);
      await store.appendEvent(
        agent.id,
        "status_change",
        "Agent transitioned to waiting_for_evidence (evidence request already open)",
        agent.status,
        updatedAgent.status,
        { evidenceRequestId: request.id },
      );
    }

    // Append evidence_request_already_open event
    await store.appendEvent(
      agent.id,
      "evidence_request_already_open",
      `Evidence request for "${normalizedItem}" is already open (request ${request.id})`,
      null,
      null,
      {
        evidenceRequestId: request.id,
        responsibleParty: action.responsibleParty,
        evidenceItem: normalizedItem,
      },
    );

    return {
      result: { kind: "executed" },
      agent: updatedAgent,
    };
  }

  // 9. Create new evidence request
  request = await store.createEvidenceRequest(
    agent.id,
    action.responsibleParty,
    normalizedItem,
    normalizedReason,
    plan.caseVersionHash,
    plan.evidenceVersionHash,
  );

  // 10. Transition agent to waiting_for_evidence (if not already)
  let updatedAgent = agent;
  if (agent.status !== "waiting_for_evidence") {
    const version = await store.getAgentVersion(agent.id);
    updatedAgent = transitionAgentStatus(agent, "waiting_for_evidence", { now });
    await store.updateAgent(updatedAgent, version);
    await store.appendEvent(
      agent.id,
      "status_change",
      "Agent transitioned to waiting_for_evidence after creating evidence request",
      agent.status,
      updatedAgent.status,
      { evidenceRequestId: request.id },
    );
  }

  // 11. Append evidence_request_created event
  await store.appendEvent(
    agent.id,
    "evidence_request_created",
    `Evidence request created for "${normalizedItem}" from ${action.responsibleParty}`,
    null,
    null,
    {
      evidenceRequestId: request.id,
      responsibleParty: action.responsibleParty,
      evidenceItem: normalizedItem,
      reason: normalizedReason,
      caseVersionHash: plan.caseVersionHash,
      evidenceVersionHash: plan.evidenceVersionHash,
    },
  );

  // 12. Return result
  return {
    result: { kind: "executed" },
    agent: updatedAgent,
  };
}

// ---------------------------------------------------------------------------
// executeWaitForEvidence
// ---------------------------------------------------------------------------

/**
 * Execute a `wait_for_evidence` action.
 *
 * Flow:
 *  1. Validate action kind
 *  2. Validate plan hashes match current observation
 *  3. Load open evidence requests by IDs from action.evidenceRequestIds
 *  4. Confirm each belongs to this agent
 *  5. Confirm at least one relevant request is still "open"
 *  6. If agent is not already waiting_for_evidence → transition
 *  7. If all referenced requests are fulfilled/cancelled → return waiting
 *     (don't auto-resume; Task 12 handles resumption)
 *  8. Do NOT append repeated waiting events every iteration
 *
 * Safety invariants:
 *  - No budget change
 *  - No wallet decryption
 *  - No settlement
 *  - No secrets in results
 *  - No repeated events on subsequent calls
 */
export async function executeWaitForEvidence(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction & { kind: "wait_for_evidence" };
  leaseContext: LeaseContext;
  now: number;
  store: EvidenceRequestStore;
}): Promise<{ result: ActionExecutionResult; agent: ResolutionAgent }> {
  const { agent, plan, action, now, store } = params;

  // 1. Validate action kind
  if (action.kind !== "wait_for_evidence") {
    return {
      result: { kind: "unsupported_action", actionKind: action.kind },
      agent,
    };
  }

  // 2. Validate plan hashes match
  if (
    isPlanStaleForAction({
      agent,
      caseVersionHash: plan.caseVersionHash,
      evidenceVersionHash: plan.evidenceVersionHash,
    })
  ) {
    throw new ResolutionAgentEvidenceRequestStalePlanError(
      "Plan hashes do not match agent's current observation — plan is stale.",
    );
  }

  // 3. Load open evidence requests by IDs
  const allRequests = await store.listEvidenceRequests(agent.id);

  // 4. Confirm each referenced request belongs to this agent
  const referencedRequests = action.evidenceRequestIds.map((reqId) => {
    const found = allRequests.find((r) => r.id === reqId);
    if (!found) {
      throw new ResolutionAgentEvidenceRequestConflictError(
        `Referenced evidence request "${reqId}" not found for agent "${agent.id}".`,
      );
    }
    if (found.agent_id !== agent.id) {
      throw new ResolutionAgentEvidenceRequestConflictError(
        `Evidence request "${reqId}" does not belong to agent "${agent.id}".`,
      );
    }
    return found;
  });

  // 5. Confirm at least one relevant request is still "open"
  const hasOpenRequest = referencedRequests.some((r) => r.status === "open");
  const allFulfilledOrCancelled = referencedRequests.every(
    (r) => r.status === "fulfilled" || r.status === "cancelled",
  );

  // 6. If agent is not already waiting_for_evidence, transition
  let updatedAgent = agent;
  if (agent.status !== "waiting_for_evidence") {
    const version = await store.getAgentVersion(agent.id);
    updatedAgent = transitionAgentStatus(agent, "waiting_for_evidence", { now });
    await store.updateAgent(updatedAgent, version);
    await store.appendEvent(
      agent.id,
      "status_change",
      "Agent transitioned to waiting_for_evidence",
      agent.status,
      updatedAgent.status,
      { evidenceRequestIds: action.evidenceRequestIds },
    );
  }

  // 7. If all referenced requests are fulfilled/cancelled, still return waiting
  //    (don't auto-resume — Task 12 handles this)
  if (allFulfilledOrCancelled && !hasOpenRequest) {
    return {
      result: {
        kind: "waiting",
        reason: "All referenced evidence requests are fulfilled or cancelled — awaiting resumption (Task 12)",
      },
      agent: updatedAgent,
    };
  }

  // 8. At least one request is still open — return waiting
  //    Do NOT append repeated waiting events if already in waiting_for_evidence
  return {
    result: { kind: "waiting", reason: "Waiting for evidence to be provided" },
    agent: updatedAgent,
  };
}
