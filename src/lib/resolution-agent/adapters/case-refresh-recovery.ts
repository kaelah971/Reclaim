// ---------------------------------------------------------------------------
// Case Refresh Recovery Handler
//
// Recovers executions stuck in the "paid_pending_result" state.
//
// Recovery invariants (NEVER violated):
//   - NEVER decrypt the wallet
//   - NEVER sign or call settlement
//   - NEVER reserve budget
//   - NEVER create a new execution
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent } from "../types";
import type { ActionExecutionResult, LeaseContext } from "../worker/types";
import type { ToolExecutionRow } from "../store/types";
import {
  validatePersistedSettlementProof,
  type CaseRefreshDependencies,
} from "./types";
import { normalizeCaseRefreshResult } from "./case-refresh-result";
import { buildCaseRefreshInput } from "./case-refresh-input";
import { transitionAgentStatus } from "../state-machine";
import { CASE_REFRESH_PRICE_ATOMIC } from "../tools";
import type { CaseRefreshInput } from "../../x402/caseRefreshValidation";

const CANONICAL_PRICE = CASE_REFRESH_PRICE_ATOMIC;

// ---------------------------------------------------------------------------
// Recovery entry point
// ---------------------------------------------------------------------------

export async function recoverPaidCaseRefresh(params: {
  agent: ResolutionAgent;
  execution: ToolExecutionRow;
  leaseContext: LeaseContext;
  now: number;
  dependencies: CaseRefreshDependencies;
}): Promise<ActionExecutionResult> {
  const { agent, execution, now, dependencies } = params;
  const { store, generator } = dependencies;

  // ---- Step 1: Verify execution is in a recoverable state -----------------
  if (execution.state !== "paid_pending_result") {
    return {
      kind: "skipped",
      reason: `Execution not in paid_pending_result state: ${execution.state}`,
    };
  }

  // ---- Step 2: Verify payment proof exists --------------------------------
  const proofError = validatePersistedSettlementProof(execution);
  if (proofError) {
    return {
      kind: "failed_recoverable",
      reason: proofError,
    };
  }

  // ---- Step 3: Reconcile spent budget idempotently ------------------------
  const alreadySpent =
    agent.budget.spentAtomic >= CANONICAL_PRICE;

  let reconciledAgent: ResolutionAgent = agent;
  if (!alreadySpent) {
    const newSpent = agent.budget.spentAtomic + CANONICAL_PRICE;
    if (newSpent > agent.budget.approvedAtomic) {
      return {
        kind: "failed_recoverable",
        reason: "Cannot reconcile spent budget — would exceed approved budget",
      };
    }
    reconciledAgent = {
      ...agent,
      budget: {
        ...agent.budget,
        spentAtomic: newSpent,
      },
    };
  }

  // ---- Step 4: Rebuild CaseRefreshInput from stored context ---------------
  const caseRefreshInput = rebuildCaseRefreshInput(agent, execution);

  // ---- Step 5: Generate or recover missing result -------------------------
  if (execution.result_data) {
    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
    });
  } else {
    let generationResult;
    try {
      generationResult = await generator.generate({
        serviceInput: caseRefreshInput,
      });
    } catch {
      return {
        kind: "failed_recoverable",
        reason: "Recovery AI generation failed",
      };
    }

    const outcome = normalizeCaseRefreshResult(
      generationResult.result,
      "settled",
    );

    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
      result_data: outcome as unknown as Record<string, unknown>,
    });
  }

  // ---- Step 6: Persist budget reconciliation ------------------------------
  if (!alreadySpent) {
    try {
      const currentVersion = await store.getAgentVersion(agent.id);
      await store.updateAgent(reconciledAgent, currentVersion);
    } catch {
      // Budget update failed but result is preserved
    }
  }

  // ---- Step 7: Transition agent from running_tool → active ----------------
  if (agent.status === "running_tool") {
    const activeAgent = transitionAgentStatus(reconciledAgent, "active", { now });
    try {
      const currentVersion = await store.getAgentVersion(agent.id);
      await store.updateAgent(activeAgent, currentVersion);
    } catch {
      // Best effort
    }
  }

  // ---- Step 8: Append recovery event --------------------------------------
  await store.appendEvent(
    agent.id,
    "tool_execution_recovered",
    "Recovered paid_pending_result case refresh execution",
    agent.status,
    "active",
    {
      toolId: execution.tool_identifier,
      requestHash: execution.request_hash,
      recoveryAt: now,
    },
  );

  return {
    kind: "recovered",
    recoveryOutcome: "Case refresh result recovered and persisted",
  };
}

// ---------------------------------------------------------------------------
// Rebuild CaseRefreshInput from stored agent context
// ---------------------------------------------------------------------------

function rebuildCaseRefreshInput(
  agent: ResolutionAgent,
  execution: ToolExecutionRow,
): CaseRefreshInput {
  const observation = agent.observation;
  if (!observation) {
    return {
      escrowPaymentId: agent.identity.escrowPaymentId,
      agreementLabel: "Case Refresh (recovery)",
      deliverableSummary: `Recovery for payment ${agent.identity.escrowPaymentId}`,
      deliveryFormat: "digital",
      releaseRule: "standard",
      evidenceExpectation: "Relevant evidence for dispute resolution",
      escrowState: "unknown",
      caseVersionHash: execution.case_version_hash ?? "",
      evidenceVersionHash: execution.evidence_version_hash ?? "",
      evidenceAvailability: "none",
      evidenceReference: null,
      evidenceCount: 0,
      openEvidenceRequests: [],
      fulfilledEvidenceRequests: [],
      previousQualityCheck: null,
      previousCaseRefresh: null,
    };
  }

  return {
    ...buildCaseRefreshInput(agent.identity, observation),
    escrowChainId: agent.identity.escrowChainId,
    escrowContractAddress: agent.identity.escrowContractAddress,
    previousQualityCheck: null,
    previousCaseRefresh: null,
  } as CaseRefreshInput;
}
