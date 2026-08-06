// ---------------------------------------------------------------------------
// Worker Service — main iteration entrypoint for the resolution agent worker.
//
// Orchestrates: candidate selection → lease acquisition → recovery check →
// observation → planning → stale-plan verification → control dispatch.
//
// Safety invariants:
//  - One agent per iteration
//  - One action per agent
//  - Lease held throughout processing
//  - No real tool execution (all run_tool → unsupported_action)
//  - Control actions only (no_action, budget_exhausted, etc.)
//  - Stale plans rejected before dispatch
//  - Lease always released in finally
//  - No encrypted secrets in result
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type {
  ResolutionAgentWorkerDependencies,
  ResolutionAgentWorkerResult,
  LeaseContext,
  ActionExecutionResult,
} from "./types";
import { DEFAULT_MAX_CANDIDATES_TO_SCAN } from "./types";
import type { ResolutionAgent } from "../types";
import { classifyResolutionAgentRecovery } from "./recovery";
import { dispatchControlAction, isPlanStale } from "./dispatcher";
import { generateLeaseToken } from "./lease";
import {
  EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC,
} from "../tools";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
  type AgentCaseIdentity,
} from "../types";
import {
  computeEvidenceCheckHash,
  EVIDENCE_CHECK_SERVICE_IDENTIFIER,
} from "../../x402/requestHash";
import type { EvidenceCheckIdentity } from "../../x402/requestHash";

// ---------------------------------------------------------------------------
// Canonical tool configuration constants
// ---------------------------------------------------------------------------

const CANONICAL_TOOL_ID = "evidence-quality-check" as const;
const CANONICAL_PRICE = EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC;
const CANONICAL_NETWORK = AGENT_FACILITATOR_NETWORK;
const CANONICAL_ASSET = AGENT_MAINNET_USDC_ADDRESS;
const CANONICAL_PAY_TO = AGENT_PAY_TO_ADDRESS;

// ---------------------------------------------------------------------------
// Compute canonical request hash for recovery
// ---------------------------------------------------------------------------

function computeRecoveryRequestHash(
  caseIdentity: AgentCaseIdentity,
  payer: string,
  caseVersionHash: string,
  evidenceVersionHash: string,
): string {
  // Build a deterministic evidence input hash from the case/evidence version
  // hashes. This ensures recovery creates the same request hash every time
  // for the same agent state, even without the original observation data.
  const evidenceInputHash = `${EVIDENCE_CHECK_SERVICE_IDENTIFIER}:${caseIdentity.escrowPaymentId}:${caseVersionHash}:${evidenceVersionHash}`;

  const identity: EvidenceCheckIdentity = {
    service: EVIDENCE_CHECK_SERVICE_IDENTIFIER,
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    escrowPaymentId: caseIdentity.escrowPaymentId,
    payer: payer.toLowerCase(),
    paymentNetwork: CANONICAL_NETWORK,
    asset: CANONICAL_ASSET.toLowerCase(),
    payTo: CANONICAL_PAY_TO.toLowerCase(),
    amount: String(CANONICAL_PRICE),
    scheme: "exact",
    evidenceInputHash,
  };
  return computeEvidenceCheckHash(identity);
}

// ---------------------------------------------------------------------------
// Recover a missing tool execution from durable state
//
// When an agent is in running_tool with reserved budget but no execution
// row exists (process crashed after reservation), this function creates
// the missing execution using the persisted plan hashes and canonical config.
//
// The budget is ALREADY reserved — no additional budget change occurs.
// ---------------------------------------------------------------------------

async function recoverMissingExecution(params: {
  agent: ResolutionAgent;
  store: ResolutionAgentWorkerDependencies["store"];
}): Promise<ActionExecutionResult | null> {
  const { agent, store } = params;

  // Only recover for evidence-quality-check with currentRunningToolId set
  if (agent.currentRunningToolId !== CANONICAL_TOOL_ID) return null;

  const plan = agent.plan;
  if (!plan) return null;

  // Use the plan's hashes — these are the ones the tool was planned with
  const caseVersionHash = plan.caseVersionHash;
  const evidenceVersionHash = plan.evidenceVersionHash;

  if (!caseVersionHash || !evidenceVersionHash) return null;

  // Reconstruct the deterministic request hash
  const requestHash = computeRecoveryRequestHash(
    agent.identity,
    agent.caseWalletAddress,
    caseVersionHash,
    evidenceVersionHash,
  );

  // Check if execution already exists
  const existing = await store.getToolExecutionByRequestHash(
    agent.id,
    requestHash,
  );

  if (existing) {
    // Execution already exists — budget should already be reserved
    return { kind: "recovered", recoveryOutcome: "existing_execution_found" };
  }

  // No execution exists — create one. Budget is already reserved.
  try {
    await store.createToolExecution(
      agent.id,
      CANONICAL_TOOL_ID,
      requestHash,
      CANONICAL_PRICE,
      CANONICAL_NETWORK,
      CANONICAL_ASSET,
      CANONICAL_PAY_TO,
    );
  } catch {
    // Execution may have been created concurrently — idempotent
    return { kind: "recovered", recoveryOutcome: "execution_created_concurrently" };
  }

  // Set execution state to "reserved" and bind hashes
  await store.updateToolExecution(agent.id, requestHash, {
    state: "reserved",
    case_version_hash: caseVersionHash,
    evidence_version_hash: evidenceVersionHash,
  });

  await store.appendEvent(
    agent.id,
    "tool_execution_recovered",
    "Recovered missing tool execution after process interruption",
    null,
    null,
    { toolId: CANONICAL_TOOL_ID, requestHash },
  );

  return { kind: "recovered", recoveryOutcome: "execution_recovered" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runResolutionAgentWorkerIteration(params: {
  workerId: string;
  now: number;
  dependencies: ResolutionAgentWorkerDependencies;
}): Promise<ResolutionAgentWorkerResult> {
  const { workerId, now, dependencies } = params;
  const { store, observer, planner, actionExecutor, recoveryHandler } =
    dependencies;

  const iterationId = `${workerId}_${now}_${crypto.randomUUID()}`;

  let leaseContext: LeaseContext | null = null;
  let processedAgent: ResolutionAgent | null = null;
  let actionResult: ActionExecutionResult | null = null;

  try {
    // 1. List eligible candidates
    const candidates = await store.listRunnableAgents(
      DEFAULT_MAX_CANDIDATES_TO_SCAN,
    );

    // 2. No candidates → no work
    if (candidates.length === 0) {
      return {
        workerIterationId: iterationId,
        agentId: null,
        outcome: "no_work",
        actionDispatched: null,
      };
    }

    // 3. Try each candidate until we acquire a lease
    let acquiredAgentId: string | null = null;
    let acquiredToken: string | null = null;

    for (const candidate of candidates) {
      const token = generateLeaseToken();
      const lease = await store.tryAcquireAgentLease(
        candidate.agentId,
        token,
        now,
      );

      if (lease) {
        acquiredAgentId = candidate.agentId;
        acquiredToken = token;
        leaseContext = lease;
        break;
      }
    }

    // 4. No lease acquired for any candidate
    if (!acquiredAgentId || !acquiredToken || !leaseContext) {
      return {
        workerIterationId: iterationId,
        agentId: null,
        outcome: "lease_not_acquired",
        actionDispatched: null,
      };
    }

    // 5. Reload agent fresh from store after lease acquisition
    const agent = await store.getAgentById(acquiredAgentId);
    if (!agent) {
      return {
        workerIterationId: iterationId,
        agentId: acquiredAgentId,
        outcome: "error",
        actionDispatched: null,
        error: "Agent not found after lease acquisition",
      };
    }

    processedAgent = agent;

    // 6. Recovery check — get latest tool execution
    const toolExecutions = await store.listToolExecutions(agent.id);
    const latestExecution = toolExecutions.length > 0 ? toolExecutions[0] : null;

    const recoveryDecision = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: latestExecution,
      now,
    });

    // 7. If recovery is needed, handle it
    if (
      recoveryDecision.kind !== "no_recovery_needed" &&
      recoveryDecision.kind !== "wait_for_in_flight_execution"
    ) {
      // 7a. Recovery with an existing execution — use recovery handler
      if (latestExecution) {
        actionResult = await recoveryHandler.recover({
          agent,
          execution: latestExecution,
          leaseContext,
          now,
        });
        return {
          workerIterationId: iterationId,
          agentId: agent.id,
          outcome: "processed",
          actionDispatched: actionResult,
        };
      }

      // 7b. Recovery needed but NO execution exists — the process crashed
      //     after budget reservation but before execution creation.
      //     Reconstruct the execution from durable state.
      const missingResult = await recoverMissingExecution({
        agent,
        store,
      });

      if (missingResult) {
        actionResult = missingResult;
        return {
          workerIterationId: iterationId,
          agentId: agent.id,
          outcome: "processed",
          actionDispatched: actionResult,
        };
      }

      // 7c. Recovery not possible — mark as failed_recoverable
      actionResult = {
        kind: "failed_recoverable",
        reason: recoveryDecision.reason,
      };
      return {
        workerIterationId: iterationId,
        agentId: agent.id,
        outcome: "error",
        actionDispatched: actionResult,
      };
    }

    // 8. Observe the case
    // Build minimal mocks for readers — worker only runs observation for
    // hash generation, not actual RPC calls.
    const observationStore = store as unknown as Parameters<
      typeof observer
    >[0]["store"];
    await observer({
      agentId: agent.id,
      now,
      store: observationStore,
      escrowReader: {
        getFullPayment: async () => {
          throw new Error(
            "Escrow reader not available in worker iteration",
          );
        },
        getCaseParties: async () => {
          throw new Error(
            "Escrow reader not available in worker iteration",
          );
        },
      } as unknown as Parameters<typeof observer>[0]["escrowReader"],
      evidenceReader: {
        getEvidenceMetadata: async () => ({
          evidenceReference: null,
          title: null,
          evidenceType: null,
          description: null,
          relatedDeliverable: null,
          externalReference: null,
          fileCount: 0,
          latestUpdateTimestamp: null,
        }),
      } as Parameters<typeof observer>[0]["evidenceReader"],
    });

    // 9. Plan next action
    const planningResult = await planner({
      agentId: agent.id,
      now,
      store: store as unknown as Parameters<typeof planner>[0]["store"],
    });

    // 10. Verify plan is not stale
    if (
      isPlanStale({
        agent,
        planVersion: 1,
        caseVersionHash: planningResult.caseVersionHash,
        evidenceVersionHash: planningResult.evidenceVersionHash,
      })
    ) {
      actionResult = { kind: "stale_plan" };
      return {
        workerIterationId: iterationId,
        agentId: agent.id,
        outcome: "processed",
        actionDispatched: actionResult,
      };
    }

    // 11. Dispatch control action
    const { result, agent: updatedAgent } = await dispatchControlAction({
      agent,
      plan: planningResult.plan,
      action: planningResult.nextAction,
      leaseContext,
      now,
      store,
      executor: actionExecutor,
    });

    actionResult = result;
    processedAgent = updatedAgent;

    return {
      workerIterationId: iterationId,
      agentId: agent.id,
      outcome: "processed",
      actionDispatched: actionResult,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown worker error";
    // Ensure no secrets leak in error messages
    const safeError = errorMessage
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/private\s*key/gi, "")
      .replace(/ciphertext/gi, "")
      .replace(/authenticationTag/gi, "");

    return {
      workerIterationId: iterationId,
      agentId: processedAgent?.id ?? null,
      outcome: "error",
      actionDispatched: actionResult,
      error: safeError.substring(0, 500),
    };
  } finally {
    // ALWAYS release the lease
    if (leaseContext) {
      try {
        await store.releaseAgentLease(
          leaseContext.agentId,
          leaseContext.ownerToken,
        );
      } catch {
        // Lease release failure is logged but not reported — lease will expire
      }
    }
  }
}
