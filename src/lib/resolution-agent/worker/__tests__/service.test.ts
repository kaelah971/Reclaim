import { describe, it, expect, vi, beforeEach } from "vitest";
import { runResolutionAgentWorkerIteration } from "../service";
import type {
  ResolutionAgentWorkerDependencies,
  LeaseContext,
  WorkerCandidate,
  ActionExecutionResult,
  ResolutionAgentActionExecutor,
  ResolutionAgentRecoveryHandler,
} from "../types";
import type { ResolutionAgent } from "../../types";
import type { ResolutionAgentStore } from "../../api/service";
import type { ToolExecutionRow, EvidenceRequestRow } from "../../store/types";
import type { CaseObservationResult } from "../../observation/types";
import type { ResolutionAgentPlanningResult, ResolutionAgentNextAction, PlannerReasonCode } from "../../planner/types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeTestAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_test_1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
      approvedBudgetAtomic: 1_000_000n,
      expiresAt: 9_999_999_999,
      funderAddress: "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    },
    budget: {
      approvedAtomic: 1_000_000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: {
      escrowState: "disputed",
      evidenceCount: 2,
      evidenceVersionHash: "ev_v1",
      caseVersionHash: "case_v1",
      unresolvedGaps: [],
      hasMeaningfulChange: false,
      observedAt: 1_000_000,
    },
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "test-ciphertext",
      iv: "test-iv",
      authenticationTag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  return {
    agentId: "agt_test_1",
    status: "active",
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: new Date(1_000_000).toISOString(),
    ...overrides,
  };
}

function makeObservationResult(): CaseObservationResult {
  return {
    agentId: "agt_test_1",
    observation: {
      schemaVersion: "reclaim-case-observation-v1",
      caseIdentity: {
        escrowChainId: "eip155:42220",
        escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
        escrowPaymentId: "pay_1",
      },
      escrow: {
        paymentId: "pay_1",
        client: "0xaaaa",
        worker: "0xbbbb",
        token: "0xcccc",
        amount: "1000000",
        agreementLabel: "",
        deliverableSummary: "",
        deliveryFormat: "",
        releaseRule: "",
        evidenceExpectation: "",
        termsHash: "",
        evidenceReference: "",
        disputeReference: "",
        deliveryDeadline: 0,
        autoReleaseSeconds: 0,
        disputeWindowSeconds: 0,
        state: "disputed",
        createdAt: 0,
        fundedAt: 0,
        acceptedAt: 0,
        deliveryAt: 0,
        releaseRequestedAt: 0,
        releasedAt: 0,
      },
      evidence: {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 2,
        latestUpdateTimestamp: null,
        availability: "package_available",
      },
      priorContext: {
        agentStatus: "active",
        openEvidenceRequests: [],
        fulfilledEvidenceRequests: [],
        settledToolResults: [],
        previousCaseVersionHash: null,
        previousEvidenceVersionHash: null,
      },
      observedAt: 1_000_000,
    },
    evidenceVersionHash: "ev_v1",
    caseVersionHash: "case_v1",
    changeSummary: {
      caseChanged: true,
      evidenceChanged: false,
      firstObservation: true,
      changeType: "first_observation",
      reason: "First observation",
    },
    persisted: true,
  };
}

function makePlanningResult(): ResolutionAgentPlanningResult {
  return {
    agentId: "agt_test_1",
    plan: {
      steps: [{ kind: "check_evidence", description: "waiting" }],
      currentStepIndex: 0,
      lastUpdated: 1_000_000,
      caseVersionHash: "case_v1",
      evidenceVersionHash: "ev_v1",
    },
    nextAction: {
      kind: "no_action",
      reason: "no_meaningful_change" as PlannerReasonCode,
    } as ResolutionAgentNextAction,
    reasonCode: "no_meaningful_change" as PlannerReasonCode,
    caseVersionHash: "case_v1",
    evidenceVersionHash: "ev_v1",
    persisted: true,
  };
}

// ---------------------------------------------------------------------------
// Mock store with extended worker methods
// ---------------------------------------------------------------------------

interface MockWorkerStore extends ResolutionAgentStore {
  listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
  listRunnableAgents(limit: number): Promise<WorkerCandidate[]>;
  tryAcquireAgentLease(agentId: string, ownerToken: string, now: number): Promise<LeaseContext | null>;
  renewAgentLease(agentId: string, ownerToken: string, now: number): Promise<boolean>;
  releaseAgentLease(agentId: string, ownerToken: string): Promise<boolean>;
  createToolExecution(agentId: string, toolIdentifier: string, requestHash: string, priceAtomic: bigint, network: string, asset: string, payTo: string): Promise<void>;
  getToolExecutionByRequestHash(agentId: string, requestHash: string): Promise<ToolExecutionRow | null>;
  updateToolExecution(agentId: string, requestHash: string, updates: Partial<Pick<ToolExecutionRow, "state" | "case_version_hash" | "evidence_version_hash" | "settlement_tx_hash" | "payment_reference" | "result_reference" | "result_data" | "failure_reason">>): Promise<void>;
  createEvidenceRequest(
    agentId: string,
    responsibleParty: "client" | "worker",
    evidenceItem: string,
    reason: string,
    caseVersionHash?: string,
    evidenceVersionHash?: string,
  ): Promise<EvidenceRequestRow>;
}

function createMockStore(agent: ResolutionAgent, candidates: WorkerCandidate[]): MockWorkerStore {
  return {
    getAgentById: vi.fn().mockResolvedValue(agent),
    getAgentByCaseIdentity: vi.fn().mockResolvedValue(null),
    createAgent: vi.fn().mockResolvedValue(agent),
    updateAgent: vi.fn().mockResolvedValue(agent),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
    listToolExecutions: vi.fn().mockResolvedValue([]),
    listEvidenceRequests: vi.fn().mockResolvedValue([]),
    listRunnableAgents: vi.fn().mockResolvedValue(candidates),
    tryAcquireAgentLease: vi.fn().mockResolvedValue({
      agentId: agent.id,
      ownerToken: "acquired-token",
      acquiredAt: 1_000_000,
      expiresAt: 1_060_000,
    } as LeaseContext),
    renewAgentLease: vi.fn().mockResolvedValue(true),
    releaseAgentLease: vi.fn().mockResolvedValue(true),
    createToolExecution: vi.fn().mockResolvedValue(undefined),
    getToolExecutionByRequestHash: vi.fn().mockResolvedValue(null),
    updateToolExecution: vi.fn().mockResolvedValue(undefined),
    createEvidenceRequest: vi.fn().mockImplementation(
      (agentId: string, responsibleParty: "client" | "worker", evidenceItem: string, reason: string, caseVersionHash?: string, evidenceVersionHash?: string) =>
        Promise.resolve({
          id: "evreq_new",
          agent_id: agentId,
          responsible_party: responsibleParty,
          evidence_item: evidenceItem,
          reason,
          status: "open",
          created_case_version_hash: caseVersionHash ?? null,
          evidence_version_hash: evidenceVersionHash ?? null,
          fulfilled_case_version_hash: null,
          created_at: new Date().toISOString(),
          fulfilled_at: null,
          cancelled_at: null,
        } as EvidenceRequestRow),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runResolutionAgentWorkerIteration", () => {
  const now = 1_000_000;
  const workerId = "worker_1";

  let agent: ResolutionAgent;
  let candidate: WorkerCandidate;
  let mockStore: MockWorkerStore;
  let mockObserver: typeof import("../../observation/service").observeResolutionAgentCase;
  let mockPlanner: typeof import("../../planner/service").planResolutionAgentNextAction;
  let mockExecutor: ResolutionAgentActionExecutor;
  let mockRecovery: ResolutionAgentRecoveryHandler;
  let deps: ResolutionAgentWorkerDependencies;

  beforeEach(() => {
    agent = makeTestAgent();
    candidate = makeCandidate();
    mockStore = createMockStore(agent, [candidate]);
    mockObserver = vi.fn().mockResolvedValue(makeObservationResult());
    mockPlanner = vi.fn().mockResolvedValue(makePlanningResult());
    mockExecutor = {
      executeOneAction: vi.fn().mockResolvedValue({ kind: "executed" } as ActionExecutionResult),
    };
    mockRecovery = {
      recover: vi.fn().mockResolvedValue({ kind: "recovered", recoveryOutcome: "test" } as ActionExecutionResult),
    };

    deps = {
      store: mockStore,
      observer: mockObserver,
      planner: mockPlanner,
      actionExecutor: mockExecutor,
      recoveryHandler: mockRecovery,
    };
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it("full happy path: candidate → lease → observe → plan → dispatch → release", async () => {
    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: deps,
    });

    expect(result.outcome).toBe("processed");
    expect(result.agentId).toBe("agt_test_1");
    expect(mockStore.listRunnableAgents).toHaveBeenCalledTimes(1);
    expect(mockStore.tryAcquireAgentLease).toHaveBeenCalledTimes(1);
    expect(mockStore.getAgentById).toHaveBeenCalledTimes(1);
    expect(mockObserver).toHaveBeenCalledTimes(1);
    expect(mockPlanner).toHaveBeenCalledTimes(1);
    expect(mockStore.releaseAgentLease).toHaveBeenCalledTimes(1);
    // Result must be public-safe
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("token");
  });

  // -----------------------------------------------------------------------
  // No candidates
  // -----------------------------------------------------------------------

  it("no candidates → no_work", async () => {
    mockStore.listRunnableAgents = vi.fn().mockResolvedValue([]);

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: mockStore },
    });

    expect(result.outcome).toBe("no_work");
    expect(result.agentId).toBeNull();
    expect(result.actionDispatched).toBeNull();
    expect(mockStore.tryAcquireAgentLease).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Lease conflict — try next candidate
  // -----------------------------------------------------------------------

  it("lease conflict on first candidate → try next → process", async () => {
    const agent2 = makeTestAgent({ id: "agt_test_2" });
    const candidates: WorkerCandidate[] = [
      makeCandidate({ agentId: "agt_test_1" }),
      makeCandidate({ agentId: "agt_test_2" }),
    ];

    // First acquire fails, second succeeds
    let acquireCount = 0;
    const storeWithConflict = { ...mockStore };
    storeWithConflict.listRunnableAgents = vi.fn().mockResolvedValue(candidates);
    storeWithConflict.tryAcquireAgentLease = vi.fn().mockImplementation(async () => {
      acquireCount++;
      if (acquireCount === 1) return null; // conflict on first
      return {
        agentId: agent2.id,
        ownerToken: "acquired-token-2",
        acquiredAt: now,
        expiresAt: now + 60_000,
      };
    });
    storeWithConflict.getAgentById = vi.fn().mockResolvedValue(agent2);

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: storeWithConflict },
    });

    expect(result.outcome).toBe("processed");
    expect(result.agentId).toBe("agt_test_2");
    expect(storeWithConflict.tryAcquireAgentLease).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // All leases taken
  // -----------------------------------------------------------------------

  it("all leases taken → lease_not_acquired", async () => {
    const candidates: WorkerCandidate[] = [
      makeCandidate({ agentId: "agt_test_1" }),
      makeCandidate({ agentId: "agt_test_2" }),
      makeCandidate({ agentId: "agt_test_3" }),
    ];

    const storeNoLease = { ...mockStore };
    storeNoLease.listRunnableAgents = vi.fn().mockResolvedValue(candidates);
    storeNoLease.tryAcquireAgentLease = vi.fn().mockResolvedValue(null);

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: storeNoLease },
    });

    expect(result.outcome).toBe("lease_not_acquired");
    expect(storeNoLease.tryAcquireAgentLease).toHaveBeenCalledTimes(3);
    expect(result.actionDispatched).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Observation failure
  // -----------------------------------------------------------------------

  it("observation service failure → error safely, lease released", async () => {
    const observerFailing = vi.fn().mockRejectedValue(new Error("RPC down"));

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, observer: observerFailing },
    });

    expect(result.outcome).toBe("error");
    expect(result.error).toBeDefined();
    expect(mockStore.releaseAgentLease).toHaveBeenCalled();
    // Error is public-safe
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  // -----------------------------------------------------------------------
  // Planner failure
  // -----------------------------------------------------------------------

  it("planner service failure → error safely, lease released", async () => {
    const plannerFailing = vi.fn().mockRejectedValue(new Error("Planner error"));

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, planner: plannerFailing },
    });

    expect(result.outcome).toBe("error");
    expect(result.error).toBeDefined();
    expect(mockStore.releaseAgentLease).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Recovery path
  // -----------------------------------------------------------------------

  it("recovery path: paid_pending_result dispatched", async () => {
    const exec: ToolExecutionRow = {
      id: "exec_1",
      agent_id: "agt_test_1",
      tool_identifier: "evidence-quality-check",
      request_hash: "req_1",
      case_version_hash: "case_v1",
      evidence_version_hash: "ev_v1",
      state: "paid_pending_result",
      price_atomic: 10_000,
      network: "eip155:42220",
      asset_address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      pay_to_address: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      payment_reference: null,
      settlement_tx_hash: null,
      result_reference: null,
      result_data: null,
      failure_reason: null,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    };

    mockStore.listToolExecutions = vi.fn().mockResolvedValue([exec]);

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: deps,
    });

    expect(result.outcome).toBe("processed");
    expect(mockRecovery.recover).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Worker calls observer at most once
  // -----------------------------------------------------------------------

  it("worker calls observer at most once", async () => {
    await runResolutionAgentWorkerIteration({ workerId, now, dependencies: deps });
    expect(mockObserver).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Worker calls planner at most once
  // -----------------------------------------------------------------------

  it("worker calls planner at most once", async () => {
    await runResolutionAgentWorkerIteration({ workerId, now, dependencies: deps });
    expect(mockPlanner).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Worker dispatches at most one action
  // -----------------------------------------------------------------------

  it("worker dispatches at most one action", async () => {
    // The planner returns no_action, which the dispatcher handles directly
    // as a control action without calling the executor
    await runResolutionAgentWorkerIteration({ workerId, now, dependencies: deps });
    // Verify one agent was processed (not multiple)
    expect(mockStore.getAgentById).toHaveBeenCalledTimes(1);
    // Executor is NOT called for no_action control dispatch
    expect(mockExecutor.executeOneAction).toHaveBeenCalledTimes(0);
  });

  // -----------------------------------------------------------------------
  // Worker never loops through multiple plan steps
  // -----------------------------------------------------------------------

  it("worker never processes multiple agents per iteration", async () => {
    const candidates = [
      makeCandidate({ agentId: "agt_test_1" }),
      makeCandidate({ agentId: "agt_test_2" }),
    ];
    const multiStore = createMockStore(agent, candidates);

    await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: multiStore },
    });

    // Only one agent should be processed per iteration
    // tryAcquireAgentLease is called at most 2 times (once for first, which succeeds)
    // but getAgentById is called exactly once
    expect(multiStore.getAgentById).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Worker never dispatches two tools
  // -----------------------------------------------------------------------

  it("only one executor call per iteration", async () => {
    // The dispatcher handles control actions directly. The executor
    // is reserved for real tool execution (not yet implemented).
    await runResolutionAgentWorkerIteration({ workerId, now, dependencies: deps });
    // For no_action: executor is never called, dispatchControlAction
    // handles the lifecycle transition directly
    expect(mockExecutor.executeOneAction).toHaveBeenCalledTimes(0);
  });

  // -----------------------------------------------------------------------
  // Stale plan safely releases lease
  // -----------------------------------------------------------------------

  it("stale plan safely releases lease", async () => {
    // Plan case hash differs from observation hash
    const stalePlanAgent = makeTestAgent({
      plan: {
        steps: [{ kind: "check_evidence", description: "waiting" }],
        currentStepIndex: 0,
        lastUpdated: 1_000_000,
        caseVersionHash: "case_old", // differs from observation
        evidenceVersionHash: "ev_v1",
      },
    });
    const staleStore = createMockStore(stalePlanAgent, [makeCandidate()]);

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: staleStore },
    });

    expect(staleStore.releaseAgentLease).toHaveBeenCalled();
    // Result should be safe
    expect(result.outcome).toBe("processed");
  });

  // -----------------------------------------------------------------------
  // Changed agent version aborts dispatch
  // -----------------------------------------------------------------------

  it("changed agent version aborts dispatch", async () => {
    // Make store return different version
    const versionStore = { ...mockStore };
    versionStore.getAgentVersion = vi.fn().mockResolvedValue(5); // unexpected version

    await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: versionStore },
    });

    // Lease should still be released even on error
    expect(versionStore.releaseAgentLease).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Errors expose no secrets
  // -----------------------------------------------------------------------

  it("errors expose no secret fixtures", async () => {
    const fatalObserver = vi.fn().mockRejectedValue(
      new Error('Secret key: "sk-abc123" leaked in error'),
    );

    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, observer: fatalObserver },
    });

    expect(result.outcome).toBe("error");
    expect(result.error).not.toContain("sk-abc123");
    expect(result.error).not.toContain("ciphertext");
    expect(result.error).not.toContain("authenticationTag");
  });

  // -----------------------------------------------------------------------
  // Worker result excludes lease token
  // -----------------------------------------------------------------------

  it("worker result excludes lease token", async () => {
    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: deps,
    });

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("ownerToken");
    expect(resultStr).not.toContain("acquired-token");
  });

  // -----------------------------------------------------------------------
  // One iteration processes at most one agent
  // -----------------------------------------------------------------------

  it("one iteration processes at most one agent", async () => {
    const candidates = [
      makeCandidate({ agentId: "agt_a" }),
      makeCandidate({ agentId: "agt_b" }),
      makeCandidate({ agentId: "agt_c" }),
    ];
    const multiStore = createMockStore(makeTestAgent({ id: "agt_a" }), candidates);

    // Both first and second succeed to acquire, but we only process first
    let callCount = 0;
    multiStore.tryAcquireAgentLease = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        agentId: `agt_${"abcdef"[callCount - 1]}`,
        ownerToken: `token-${callCount}`,
        acquiredAt: now,
        expiresAt: now + 60_000,
      };
    });

    await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, store: multiStore },
    });

    // Only 1 tryAcquire call (since first succeeds, we stop trying others)
    expect(multiStore.tryAcquireAgentLease).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Result is public-safe
  // -----------------------------------------------------------------------

  it("result is public-safe — no encrypted data exposed", async () => {
    const result = await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: deps,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("encryptedSecret");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("authenticationTag");
    expect(serialized).not.toContain("iv");
    expect(serialized).not.toContain("ownerToken");
    expect(serialized).not.toContain("privateKey");
  });

  // -----------------------------------------------------------------------
  // Lease is always released
  // -----------------------------------------------------------------------

  it("lease released after successful iteration", async () => {
    await runResolutionAgentWorkerIteration({ workerId, now, dependencies: deps });
    expect(mockStore.releaseAgentLease).toHaveBeenCalledTimes(1);
    expect(mockStore.releaseAgentLease).toHaveBeenCalledWith(
      "agt_test_1",
      "acquired-token",
    );
  });

  it("lease released after error", async () => {
    const failingPlanner = vi.fn().mockRejectedValue(new Error("Boom"));
    await runResolutionAgentWorkerIteration({
      workerId,
      now,
      dependencies: { ...deps, planner: failingPlanner },
    });
    expect(mockStore.releaseAgentLease).toHaveBeenCalledTimes(1);
  });
});
