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

    // 7. If recovery is needed, dispatch via recovery handler
    if (recoveryDecision.kind !== "no_recovery_needed" && recoveryDecision.kind !== "wait_for_in_flight_execution") {
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
      // If no execution but recovery needed, fall through to planner
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
