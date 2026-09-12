// ---------------------------------------------------------------------------
// Dispute Brief Recovery Handler
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
  type DisputeBriefDependencies,
} from "./types";
import { normalizeDisputeBriefResult } from "./dispute-brief-result";
import {
  buildDisputeBriefInput,
  type DisputeBriefAgentInput,
} from "./dispute-brief-input";
import { transitionAgentStatus } from "../state-machine";
import { DISPUTE_BRIEF_PRICE_ATOMIC } from "../tools";

const CANONICAL_PRICE = DISPUTE_BRIEF_PRICE_ATOMIC;

// ---------------------------------------------------------------------------
// Recovery entry point
// ---------------------------------------------------------------------------

export async function recoverPaidDisputeBrief(params: {
  agent: ResolutionAgent;
  execution: ToolExecutionRow;
  leaseContext: LeaseContext;
  now: number;
  dependencies: DisputeBriefDependencies;
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

  // ---- Step 4: Rebuild DisputeBriefAgentInput from stored context ---------
  const disputeBriefInput = rebuildDisputeBriefInput(agent, execution);

  // ---- Step 5: Generate or recover missing result -------------------------
  if (execution.result_data) {
    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
    });
  } else {
    let generationResult;
    try {
      generationResult = await generator.generate({
        serviceInput: disputeBriefInput,
      });
    } catch {
      return {
        kind: "failed_recoverable",
        reason: "Recovery AI generation failed",
      };
    }

    const outcome = normalizeDisputeBriefResult({
      result: generationResult,
      caseVersionHash: execution.case_version_hash ?? "",
      executionStatus: "settled",
    });

    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
      result_reference: generationResult.briefId,
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
    "Recovered paid_pending_result dispute brief execution",
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
    recoveryOutcome: "Dispute brief result recovered and persisted",
  };
}

// ---------------------------------------------------------------------------
// Rebuild DisputeBriefAgentInput from stored agent context
// ---------------------------------------------------------------------------

function rebuildDisputeBriefInput(
  agent: ResolutionAgent,
  execution: ToolExecutionRow,
): DisputeBriefAgentInput {
  const observation = agent.observation;
  if (!observation) {
    // Use execution context as fallback
    return {
      escrowPaymentId: agent.identity.escrowPaymentId,
      escrowChainId: agent.identity.escrowChainId,
      escrowContractAddress: agent.identity.escrowContractAddress,
      clientAddress: "",
      workerAddress: "",
      agreementLabel: "Dispute Brief (recovery)",
      deliverableSummary: `Recovery for payment ${agent.identity.escrowPaymentId}`,
      deliveryFormat: "digital",
      releaseRule: "standard",
      evidenceExpectation: "Relevant evidence for dispute resolution",
      escrowState: "unknown",
      disputeReference: "",
      caseVersionHash: execution.case_version_hash ?? "",
      evidenceVersionHash: execution.evidence_version_hash ?? "",
      evidenceAvailability: "none",
      evidenceCount: 0,
      hasEvidenceMetadata: false,
      latestQualityCheck: null,
      latestCaseRefresh: null,
      openEvidenceRequests: [],
      fulfilledEvidenceRequests: [],
      hasMeaningfulChange: false,
      unresolvedGapsCount: 0,
    };
  }

  return buildDisputeBriefInput(agent.identity, observation, null, null);
}
