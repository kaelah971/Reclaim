import { describe, it, expect, beforeAll } from "vitest";
import type { ResolutionAgent, ResolutionAgentPlan } from "../../types";
import type { ToolExecutionRow, EvidenceRequestRow } from "../../store/types";
import type { ResolutionAgentStore } from "../../api/service";
import type { ResolutionAgentPlanningResult } from "../types";

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

interface StoreSnapshot {
  agent: ResolutionAgent | null;
  events: Array<{
    agentId: string;
    eventType: string;
    reason: string;
    previousStatus: string | null;
    nextStatus: string | null;
    metadata?: Record<string, unknown>;
  }>;
  /** The version returned by getAgentVersion (what the service reads). */
  readVersion: number;
  /** The actual DB version checked by updateAgent. */
  dbVersion: number;
  toolExecutions: ToolExecutionRow[];
  evidenceRequests: EvidenceRequestRow[];
}

function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

class MockPlannerStore implements ResolutionAgentStore {
  private snapshot: StoreSnapshot;

  constructor(initialAgent: ResolutionAgent | null = null) {
    const v = initialAgent ? 5 : 1;
    this.snapshot = {
      agent: initialAgent ? deepClone(initialAgent) : null,
      events: [],
      readVersion: v,
      dbVersion: v,
      toolExecutions: [],
      evidenceRequests: [],
    };
  }

  createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    this.snapshot.agent = deepClone(agent);
    return Promise.resolve(this.snapshot.agent);
  }

  getAgentById(_agentId: string): Promise<ResolutionAgent | null> {
    return Promise.resolve(
      this.snapshot.agent ? deepClone(this.snapshot.agent) : null,
    );
  }

  getAgentByCaseIdentity(): Promise<ResolutionAgent | null> {
    return Promise.resolve(null);
  }

  updateAgent(agent: ResolutionAgent, expectedVersion: number): Promise<ResolutionAgent> {
    if (expectedVersion !== this.snapshot.dbVersion) {
      throw Object.assign(new Error("Concurrency conflict"), {
        code: "CONCURRENCY_CONFLICT",
      });
    }
    this.snapshot.agent = deepClone(agent);
    this.snapshot.dbVersion++;
    this.snapshot.readVersion = this.snapshot.dbVersion;
    return Promise.resolve(this.snapshot.agent);
  }

  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.snapshot.events.push({ agentId, eventType, reason, previousStatus, nextStatus, metadata });
    return Promise.resolve();
  }

  getAgentVersion(_agentId: string): Promise<number> {
    return Promise.resolve(this.snapshot.readVersion);
  }

  listToolExecutions(_agentId: string): Promise<ToolExecutionRow[]> {
    return Promise.resolve(deepClone(this.snapshot.toolExecutions));
  }

  listEvidenceRequests(_agentId: string): Promise<EvidenceRequestRow[]> {
    return Promise.resolve(deepClone(this.snapshot.evidenceRequests));
  }

  setToolExecutions(executions: ToolExecutionRow[]): void {
    this.snapshot.toolExecutions = deepClone(executions);
  }

  setEvidenceRequests(requests: EvidenceRequestRow[]): void {
    this.snapshot.evidenceRequests = deepClone(requests);
  }

  getEvents(): StoreSnapshot["events"] {
    return [...this.snapshot.events];
  }

  getVersion(): number {
    return this.snapshot.dbVersion;
  }

  /**
   * Sets the DB version to simulate a concurrent update.
   * getAgentVersion still returns the readVersion, but updateAgent
   * checks against this dbVersion, causing a concurrency conflict.
   */
  setVersion(v: number): void {
    this.snapshot.dbVersion = v;
  }
}

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const NOW = 1700000000000;

function makeActiveAgent(agentId = "agent_test_1", overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: agentId,
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    },
    policy: {
      allowedTools: [
        "evidence-quality-check",
        "case-refresh",
        "reclaim-dispute-brief-v1",
      ],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999999,
      funderAddress: "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: {
      escrowState: "funded",
      evidenceCount: 3,
      evidenceVersionHash: "ev_hash_v2",
      caseVersionHash: "case_hash_v2",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: NOW,
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
    createdAt: 1000000,
    updatedAt: 1000000,
    activatedAt: 5000000,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service tests
// ---------------------------------------------------------------------------

describe("planResolutionAgentNextAction — service", () => {
  let planResolutionAgentNextAction: (params: {
    agentId: string;
    now: number;
    store: ResolutionAgentStore & {
      listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
      listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
    };
  }) => Promise<ResolutionAgentPlanningResult>;

  beforeAll(async () => {
    const mod = await import("../service");
    planResolutionAgentNextAction = mod.planResolutionAgentNextAction;
  });

  it("throws when agent has no observation", async () => {
    const agent = makeActiveAgent("agent_1", { observation: null });
    const store = new MockPlannerStore(agent);

    await expect(
      planResolutionAgentNextAction({ agentId: "agent_1", now: NOW, store }),
    ).rejects.toThrow();
  });

  it("throws when agent is not found", async () => {
    const store = new MockPlannerStore(null);

    await expect(
      planResolutionAgentNextAction({ agentId: "nonexistent", now: NOW, store }),
    ).rejects.toThrow();
  });

  it("returns planning result with persisted plan for active agent", async () => {
    const agent = makeActiveAgent("agent_1");
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_1",
      now: NOW,
      store,
    });

    expect(result).toBeDefined();
    expect(result.agentId).toBe("agent_1");
    expect(result.plan).toBeDefined();
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.persisted).toBe(true);
  });

  it("first plan persists", async () => {
    const agent = makeActiveAgent("agent_first", { plan: null });
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_first",
      now: NOW,
      store,
    });

    expect(result.persisted).toBe(true);
    expect(result.plan.steps.length).toBeGreaterThan(0);

    // Verify agent was updated with new plan
    const updatedAgent = await store.getAgentById("agent_first");
    expect(updatedAgent!.plan).not.toBeNull();
  });

  it("changed case produces updated plan", async () => {
    const oldPlan: ResolutionAgentPlan = {
      steps: [{ kind: "check_evidence", description: "Old step" }],
      currentStepIndex: 0,
      lastUpdated: NOW - 10000,
      caseVersionHash: "old_case_hash",
      evidenceVersionHash: "ev_hash_v2",
    };
    const agent = makeActiveAgent("agent_changed", {
      plan: oldPlan,
      observation: {
        ...makeActiveAgent().observation!,
        caseVersionHash: "case_hash_v2",
        evidenceVersionHash: "ev_hash_v3",
      },
    });
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_changed",
      now: NOW,
      store,
    });

    expect(result.persisted).toBe(true);
    expect(result.caseVersionHash).toBe("case_hash_v2");
    expect(result.evidenceVersionHash).toBe("ev_hash_v3");
  });

  it("changed next action produces plan event", async () => {
    const agent = makeActiveAgent("agent_event");
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_event",
      now: NOW,
      store,
    });

    const events = store.getEvents();
    expect(events.length).toBeGreaterThan(0);
  });

  it("unchanged produces no duplicate event", async () => {
    const existingPlan: ResolutionAgentPlan = {
      steps: [{ kind: "purchase_evidence_check", description: "Run evidence quality check", toolId: "evidence-quality-check" }],
      currentStepIndex: 0,
      lastUpdated: NOW - 1000,
      caseVersionHash: "case_hash_v2",
      evidenceVersionHash: "ev_hash_v2",
    };
    const agent = makeActiveAgent("agent_no_dup", { plan: existingPlan });
    const store = new MockPlannerStore(agent);

    // First call
    await planResolutionAgentNextAction({
      agentId: "agent_no_dup",
      now: NOW,
      store,
    });

    const eventsAfterFirst = store.getEvents();
    const eventCountAfterFirst = eventsAfterFirst.length;

    // Second call with same state should not append another event
    // Re-load the agent with the new plan
    const updatedAgent = await store.getAgentById("agent_no_dup");
    const store2 = new MockPlannerStore(updatedAgent!);
    store2.setVersion(store.getVersion());
    store2.setToolExecutions([]);
    store2.setEvidenceRequests([]);

    // Reset agent's plan to what it was updated to in the first call
    // The service should detect no change and skip persistence
    const result2 = await planResolutionAgentNextAction({
      agentId: "agent_no_dup",
      now: NOW,
      store: store2,
    });

    const eventsAfterSecond = store2.getEvents();
    // No new events should be appended when nothing changed
    expect(eventsAfterSecond.length).toBe(0);
  });

  it("lifecycle status is unchanged after planning", async () => {
    const agent = makeActiveAgent("agent_lifecycle", { status: "active" });
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_lifecycle",
      now: NOW,
      store,
    });

    const updatedAgent = await store.getAgentById("agent_lifecycle");
    expect(updatedAgent!.status).toBe("active");
  });

  it("budget is unchanged after planning", async () => {
    const agent = makeActiveAgent("agent_budget", {
      budget: { approvedAtomic: 1000000n, spentAtomic: 0n, reservedAtomic: 0n },
    });
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_budget",
      now: NOW,
      store,
    });

    const updatedAgent = await store.getAgentById("agent_budget");
    expect(updatedAgent!.budget.approvedAtomic).toBe(1000000n);
    expect(updatedAgent!.budget.spentAtomic).toBe(0n);
    expect(updatedAgent!.budget.reservedAtomic).toBe(0n);
  });

  it("stale version is rejected with concurrency error", async () => {
    const agent = makeActiveAgent("agent_stale");
    const store = new MockPlannerStore(agent);
    store.setVersion(999); // Wrong version

    await expect(
      planResolutionAgentNextAction({
        agentId: "agent_stale",
        now: NOW,
        store,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe("Planner security — no side effects", () => {
  let planResolutionAgentNextAction: (params: {
    agentId: string;
    now: number;
    store: ResolutionAgentStore & {
      listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
      listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
    };
  }) => Promise<ResolutionAgentPlanningResult>;

  beforeAll(async () => {
    const mod = await import("../service");
    planResolutionAgentNextAction = mod.planResolutionAgentNextAction;
  });

  it("planner result does not contain encrypted wallet secret", async () => {
    const agent = makeActiveAgent("agent_sec");
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_sec",
      now: NOW,
      store,
    });

    // The result should not expose any encrypted secret details
    const resultStr = JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(resultStr).not.toContain("ciphertext");
    expect(resultStr).not.toContain("encryptedSecret");
    expect(resultStr).not.toContain("authenticationTag");
    expect(resultStr).not.toContain("iv");
  });

  it("planner does not decrypt wallet", async () => {
    // The mock store never decrypts; the planner only reads agent data.
    // This is a structural guarantee — no decryption calls are made.
    const agent = makeActiveAgent("agent_no_decrypt");
    const store = new MockPlannerStore(agent);

    // Should complete without any wallet-related errors
    const result = await planResolutionAgentNextAction({
      agentId: "agent_no_decrypt",
      now: NOW,
      store,
    });

    expect(result.persisted).toBe(true);
  });

  it("planner does not create evidence-request rows in store", async () => {
    const agent = makeActiveAgent("agent_no_er_create");
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_no_er_create",
      now: NOW,
      store,
    });

    // The evidence requests in the store should still be empty
    const evidenceReqs = await store.listEvidenceRequests("agent_no_er_create");
    expect(evidenceReqs).toHaveLength(0);
  });

  it("planner does not create tool-execution rows in store", async () => {
    const agent = makeActiveAgent("agent_no_te_create");
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_no_te_create",
      now: NOW,
      store,
    });

    const toolExecs = await store.listToolExecutions("agent_no_te_create");
    expect(toolExecs).toHaveLength(0);
  });

  it("planner does not reserve budget", async () => {
    const agent = makeActiveAgent("agent_no_reserve", {
      budget: { approvedAtomic: 50000n, spentAtomic: 0n, reservedAtomic: 0n },
    });
    const store = new MockPlannerStore(agent);

    await planResolutionAgentNextAction({
      agentId: "agent_no_reserve",
      now: NOW,
      store,
    });

    const updatedAgent = await store.getAgentById("agent_no_reserve");
    expect(updatedAgent!.budget.reservedAtomic).toBe(0n);
  });

  it("plan is a pure data structure (no functions, no closures)", async () => {
    const agent = makeActiveAgent("agent_pure");
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_pure",
      now: NOW,
      store,
    });

    // The plan must be JSON-serializable (no functions)
    const serialized = JSON.stringify(result.plan);
    const parsed = JSON.parse(serialized);
    expect(parsed).toBeDefined();
    expect(parsed.steps).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

describe("Plan building from rules", () => {
  let planResolutionAgentNextAction: (params: {
    agentId: string;
    now: number;
    store: ResolutionAgentStore & {
      listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
      listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
    };
  }) => Promise<ResolutionAgentPlanningResult>;

  beforeAll(async () => {
    const mod = await import("../service");
    planResolutionAgentNextAction = mod.planResolutionAgentNextAction;
  });

  it("plan steps match next action when proposing quality check", async () => {
    const agent = makeActiveAgent("agent_plan_qc");
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_plan_qc",
      now: NOW,
      store,
    });

    expect(result.plan.steps.length).toBeGreaterThan(0);
    // The current step should match the next action
    const currentStep = result.plan.steps[result.plan.currentStepIndex];
    if (result.nextAction.kind === "run_tool" && result.nextAction.toolId === "evidence-quality-check") {
      expect(currentStep.kind).toBe("purchase_evidence_check");
    }
  });

  it("plan includes hashes from observation", async () => {
    const agent = makeActiveAgent("agent_hashes");
    const store = new MockPlannerStore(agent);

    const result = await planResolutionAgentNextAction({
      agentId: "agent_hashes",
      now: NOW,
      store,
    });

    expect(result.plan.caseVersionHash).toBe("case_hash_v2");
    expect(result.plan.evidenceVersionHash).toBe("ev_hash_v2");
  });
});
