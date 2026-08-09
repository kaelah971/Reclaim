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
import type { EvidenceQualityCheckDependencies, CaseRefreshDependencies, DisputeBriefDependencies } from "./types";
import { executeEvidenceQualityCheck } from "./evidence-quality-check";
import { recoverPaidEvidenceQualityCheck } from "./recovery";
import { executeCaseRefresh } from "./case-refresh";
import { recoverPaidCaseRefresh } from "./case-refresh-recovery";
import { executeDisputeBrief } from "./dispute-brief";
import { recoverPaidDisputeBrief } from "./dispute-brief-recovery";
import { evaluateToolExecution } from "../policy";

// ---------------------------------------------------------------------------
// Execution-time policy gate
//
// The planner already policy-checks, but execution must re-validate the
// CURRENT agent state (status, policy expiry, budget, evidence requirement)
// immediately before any reservation/settlement — a renewed-but-now-expired
// policy or an intervening budget change must block here.
// ---------------------------------------------------------------------------

function enforceExecutionPolicy(params: {
  agent: ResolutionAgent;
  action: ResolutionAgentNextAction;
  now: number;
}): ActionExecutionResult | null {
  if (params.action.kind !== "run_tool" || !params.action.toolRequest) {
    return null;
  }
  const policyResult = evaluateToolExecution(
    params.agent,
    params.action.toolRequest,
    params.now,
  );
  if (policyResult.decision.kind === "allowed") return null;

  return {
    kind: "skipped",
    reason: `Execution policy denied ${params.action.toolId}: ${policyResult.decision.kind}`,
  };
}

// ---------------------------------------------------------------------------
// Factory: createProductionActionExecutor
// ---------------------------------------------------------------------------

/**
 * Creates the production ResolutionAgentActionExecutor with
 * evidence-quality-check, case-refresh, and reclaim-dispute-brief-v1
 * wired to the concrete adapters.
 *
 * Non-tool actions return "skipped" or "unsupported_action" as appropriate.
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
        return { kind: "skipped", reason: `Non-tool action: ${action.kind}` };
      }

      // Re-enforce current policy/budget at execution time.
      const policyBlock = enforceExecutionPolicy({ agent, action, now });
      if (policyBlock) return policyBlock;

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

        case "case-refresh": {
          return executeCaseRefresh({
            agent,
            plan,
            action,
            leaseContext,
            now,
            dependencies: dependencies as unknown as CaseRefreshDependencies,
          });
        }

        case "reclaim-dispute-brief-v1": {
          return executeDisputeBrief({
            agent,
            plan,
            action,
            leaseContext,
            now,
            dependencies: dependencies as unknown as DisputeBriefDependencies,
          });
        }

        default: {
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

        case "case-refresh": {
          return recoverPaidCaseRefresh({
            agent,
            execution,
            leaseContext,
            now,
            dependencies: dependencies as unknown as CaseRefreshDependencies,
          });
        }

        case "reclaim-dispute-brief-v1": {
          return recoverPaidDisputeBrief({
            agent,
            execution,
            leaseContext,
            now,
            dependencies: dependencies as unknown as DisputeBriefDependencies,
          });
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
