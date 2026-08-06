// ---------------------------------------------------------------------------
// Cold-restart recovery tests — prove that a worker can recover from a
// process crash after budget reservation but before execution creation.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

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
import type { ResolutionAgentPlanningResult, ResolutionAgentNextAction } from "../../planner/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_crash_1",
    goal: "Prepare this payment case for fair human review.",
    status: "running_tool",
    identity: {
      escrowPaymentId: "pay_crash",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
      approvedBudgetAtomic: 100_000n,
      expiresAt: 9_999_999_999,
      funderAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    budget: { approvedAtomic: 100_000n, spentAtomic: 0n, reservedAtomic: 10_000n },
    plan: {
      steps: [{ kind: "purchase_evidence_check", description: "Run", toolId: "evidence-quality-check" }],
      currentStepIndex: 0,
      lastUpdated: 1_000_000,
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
    observation: {
      escrowState: "disputed",
      evidenceCount: 2,
      evidenceVersionHash: "ev_hash_v1",
      caseVersionHash: "case_hash_v1",
      unresolvedGaps: [],
      hasMeaningfulChange: false,
      observedAt: 1_000_000,
    },
    caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000",
    encryptedSecret: {
      version: 1, algorithm: "AES-256-GCM",
      ciphertext: "ct", iv: "iv", authenticationTag: "at",
    },
    settledToolIds: [],
    currentRunningToolId: "evidence-quality-check",
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    activatedAt: null, pausedAt: null, closedAt: null,
    ...overrides,
  };
}

function makeCandidate(agentId: string): WorkerCandidate {
  return {
    agentId,
    status: "running_tool",
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: new Date(1_000_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// In-memory store that simulates durable state
// ---------------------------------------------------------------------------

interface DurableStore extends ResolutionAgentStore {
  agents: Map<string, ResolutionAgent>;
  versions: Map<string, number>;
  executions: Map<string, ToolExecutionRow[]>;
  events: unknown[];
  [key: string]: unknown;
}

function createDurableStore(): DurableStore {
  const agents = new Map<string, ResolutionAgent>();
  const versions = new Map<string, number>();
  const executions = new Map<string, ToolExecutionRow[]>();
  const eventLog: unknown[] = [];

  const s: any = {
    agents, versions, executions, events: eventLog,

    getAgentById: vi.fn(async (id: string) => {
      const a = agents.get(id);
      return a ? { ...a } : null;
    }),
    getAgentVersion: vi.fn(async (id: string) => versions.get(id) ?? 1),
    updateAgent: vi.fn(async (a: ResolutionAgent, expected: number) => {
      const v = versions.get(a.id) ?? 0;
      if (v !== expected) throw new Error("concurrency");
      agents.set(a.id, { ...a });
      versions.set(a.id, v + 1);
      return a;
    }),
    appendEvent: vi.fn(async () => undefined),

    listToolExecutions: vi.fn(async (id: string) => {
      return (executions.get(id) ?? []).slice();
    }),
    listEvidenceRequests: vi.fn(async () => [] as EvidenceRequestRow[]),

    listRunnableAgents: vi.fn(async (limit: number) => {
      const candidates: WorkerCandidate[] = [];
      for (const [id, a] of agents) {
        if (candidates.length >= limit) break;
        candidates.push(makeCandidate(id));
      }
      return candidates;
    }),

    tryAcquireAgentLease: vi.fn(async (id: string, token: string, now: number) => {
      const a = agents.get(id);
      if (!a) return null;
      return { agentId: id, ownerToken: token, acquiredAt: now, expiresAt: now + 60_000 } as LeaseContext;
    }),
    renewAgentLease: vi.fn(async () => true),
    releaseAgentLease: vi.fn(async () => true),

    createToolExecution: vi.fn(async (
      agentId: string, toolId: string, requestHash: string,
      price: bigint, network: string, asset: string, payTo: string,
    ) => {
      if (!executions.has(agentId)) executions.set(agentId, []);
      const existing = executions.get(agentId)!.find((r) => r.request_hash === requestHash);
      if (existing) throw new Error("duplicate key");
      executions.get(agentId)!.push({
        id: `exec_${crypto.randomUUID().slice(0, 8)}`,
        agent_id: agentId,
        tool_identifier: toolId,
        request_hash: requestHash,
        case_version_hash: null, evidence_version_hash: null,
        state: "pending",
        price_atomic: Number(price), network, asset_address: asset.toLowerCase(), pay_to_address: payTo.toLowerCase(),
        payment_reference: null, settlement_tx_hash: null,
        result_reference: null, result_data: null, failure_reason: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }),

    getToolExecutionByRequestHash: vi.fn(async (id: string, hash: string) => {
      return (executions.get(id) ?? []).find((r) => r.request_hash === hash) ?? null;
    }),

    updateToolExecution: vi.fn(async (id: string, hash: string, updates: any) => {
      const rows = executions.get(id) ?? [];
      const idx = rows.findIndex((r) => r.request_hash === hash);
      if (idx >= 0) Object.assign(rows[idx], updates);
    }),

    getAgentByCaseIdentity: vi.fn(async () => null),
    createAgent: vi.fn(async (a: ResolutionAgent) => a),
  };
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cold-restart: reservation without execution", () => {
  let store: DurableStore;
  let deps: ResolutionAgentWorkerDependencies;
  let agent: ResolutionAgent;

  beforeEach(() => {
    store = createDurableStore();
    agent = makeAgent();

    // Persist the crashed state: running_tool + reserved + no execution
    store.agents.set(agent.id, { ...agent });
    store.versions.set(agent.id, 5);

    deps = {
      store: store as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "no_meaningful_change" } as ResolutionAgentNextAction,
        plan: agent.plan!,
        caseVersionHash: "case_hash_v1",
        evidenceVersionHash: "ev_hash_v1",
        agentId: agent.id, reasonCode: "no_meaningful_change", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };
  });

  it("worker creates exactly one execution for the missing tool", async () => {
    const result = await runResolutionAgentWorkerIteration({
      workerId: "restart_1",
      now: 2_000_000,
      dependencies: deps,
    });

    // Worker should have recovered
    expect(result.outcome).toBe("processed");

    // createToolExecution should have been called exactly once
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.createToolExecution as any).mock.calls.length).toBe(1);

    // Exactly one execution exists
    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1);

    // Execution is in "reserved" state
    expect(execs[0].state).toBe("reserved");
  });

  it("worker does NOT increase reservedAtomic during recovery", async () => {
    const budgetBefore = agent.budget.reservedAtomic;

    await runResolutionAgentWorkerIteration({
      workerId: "restart_2",
      now: 2_000_000,
      dependencies: deps,
    });

    const stored = store.agents.get(agent.id);
    expect(stored!.budget.reservedAtomic).toBe(budgetBefore);
  });

  it("second restart is idempotent (no duplicate execution)", async () => {
    // First recovery
    await runResolutionAgentWorkerIteration({
      workerId: "restart_3a", now: 2_000_000, dependencies: deps,
    });

    // Reset lease for second recovery
    store.tryAcquireAgentLease = vi.fn(async (id: string, token: string, now: number) => ({
      agentId: id, ownerToken: token, acquiredAt: now, expiresAt: now + 60_000,
    }));

    // Second recovery — should find existing execution, not create another
    await runResolutionAgentWorkerIteration({
      workerId: "restart_3b", now: 2_000_100, dependencies: deps,
    });

    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1);
  });

  it("recovery creates execution with plan's original hashes", async () => {
    await runResolutionAgentWorkerIteration({
      workerId: "restart_4", now: 2_000_000, dependencies: deps,
    });

    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1);
    expect(execs[0].case_version_hash).toBe("case_hash_v1");
    expect(execs[0].evidence_version_hash).toBe("ev_hash_v1");
  });

  it("worker detects running_tool via recovery classifier", async () => {
    // run the worker — the recovery decision should be mark_failed_recoverable
    // because currentRunningToolId is set but no execution exists
    // The worker's recoverMissingExecution should then handle it

    const result = await runResolutionAgentWorkerIteration({
      workerId: "restart_5", now: 2_000_000, dependencies: deps,
    });

    expect(result.outcome).toBe("processed");
    expect(store.createToolExecution).toHaveBeenCalled();
  });
});

describe("cold-restart: missing durable action identity", () => {
  it("recovery returns null when currentRunningToolId is not a known tool", async () => {
    const store2 = createDurableStore();
    const agent2 = makeAgent({ currentRunningToolId: "unknown-tool-xyz" as any });
    store2.agents.set(agent2.id, { ...agent2 });

    // For store.getAgentVersion, we need it to work
    store2.getAgentVersion = vi.fn(async (id: string) => 5);

    const deps2: ResolutionAgentWorkerDependencies = {
      store: store2 as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: agent2.plan!,
        caseVersionHash: "cv", evidenceVersionHash: "ev",
        agentId: agent2.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    await runResolutionAgentWorkerIteration({
      workerId: "restart_unk", now: 2_000_000, dependencies: deps2,
    });

    expect(store2.createToolExecution).not.toHaveBeenCalled();
  });

  it("recovery returns null when plan is null", async () => {
    const store3 = createDurableStore();
    const agent3 = makeAgent({ plan: null });
    store3.agents.set(agent3.id, { ...agent3 });

    // For store.getAgentVersion, we need it to work
    store3.getAgentVersion = vi.fn(async (id: string) => 5);

    const deps3: ResolutionAgentWorkerDependencies = {
      store: store3 as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: null as any, caseVersionHash: "cv", evidenceVersionHash: "ev",
        agentId: agent3.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    const result = await runResolutionAgentWorkerIteration({
      workerId: "restart_noplan", now: 2_000_000, dependencies: deps3,
    });

    expect(store3.createToolExecution).not.toHaveBeenCalled();
  });

  it("malformed recovery transitions agent to failed_recoverable and appends event", async () => {
    const storeMalformed = createDurableStore();
    // Agent with currentRunningToolId but no plan hashes (null plan)
    const agentMalformed = makeAgent({
      plan: null,
      currentRunningToolId: "evidence-quality-check",
    });
    storeMalformed.agents.set(agentMalformed.id, { ...agentMalformed });
    storeMalformed.versions.set(agentMalformed.id, 5);

    const depsMalformed: ResolutionAgentWorkerDependencies = {
      store: storeMalformed as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: null as any, caseVersionHash: "cv", evidenceVersionHash: "ev",
        agentId: agentMalformed.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    const result = await runResolutionAgentWorkerIteration({
      workerId: "malformed_recovery", now: 2_000_000, dependencies: depsMalformed,
    });

    // Should return error with failed_recoverable
    expect(result.outcome).toBe("error");
    expect(result.actionDispatched).toBeDefined();
    expect(result.actionDispatched!.kind).toBe("failed_recoverable");

    // The agent should have been transitioned to failed_recoverable
    const stored = storeMalformed.agents.get(agentMalformed.id);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("failed_recoverable");

    // An event should have been appended (tool_execution_recovery_failed)
    expect(storeMalformed.appendEvent).toHaveBeenCalled();
    const eventCalls = (storeMalformed.appendEvent as any).mock.calls;
    const recoveryFailedCall = eventCalls.find(
      (call: any[]) => call[1] === "tool_execution_recovery_failed",
    );
    expect(recoveryFailedCall).toBeDefined();
  });

  it("malformed recovery is idempotent — only transitions once", async () => {
    const storeIdem = createDurableStore();
    const agentIdem = makeAgent({
      plan: null,
      currentRunningToolId: "evidence-quality-check",
      status: "failed_recoverable", // Already in failed_recoverable
    });
    storeIdem.agents.set(agentIdem.id, { ...agentIdem });
    storeIdem.versions.set(agentIdem.id, 5);

    const depsIdem: ResolutionAgentWorkerDependencies = {
      store: storeIdem as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: null as any, caseVersionHash: "cv", evidenceVersionHash: "ev",
        agentId: agentIdem.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    await runResolutionAgentWorkerIteration({
      workerId: "idem_recovery", now: 2_000_000, dependencies: depsIdem,
    });

    // updateAgent should NOT have been called since agent is already failed_recoverable
    const updateCalls = (storeIdem.updateAgent as any).mock.calls;
    expect(updateCalls.length).toBe(0);

    // appendEvent should NOT have been called with recovery_failed
    const eventCalls = (storeIdem.appendEvent as any).mock.calls;
    const recoveryFailedCalls = eventCalls.filter(
      (call: any[]) => call[1] === "tool_execution_recovery_failed",
    );
    expect(recoveryFailedCalls.length).toBe(0);
  });

  it("malformed recovery preserves budget reservation", async () => {
    const storeBudget = createDurableStore();
    const agentBudget = makeAgent({
      plan: null,
      currentRunningToolId: "evidence-quality-check",
      budget: { approvedAtomic: 100_000n, spentAtomic: 0n, reservedAtomic: 10_000n },
    });
    storeBudget.agents.set(agentBudget.id, { ...agentBudget });
    storeBudget.versions.set(agentBudget.id, 5);

    const depsBudget: ResolutionAgentWorkerDependencies = {
      store: storeBudget as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: null as any, caseVersionHash: "cv", evidenceVersionHash: "ev",
        agentId: agentBudget.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    await runResolutionAgentWorkerIteration({
      workerId: "budget_preserve", now: 2_000_000, dependencies: depsBudget,
    });

    // Reservation should be preserved (not released)
    const stored = storeBudget.agents.get(agentBudget.id);
    expect(stored!.budget.reservedAtomic).toBe(10_000n);
  });
});

describe("cold-restart: hash change after reservation", () => {
  it("recovery uses plan's original hashes, not new observation hashes", async () => {
    const store4 = createDurableStore();
    const agent4 = makeAgent({
      plan: {
        steps: [{ kind: "purchase_evidence_check", description: "Run", toolId: "evidence-quality-check" }],
        currentStepIndex: 0,
        lastUpdated: 1_000_000,
        caseVersionHash: "case_hash_OLD",
        evidenceVersionHash: "ev_hash_OLD",
      },
      observation: {
        escrowState: "disputed", evidenceCount: 2,
        evidenceVersionHash: "ev_hash_NEW",
        caseVersionHash: "case_hash_NEW",
        unresolvedGaps: [], hasMeaningfulChange: true, observedAt: 2_000_000,
      },
    });
    store4.agents.set(agent4.id, { ...agent4 });

    const deps4: ResolutionAgentWorkerDependencies = {
      store: store4 as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "tool_already_running" },
        plan: agent4.plan!,
        caseVersionHash: "case_hash_NEW", evidenceVersionHash: "ev_hash_NEW",
        agentId: agent4.id, reasonCode: "tool_already_running", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    await runResolutionAgentWorkerIteration({
      workerId: "restart_hash", now: 2_000_000, dependencies: deps4,
    });

    const execs = store4.executions.get(agent4.id) ?? [];
    expect(execs.length).toBe(1);
    expect(execs[0].case_version_hash).toBe("case_hash_OLD");
    expect(execs[0].evidence_version_hash).toBe("ev_hash_OLD");
  });
});

describe("cold-restart: result excludes secrets", () => {
  it("worker result excludes encrypted secret", async () => {
    const storeSec = createDurableStore();
    const agentSec = makeAgent();
    storeSec.agents.set(agentSec.id, { ...agentSec });

    const depsSec: ResolutionAgentWorkerDependencies = {
      store: storeSec as any,
      observer: vi.fn().mockResolvedValue({} as CaseObservationResult),
      planner: vi.fn().mockResolvedValue({
        nextAction: { kind: "no_action", reason: "no_meaningful_change" },
        plan: agentSec.plan!,
        caseVersionHash: "case_hash_v1", evidenceVersionHash: "ev_hash_v1",
        agentId: agentSec.id, reasonCode: "no_meaningful_change", persisted: true,
      } as ResolutionAgentPlanningResult),
      actionExecutor: { executeOneAction: vi.fn() } as unknown as ResolutionAgentActionExecutor,
      recoveryHandler: { recover: vi.fn() } as unknown as ResolutionAgentRecoveryHandler,
    };

    const result = await runResolutionAgentWorkerIteration({
      workerId: "restart_sec", now: 2_000_000, dependencies: depsSec,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("token");
  });
});
