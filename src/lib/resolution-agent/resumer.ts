// ---------------------------------------------------------------------------
// Resolution Agent Resumer
//
// Deterministic resumption decision engine for waiting resolution agents.
//
// Evaluates whether a waiting agent should be resumed (transitioned back to
// active) based on the durable resolution of its blocking evidence requests.
//
// Safety invariants:
//  - No AI / DeepSeek
//  - No x402
//  - No wallet decryption
//  - No budget change
//  - No RPC calls
//  - No secrets in results
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent } from "./types";
import type { EvidenceRequestRow } from "./store/types";

// ---------------------------------------------------------------------------
// Resumption Reason Codes
// ---------------------------------------------------------------------------

export type ResumptionReasonCode =
  | "evidence_request_fulfilled"
  | "all_evidence_requests_resolved"
  | "evidence_request_cancelled"
  | "material_case_state_changed"
  | "still_waiting_on_open_request"
  | "malformed_waiting_state";

// ---------------------------------------------------------------------------
// Resumption Decision
// ---------------------------------------------------------------------------

export type ResumptionDecision =
  | { kind: "resume"; reasonCode: ResumptionReasonCode }
  | { kind: "stay_waiting"; reasonCode: ResumptionReasonCode }
  | { kind: "failed_recoverable"; reasonCode: ResumptionReasonCode };

// ---------------------------------------------------------------------------
// Resumer Input
// ---------------------------------------------------------------------------

export interface ResumptionInput {
  agent: ResolutionAgent;
  evidenceRequests: EvidenceRequestRow[];
  now: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a waiting resolution agent should be resumed.
 *
 * This is a pure(ish) function — it reads the current agent state and
 * evidence requests and returns a deterministic resumption decision.
 * It mutates nothing.
 *
 * Rules (in order):
 *  1. Non-waiting agent → stay_waiting (no-op)
 *  2. No evidence requests → failed_recoverable (malformed state)
 *  3. Filter to requests belonging to this agent
 *  4. Still have open requests → stay_waiting
 *  5. All requests fulfilled → resume
 *  6. All requests cancelled → resume (planner may recreate)
 *  7. Mixed fulfilled/cancelled (no open) → resume
 *
 * @returns A {@link ResumptionDecision} indicating the recommended action.
 */
export function evaluateResolutionAgentResumption(
  input: ResumptionInput,
): ResumptionDecision {
  const { agent, evidenceRequests } = input;

  // 1. Only evaluate waiting agents
  if (agent.status !== "waiting_for_evidence") {
    return {
      kind: "stay_waiting",
      reasonCode: "still_waiting_on_open_request",
    };
  }

  // 2. Filter requests belonging to this agent
  const agentRequests = evidenceRequests.filter(
    (r) => r.agent_id === agent.id,
  );

  // 3. No requests at all → malformed state
  if (agentRequests.length === 0) {
    return {
      kind: "failed_recoverable",
      reasonCode: "malformed_waiting_state",
    };
  }

  // 4. Identify request categories
  const openRequests = agentRequests.filter((r) => r.status === "open");
  const fulfilledRequests = agentRequests.filter(
    (r) => r.status === "fulfilled",
  );
  const cancelledRequests = agentRequests.filter(
    (r) => r.status === "cancelled",
  );

  // 5. Still have open requests → stay waiting
  if (openRequests.length > 0) {
    return {
      kind: "stay_waiting",
      reasonCode: "still_waiting_on_open_request",
    };
  }

  // 6. All requests are resolved (fulfilled or cancelled)
  if (fulfilledRequests.length > 0) {
    return {
      kind: "resume",
      reasonCode: "all_evidence_requests_resolved",
    };
  }

  if (cancelledRequests.length > 0) {
    return {
      kind: "resume",
      reasonCode: "evidence_request_cancelled",
    };
  }

  // Fallback: shouldn't reach here, but fail closed
  return {
    kind: "failed_recoverable",
    reasonCode: "malformed_waiting_state",
  };
}
