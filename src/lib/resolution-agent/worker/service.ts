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
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import { transitionAgentStatus } from "../state-machine";
import { evaluateResolutionAgentResumption } from "../resumer";
import type { EvidenceRequestRow } from "../store/types";
import {
  EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC,
  CASE_REFRESH_PRICE_ATOMIC,
  DISPUTE_BRIEF_PRICE_ATOMIC,
} from "../tools";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
} from "../types";
import {
  computeEvidenceCheckHash,
  EVIDENCE_CHECK_SERVICE_IDENTIFIER,
} from "../../x402/requestHash";
import type { EvidenceCheckIdentity } from "../../x402/requestHash";
import {
  computeCaseRefreshHashFromInput,
} from "../../x402/caseRefreshRequestHash";
import { keccak256, stringToHex } from "viem";

// ---------------------------------------------------------------------------
// Canonical tool configuration constants
// ---------------------------------------------------------------------------

const CANONICAL_PRICE = EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC;
const CANONICAL_NETWORK = AGENT_FACILITATOR_NETWORK;
const CANONICAL_ASSET = AGENT_MAINNET_USDC_ADDRESS;
const CANONICAL_PAY_TO = AGENT_PAY_TO_ADDRESS;

const CANONICAL_TOOL_IDS = [
  "evidence-quality-check",
  "case-refresh",
  "reclaim-dispute-brief-v1",
] as const;

// ---------------------------------------------------------------------------
// Recover a missing tool execution from durable state
//
// When an agent is in running_tool with reserved budget but no execution
// row exists (process crashed after reservation), this function creates
// the missing execution using the persisted plan hashes and canonical config.
//
// The budget is ALREADY reserved — no additional budget change occurs.
//
// Supports both evidence-quality-check and case-refresh tool IDs.
// ---------------------------------------------------------------------------

async function recoverMissingExecution(params: {
  agent: ResolutionAgent;
  store: ResolutionAgentWorkerDependencies["store"];
}): Promise<ActionExecutionResult | null> {
  const { agent, store } = params;

  // Only recover when currentRunningToolId is a known tool ID
  const toolId = agent.currentRunningToolId;
  if (!toolId || !(CANONICAL_TOOL_IDS as readonly string[]).includes(toolId)) {
    return null;
  }

  const plan = agent.plan;
  if (!plan) return null;

  const caseVersionHash = plan.caseVersionHash;
  const evidenceVersionHash = plan.evidenceVersionHash;

  if (!caseVersionHash || !evidenceVersionHash) return null;

  // Resolve canonical config based on tool
  let price: bigint;
  if (toolId === "case-refresh") {
    price = CASE_REFRESH_PRICE_ATOMIC;
  } else if (toolId === "reclaim-dispute-brief-v1") {
    price = DISPUTE_BRIEF_PRICE_ATOMIC;
  } else {
    price = CANONICAL_PRICE;
  }

  // Reconstruct the deterministic request hash
  let requestHash: string;
  if (toolId === "case-refresh") {
    const fallbackInput = {
      escrowPaymentId: agent.identity.escrowPaymentId,
      agreementLabel: "Case Refresh (recovery)",
      deliverableSummary: `Recovery for ${agent.identity.escrowPaymentId}`,
      deliveryFormat: "digital",
      releaseRule: "standard",
      evidenceExpectation: "Relevant evidence for dispute resolution",
      escrowState: "unknown",
      caseVersionHash,
      evidenceVersionHash,
      evidenceAvailability: "none",
      evidenceCount: 0,
      openEvidenceRequests: [],
      fulfilledEvidenceRequests: [],
    };
    requestHash = computeCaseRefreshHashFromInput(
      fallbackInput,
      agent.caseWalletAddress,
      CANONICAL_NETWORK,
      CANONICAL_ASSET,
      CANONICAL_PAY_TO,
      String(price),
    );
  } else if (toolId === "reclaim-dispute-brief-v1") {
    // For dispute brief recovery, we build a minimal hash using
    // the case/evidence version hashes and service identifier.
    const disputeInputHash = [
      "reclaim-dispute-brief-v1",
      agent.identity.escrowPaymentId,
      caseVersionHash,
      evidenceVersionHash,
    ].join(":");
    const parts: string[] = [];
    if (agent.identity.escrowChainId && agent.identity.escrowContractAddress) {
      parts.push(
        `escrow:${agent.identity.escrowChainId}:${agent.identity.escrowContractAddress.toLowerCase()}`,
      );
    }
    parts.push(
      "reclaim-dispute-brief-v1",
      agent.identity.escrowPaymentId,
      disputeInputHash,
      agent.caseWalletAddress.toLowerCase(),
      CANONICAL_NETWORK,
      String(DISPUTE_BRIEF_PRICE_ATOMIC),
      CANONICAL_PAY_TO.toLowerCase(),
      "exact",
      CANONICAL_ASSET.toLowerCase(),
    );
    requestHash = keccak256(stringToHex(parts.join(":")));
  } else {
    const evidenceInputHash = `${EVIDENCE_CHECK_SERVICE_IDENTIFIER}:${agent.identity.escrowPaymentId}:${caseVersionHash}:${evidenceVersionHash}`;
    const identity: EvidenceCheckIdentity = {
      service: EVIDENCE_CHECK_SERVICE_IDENTIFIER,
      escrowChainId: agent.identity.escrowChainId,
      escrowContractAddress: agent.identity.escrowContractAddress,
      escrowPaymentId: agent.identity.escrowPaymentId,
      payer: agent.caseWalletAddress.toLowerCase(),
      paymentNetwork: CANONICAL_NETWORK,
      asset: CANONICAL_ASSET.toLowerCase(),
      payTo: CANONICAL_PAY_TO.toLowerCase(),
      amount: String(CANONICAL_PRICE),
      scheme: "exact",
      evidenceInputHash,
    };
    requestHash = computeEvidenceCheckHash(identity);
  }

  // Check if execution already exists
  const existing = await store.getToolExecutionByRequestHash(
    agent.id,
    requestHash,
  );

  if (existing) {
    return { kind: "recovered", recoveryOutcome: "existing_execution_found" };
  }

  // No execution exists — create one. Budget is already reserved.
  try {
    await store.createToolExecution(
      agent.id,
      toolId,
      requestHash,
      price,
      CANONICAL_NETWORK,
      CANONICAL_ASSET,
      CANONICAL_PAY_TO,
    );
  } catch {
    return { kind: "recovered", recoveryOutcome: "execution_created_concurrently" };
  }

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
    { toolId, requestHash },
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
      //     The agent has a running tool with malformed or missing plan data.
      //     Transition to failed_recoverable (once only), preserve the
      //     reservation, and return a result indicating manual reconciliation.
      if (agent.status !== "failed_recoverable") {
        const version = await store.getAgentVersion(agent.id);
        const failedAgent = transitionAgentStatus(agent, "failed_recoverable", { now });
        try {
          await store.updateAgent(failedAgent, version);
        } catch {
          // Best-effort — version may have changed concurrently
        }
        await store.appendEvent(
          agent.id,
          "tool_execution_recovery_failed",
          "Cannot recover — malformed or missing plan data for running tool",
          "running_tool",
          "failed_recoverable",
          { toolId: agent.currentRunningToolId ?? "unknown" },
        );
      }

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
      evidenceReader: new SupabaseEvidenceReader() as Parameters<typeof observer>[0]["evidenceReader"],
    });

    // 8a. Reload agent after observation (observer persists updated observation)
    const observedAgent = await store.getAgentById(agent.id);
    if (!observedAgent) {
      return {
        workerIterationId: iterationId,
        agentId: agent.id,
        outcome: "error",
        actionDispatched: null,
        error: "Agent not found after observation",
      };
    }

    // 8b. If waiting_for_evidence, evaluate automatic resumption
    if (observedAgent.status === "waiting_for_evidence") {
      let evidenceRequests: EvidenceRequestRow[] = [];
      try {
        evidenceRequests = await store.listEvidenceRequests(observedAgent.id);
      } catch {
        // Best-effort — if listEvidenceRequests fails, let planner handle it
      }

      const resumptionDecision = evaluateResolutionAgentResumption({
        agent: observedAgent,
        evidenceRequests,
        now,
      });

      if (resumptionDecision.kind === "resume") {
        const version = await store.getAgentVersion(observedAgent.id);
        const resumedAgent = transitionAgentStatus(
          observedAgent,
          "active",
          { now },
        );
        try {
          await store.updateAgent(resumedAgent, version);
        } catch {
          // Version conflict — another worker may have already resumed
          actionResult = { kind: "skipped", reason: "Concurrent resumption — agent already active" };
          processedAgent = observedAgent;
          return {
            workerIterationId: iterationId,
            agentId: observedAgent.id,
            outcome: "processed",
            actionDispatched: actionResult,
          };
        }
        await store.appendEvent(
          observedAgent.id,
          "agent_resumed_after_evidence",
          `Agent automatically resumed after evidence request resolution: ${resumptionDecision.reasonCode}`,
          observedAgent.status,
          resumedAgent.status,
          {
            reasonCode: resumptionDecision.reasonCode,
            requestedCount: evidenceRequests.length,
          },
        );

        processedAgent = resumedAgent;
        actionResult = { kind: "executed" };
        return {
          workerIterationId: iterationId,
          agentId: observedAgent.id,
          outcome: "processed",
          actionDispatched: actionResult,
        };
      }

      if (resumptionDecision.kind === "failed_recoverable") {
        if ((observedAgent as ResolutionAgent).status !== "failed_recoverable") {
          const version = await store.getAgentVersion(observedAgent.id);
          const failedAgent = transitionAgentStatus(
            observedAgent,
            "failed_recoverable",
            { now },
          );
          try {
            await store.updateAgent(failedAgent, version);
          } catch {
            // Best-effort
          }
          await store.appendEvent(
            observedAgent.id,
            "agent_resumption_failed",
            `Malformed waiting state: ${resumptionDecision.reasonCode}`,
            observedAgent.status,
            failedAgent.status,
            { reasonCode: resumptionDecision.reasonCode },
          );
          processedAgent = failedAgent;
        } else {
          processedAgent = observedAgent;
        }

        actionResult = {
          kind: "failed_recoverable",
          reason: `Malformed waiting state: ${resumptionDecision.reasonCode}`,
        };
        return {
          workerIterationId: iterationId,
          agentId: observedAgent.id,
          outcome: "processed",
          actionDispatched: actionResult,
        };
      }

      // stay_waiting — fall through to planner, which will produce wait_for_evidence
      processedAgent = observedAgent;
    } else {
      processedAgent = observedAgent;
    }

    // 9. Plan next action
    const planningResult = await planner({
      agentId: processedAgent.id,
      now,
      store: store as unknown as Parameters<typeof planner>[0]["store"],
    });

    // 10. Verify plan is not stale
    if (
      isPlanStale({
        agent: processedAgent,
        planVersion: 1,
        caseVersionHash: planningResult.caseVersionHash,
        evidenceVersionHash: planningResult.evidenceVersionHash,
      })
    ) {
      actionResult = { kind: "stale_plan" };
      return {
        workerIterationId: iterationId,
        agentId: processedAgent.id,
        outcome: "processed",
        actionDispatched: actionResult,
      };
    }

    // 11. Dispatch control action
    const { result, agent: updatedAgent } = await dispatchControlAction({
      agent: processedAgent,
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
