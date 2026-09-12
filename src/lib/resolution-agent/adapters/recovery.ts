// ---------------------------------------------------------------------------
// Evidence Quality Check Recovery Handler
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
  type EvidenceQualityCheckDependencies,
} from "./types";
import { normalizeEvidenceQualityResult } from "./evidence-quality-result";
import {
  buildEvidenceCheckInput,
  type ServiceInput,
} from "./evidence-quality-input";
import { transitionAgentStatus } from "../state-machine";
import { EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC } from "../tools";

const CANONICAL_PRICE = EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC;

// ---------------------------------------------------------------------------
// Recovery entry point
// ---------------------------------------------------------------------------

export async function recoverPaidEvidenceQualityCheck(params: {
  agent: ResolutionAgent;
  execution: ToolExecutionRow;
  leaseContext: LeaseContext;
  now: number;
  dependencies: EvidenceQualityCheckDependencies;
}): Promise<ActionExecutionResult> {
  const { agent, execution, now, dependencies } = params;
  const { store, generator } = dependencies;

  // ---- Step 0: SETTLED execution — deterministic reconciliation ----------
  // The execution already settled (payment proof + result persisted). The
  // only remaining work is to reconcile the AGENT state: clear
  // currentRunningToolId, keep status active, and ensure spent reflects the
  // settlement. Never touch budget when already spent; never pay again.
  if (execution.state === "settled") {
    const proofError = validatePersistedSettlementProof(execution);
    if (proofError) return { kind: "failed_recoverable", reason: proofError };

    const alreadySpent = agent.budget.spentAtomic >= CANONICAL_PRICE;
    const alreadyReconciled =
      alreadySpent &&
      agent.status === "active" &&
      agent.currentRunningToolId === null;
    if (alreadyReconciled) {
      return {
        kind: "recovered",
        recoveryOutcome: "Settled execution already reconciled",
      };
    }

    let reconciledAgent: ResolutionAgent = agent;
    if (!alreadySpent) {
      reconciledAgent = {
        ...agent,
        budget: {
          ...agent.budget,
          spentAtomic: agent.budget.spentAtomic + CANONICAL_PRICE,
        },
      };
    }
    reconciledAgent = {
      ...reconciledAgent,
      currentRunningToolId: null,
    };
    const activeAgent =
      reconciledAgent.status === "active"
        ? reconciledAgent
        : transitionAgentStatus(reconciledAgent, "active", { now });

    try {
      const currentVersion = await store.getAgentVersion(agent.id);
      await store.updateAgent(activeAgent, currentVersion);
    } catch {
      // Best-effort — reconcile will be retried by a later iteration.
    }

    await store.appendEvent(
      agent.id,
      "tool_execution_reconciled",
      "Settled tool execution reconciled — current running tool cleared",
      agent.status,
      "active",
      {
        toolId: execution.tool_identifier,
        requestHash: execution.request_hash,
        settlementTxHash: execution.settlement_tx_hash,
        reconciledAt: now,
      },
    );

    return {
      kind: "recovered",
      recoveryOutcome: "Settled execution reconciled; agent restored",
    };
  }

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
  // In recovery, we must NOT call reserveAmount/reserve budget — the
  // payment was already made.  We directly adjust spentAtomic without
  // requiring a prior reservation (which may have been released or
  // never made in the recovery scenario).
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

  // ---- Step 4: Rebuild EvidenceCheckRequestInput from stored context ------
  const evidenceInput = rebuildEvidenceCheckInput(agent, execution);

  // ---- Step 5: Generate or recover missing result -------------------------
  if (execution.result_data) {
    // Result already exists — just mark settled
    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
    });
  } else {
    // Generate the missing result
    let generationResult;
    try {
      generationResult = await generator.generate({
        serviceInput: evidenceInput,
      });
    } catch {
      return {
        kind: "failed_recoverable",
        reason: "Recovery AI generation failed",
      };
    }

    // Normalize and persist result
    const outcome = normalizeEvidenceQualityResult({
      assessment: generationResult.assessment,
      evidenceVersionHash: execution.evidence_version_hash ?? "",
      executionStatus: "settled",
    });

    await store.updateToolExecution(agent.id, execution.request_hash, {
      state: "settled",
      result_reference: generationResult.assessment.assessmentId,
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
    "Recovered paid_pending_result evidence quality check execution",
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
    recoveryOutcome: "Evidence quality check result recovered and persisted",
  };
}

// ---------------------------------------------------------------------------
// Rebuild EvidenceCheckRequestInput from stored agent context
// ---------------------------------------------------------------------------

function rebuildEvidenceCheckInput(
  agent: ResolutionAgent,
  execution: ToolExecutionRow,
): ServiceInput {
  const observation = agent.observation;
  if (!observation) {
    // Use execution context as fallback
    return {
      escrowPaymentId: agent.identity.escrowPaymentId,
      evidenceTitle: "Evidence Quality Check (recovery)",
      evidenceDescription: "",
      evidenceType: "",
      relatedClaim: "",
      evidenceDate: "",
      externalRef: "",
      pastedText: "",
      fileHash: "",
      escrowChainId: agent.identity.escrowChainId,
      escrowContractAddress: agent.identity.escrowContractAddress,
      payer: agent.caseWalletAddress,
      paymentNetwork: execution.network,
      asset: execution.asset_address,
      payTo: execution.pay_to_address,
      amount: String(execution.price_atomic),
      scheme: "exact",
      evidenceInputHash: "",
    };
  }

  return buildEvidenceCheckInput(agent.identity, observation);
}
