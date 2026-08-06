// ---------------------------------------------------------------------------
// Recovery Classifier — pure function that categorises a resolution agent's
// recovery state based on its current state and the latest tool execution.
// ---------------------------------------------------------------------------

import type { ResolutionAgent } from "../types";
import type { ToolExecutionRow } from "../store/types";
import type { RecoveryDecision } from "./types";

const FIVE_MINUTES_MS = 5 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;

/**
 * Classify what recovery action (if any) is needed for a resolution agent.
 *
 * This is a pure function — it mutates nothing and has no side effects.
 *
 * Decision rules:
 *  1. No execution at all → no_recovery_needed
 *  2. currentRunningToolId set but no execution found → mark_failed_recoverable
 *  3. Execution state === "paid_pending_result" → recover_paid_result
 *  4. Execution state === "settled" → reconcile_settled_execution
 *  5. Execution state === "reserved" or "pending":
 *     - created < 5 min ago → wait_for_in_flight_execution
 *     - created >= 5 min ago → mark_failed_recoverable
 *  6. Execution state === "settling":
 *     - created < 10 min ago → wait_for_in_flight_execution
 *     - created >= 10 min ago → mark_failed_recoverable
 *  7. Execution state === "failed_recoverable" → manual_review_required
 *  8. Execution state === "failed_unpaid" or "cancelled" → no_recovery_needed
 */
export function classifyResolutionAgentRecovery(params: {
  agent: ResolutionAgent;
  latestToolExecution: ToolExecutionRow | null;
  now: number;
}): RecoveryDecision {
  const { agent, latestToolExecution, now } = params;

  // Rule 2: currentRunningToolId set but no execution — orphaned
  if (!latestToolExecution) {
    if (agent.currentRunningToolId) {
      return {
        kind: "mark_failed_recoverable",
        reason: `Agent has currentRunningToolId "${agent.currentRunningToolId}" but no tool execution exists`,
      };
    }
    // Rule 1: No execution at all
    return {
      kind: "no_recovery_needed",
      reason: "No tool execution in progress",
    };
  }

  const execution = latestToolExecution;
  const state = execution.state as string;

  // Rule 3: Paid but result not delivered
  if (state === "paid_pending_result") {
    return {
      kind: "recover_paid_result",
      reason: "Payment was made but tool result has not been delivered",
    };
  }

  // Rule 4: Settled — reconcile
  if (state === "settled") {
    return {
      kind: "reconcile_settled_execution",
      reason: "Tool execution is settled; reconcile agent state with the result",
    };
  }

  // Rule 5: Pending or reserved — check age
  if (state === "pending" || state === "reserved") {
    const createdTime = new Date(execution.created_at).getTime();
    if (isNaN(createdTime)) {
      return {
        kind: "mark_failed_recoverable",
        reason: `Execution in state "${state}" has unparseable creation timestamp`,
      };
    }
    if (now - createdTime < FIVE_MINUTES_MS) {
      return {
        kind: "wait_for_in_flight_execution",
        reason: `Execution is ${state} (created recently); waiting for it to complete`,
      };
    }
    return {
      kind: "mark_failed_recoverable",
      reason: `Execution has been ${state} for >= 5 minutes without progress`,
    };
  }

  // Rule 6: Settling — check age with longer window (10 min)
  if (state === "settling") {
    const createdTime = new Date(execution.created_at).getTime();
    if (isNaN(createdTime)) {
      return {
        kind: "mark_failed_recoverable",
        reason: 'Execution in state "settling" has unparseable creation timestamp',
      };
    }
    if (now - createdTime < TEN_MINUTES_MS) {
      return {
        kind: "wait_for_in_flight_execution",
        reason: "Execution is settling (created recently); waiting for settlement to confirm",
      };
    }
    return {
      kind: "mark_failed_recoverable",
      reason: "Execution has been settling for >= 10 minutes without confirmation",
    };
  }

  // Rule 7: failed_recoverable — already in that state, needs human
  if (state === "failed_recoverable") {
    return {
      kind: "manual_review_required",
      reason: "Execution is in failed_recoverable state; manual review required",
    };
  }

  // Rule 8: failed_unpaid or cancelled — no recovery needed (planner retries)
  if (state === "failed_unpaid" || state === "cancelled") {
    return {
      kind: "no_recovery_needed",
      reason: `Execution state "${state}" — planner will retry if needed`,
    };
  }

  // Fallback: unknown state
  return {
    kind: "no_recovery_needed",
    reason: `Unknown execution state "${state}" — no automatic recovery action`,
  };
}
