// ---------------------------------------------------------------------------
// Production Action Executor Registry
//
// Wires the canonical ResolutionAgentActionExecutor interface to the concrete
// adapter implementations via dependency injection.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type {
  ActionExecutionResult,
  ResolutionAgentActionExecutor,
  ResolutionAgentRecoveryHandler,
  LeaseContext,
} from "../worker/types";
import type { ToolExecutionRow } from "../store/types";
import type { EvidenceQualityCheckDependencies } from "./types";
import { executeEvidenceQualityCheck } from "./evidence-quality-check";
import { recoverPaidEvidenceQualityCheck } from "./recovery";

// ---------------------------------------------------------------------------
// Factory: createProductionActionExecutor
// ---------------------------------------------------------------------------

/**
 * Creates the production ResolutionAgentActionExecutor with
 * evidence-quality-check wired to the concrete adapter.
 *
 * Unsupported tools (case-refresh, reclaim-dispute-brief-v1) return
 * "unsupported_action".  Non-tool actions return "skipped" or
 * "unsupported_action" as appropriate.
 */
export function createProductionActionExecutor(
  dependencies: EvidenceQualityCheckDependencies,
): ResolutionAgentActionExecutor {
  return {
    async executeOneAction(params: {
      agent: ResolutionAgent;
      plan: ResolutionAgentPlan;
      action: ResolutionAgentNextAction;
      leaseContext: LeaseContext;
      now: number;
    }): Promise<ActionExecutionResult> {
      const { agent, plan, action, leaseContext, now } = params;

      if (action.kind !== "run_tool") {
        // Non-tool actions (create_evidence_request, wait_for_evidence,
        // ready_for_human_review, budget_exhausted, waiting_for_human_approval,
        // no_action) are skipped by the executor — the planner handles them.
        return { kind: "skipped", reason: `Non-tool action: ${action.kind}` };
      }

      switch (action.toolId) {
        case "evidence-quality-check": {
          return executeEvidenceQualityCheck({
            agent,
            plan,
            action,
            leaseContext,
            now,
            dependencies,
          });
        }

        case "case-refresh":
        case "reclaim-dispute-brief-v1": {
          return {
            kind: "unsupported_action",
            actionKind: action.toolId,
          };
        }

        default: {
          // Type-safe exhaustive check — this branch should be unreachable
          return {
            kind: "unsupported_action",
            actionKind: (action as { toolId: string }).toolId,
          };
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory: createProductionRecoveryHandler
// ---------------------------------------------------------------------------

/**
 * Creates the production ResolutionAgentRecoveryHandler wired to the
 * concrete recovery adapter.
 */
export function createProductionRecoveryHandler(
  dependencies: EvidenceQualityCheckDependencies,
): ResolutionAgentRecoveryHandler {
  return {
    async recover(params: {
      agent: ResolutionAgent;
      execution: ToolExecutionRow;
      leaseContext: LeaseContext;
      now: number;
    }): Promise<ActionExecutionResult> {
      const { agent, execution, leaseContext, now } = params;

      switch (execution.tool_identifier) {
        case "evidence-quality-check": {
          return recoverPaidEvidenceQualityCheck({
            agent,
            execution,
            leaseContext,
            now,
            dependencies,
          });
        }

        case "case-refresh":
        case "reclaim-dispute-brief-v1": {
          return {
            kind: "unsupported_action",
            actionKind: execution.tool_identifier,
          };
        }

        default: {
          return {
            kind: "unsupported_action",
            actionKind: execution.tool_identifier,
          };
        }
      }
    },
  };
}
