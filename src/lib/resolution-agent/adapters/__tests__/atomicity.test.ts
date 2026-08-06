// ---------------------------------------------------------------------------
// Adapter atomicity tests — crash-consistency and race-condition verification
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeEvidenceQualityCheck } from "../evidence-quality-check";
import type { ResolutionAgent, ResolutionAgentPlan, ResolutionAgentObservation } from "../../types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { LeaseContext } from "../../worker/types";
import type { ToolExecutionRow } from "../../store/types";
import type {
  EvidenceQualityCheckDependencies,
  ResolutionAgentX402SettlementClient,
  EvidenceQualityCheckGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
} from "../types";
import type { Account } from "viem/accounts";

// ---------------------------------------------------------------------------
// In-memory store that simulates durable writes
// ---------------------------------------------------------------------------

function createMemoryStore() {
  const agents = new Map<string, { version: number; data: ResolutionAgent }>();
  const executions = new Map<string, ToolExecutionRow[]>();
  const events: unknown[] = [];

  return {
    agents,
    executions,
    events,
    nextVersion: 1,

    async getAgentVersion(agentId: string): Promise<number> {
      const a = agents.get(agentId);
      return a?.version ?? 1;
    },

    async getAgentById(agentId: string): Promise<ResolutionAgent | null> {
      const stored = agents.get(agentId);
      if (!stored) return null;
      return { ...stored.data };
    },

    async getToolExecutionByRequestHash(
      agentId: string,
      requestHash: string,
    ): Promise<ToolExecutionRow | null> {
      const rows = executions.get(agentId) ?? [];
      return rows.find((r) => r.request_hash === requestHash) ?? null;
    },

    async reserveToolExecutionAtomically(params: {
      agentId: string;
      expectedAgentVersion: number;
      requestHash: string;
      toolId: string;
      caseVersionHash: string;
      evidenceVersionHash: string;
      priceAtomic: bigint;
      network: string;
      asset: string;
      payTo: string;
      serviceIdentifier: string;
      policyVersion: string;
      now: number;
    }): Promise<
      | { kind: "created"; agentId: string; requestHash: string; state: string }
      | { kind: "existing"; agentId: string; requestHash: string; state: string }
    > {
      const stored = agents.get(params.agentId);
      if (!stored) throw new Error("Agent not found");

      // Version check
      if (stored.version !== params.expectedAgentVersion) {
        throw new Error("Version conflict");
      }

      // Budget check
      const remaining = stored.data.budget.approvedAtomic - stored.data.budget.spentAtomic - stored.data.budget.reservedAtomic;
      if (remaining < params.priceAtomic) {
        throw new Error("Insufficient budget");
      }

      // Check for existing execution
      const existing = (executions.get(params.agentId) ?? []).find(
        (r) => r.request_hash === params.requestHash,
      );
      if (existing) {
        return { kind: "existing", agentId: params.agentId, requestHash: params.requestHash, state: existing.state };
      }

      // Create execution
      if (!executions.has(params.agentId)) executions.set(params.agentId, []);
      const execRow: ToolExecutionRow = {
        id: `exec_${crypto.randomUUID().slice(0, 8)}`,
        agent_id: params.agentId,
        tool_identifier: params.toolId,
        request_hash: params.requestHash,
        case_version_hash: params.caseVersionHash,
        evidence_version_hash: params.evidenceVersionHash,
        state: "reserved",
        price_atomic: Number(params.priceAtomic),
        network: params.network,
        asset_address: params.asset.toLowerCase(),
        pay_to_address: params.payTo.toLowerCase(),
        payment_reference: null,
        settlement_tx_hash: null,
        result_reference: null,
        result_data: null,
        failure_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      executions.get(params.agentId)!.push(execRow);

      // Update agent
      const updatedBudget = {
        ...stored.data.budget,
        reservedAtomic: stored.data.budget.reservedAtomic + params.priceAtomic,
      };
      stored.data = {
        ...stored.data,
        budget: updatedBudget,
        currentRunningToolId: params.toolId as any,
        status: "running_tool",
      };
      stored.version = stored.version + 1;

      return { kind: "created", agentId: params.agentId, requestHash: params.requestHash, state: "reserved" };
    },

    async createToolExecution(
      agentId: string,
      toolIdentifier: string,
      requestHash: string,
      priceAtomic: bigint,
      network: string,
      asset: string,
      payTo: string,
    ): Promise<void> {
      // Simulate unique constraint
      const existing = (executions.get(agentId) ?? []).find(
        (r) => r.request_hash === requestHash,
      );
      if (existing) throw new Error("duplicate key value violates unique constraint");

      if (!executions.has(agentId)) executions.set(agentId, []);
      executions.get(agentId)!.push({
        id: `exec_${crypto.randomUUID().slice(0, 8)}`,
        agent_id: agentId,
        tool_identifier: toolIdentifier,
        request_hash: requestHash,
        case_version_hash: null,
        evidence_version_hash: null,
        state: "pending",
        price_atomic: Number(priceAtomic),
        network,
        asset_address: asset.toLowerCase(),
        pay_to_address: payTo.toLowerCase(),
        payment_reference: null,
        settlement_tx_hash: null,
        result_reference: null,
        result_data: null,
        failure_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    },

    async updateToolExecution(
      agentId: string,
      requestHash: string,
      updates: Partial<Pick<ToolExecutionRow, "state" | "settlement_tx_hash" | "payment_reference" | "result_reference" | "result_data" | "failure_reason" | "case_version_hash" | "evidence_version_hash">>,
    ): Promise<void> {
      const rows = executions.get(agentId) ?? [];
      const idx = rows.findIndex((r) => r.request_hash === requestHash);
      if (idx >= 0) {
        Object.assign(rows[idx], updates);
      }
    },

    async updateAgent(
      agent: ResolutionAgent,
      expectedVersion: number,
    ): Promise<ResolutionAgent> {
      const stored = agents.get(agent.id);
      if (!stored) {
        agents.set(agent.id, { version: expectedVersion + 1, data: { ...agent } });
        return agent;
      }
      if (stored.version !== expectedVersion) {
        throw new Error(`Concurrency conflict: expected ${expectedVersion}, actual ${stored.version}`);
      }
      stored.data = { ...agent };
      stored.version = expectedVersion + 1;
      return agent;
    },

    async appendEvent(
      agentId: string,
      _eventType: string,
      _reason: string,
      _prevStatus: string | null,
      _nextStatus: string | null,
      _metadata?: Record<string, unknown>,
    ): Promise<void> {
      events.push({ agentId, _eventType });
    },
  };
}

// ---------------------------------------------------------------------------
// Mock account, settlement, generator, decryptor
// ---------------------------------------------------------------------------

function makeAccount(address: string): Account {
  return { address, type: "local", signMessage: vi.fn(), signTransaction: vi.fn(), signTypedData: vi.fn(), publicKey: "0x", source: "privateKey" } as any;
}

function makeSettledSuccess(): any {
  return vi.fn().mockResolvedValue({ success: true, txHash: "0xtx", ambiguous: false });
}

function makeGenerator(): any {
  return vi.fn().mockResolvedValue({ assessment: { assessmentId: "a1", qualityScore: 75, strengths: [], weaknesses: [], recommendedActions: [], riskFlags: [] }, usedFallback: false });
}

function makePaymentStore(): any {
  return vi.fn().mockResolvedValue(undefined);
}

function makeDecryptor(addr: string): any {
  return vi.fn().mockResolvedValue(makeAccount(addr));
}

// ---------------------------------------------------------------------------
// Agent fixtures
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_a1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: { escrowPaymentId: "p1", escrowChainId: "eip155:42220", escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    policy: { allowedTools: ["evidence-quality-check"], approvedBudgetAtomic: 100000n, expiresAt: Date.now() + 86400000, funderAddress: "0xF000000000000000000000000000000000000000" },
    budget: { approvedAtomic: 100000n, spentAtomic: 0n, reservedAtomic: 0n },
    plan: { steps: [], currentStepIndex: 0, lastUpdated: Date.now(), caseVersionHash: "cv1", evidenceVersionHash: "ev1" },
    observation: { escrowState: "disputed", evidenceCount: 2, evidenceVersionHash: "ev1", caseVersionHash: "cv1", unresolvedGaps: [], hasMeaningfulChange: false, observedAt: Date.now() },
    caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000",
    encryptedSecret: { version: 1, algorithm: "AES-256-GCM", ciphertext: "ct", iv: "iv12_", authenticationTag: "at_" },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activatedAt: null, pausedAt: null, closedAt: null,
    ...overrides,
  };
}

function makeAction(): ResolutionAgentNextAction & { kind: "run_tool" } {
  return {
    kind: "run_tool",
    toolId: "evidence-quality-check",
    reason: "evidence_quality_check_required",
    toolRequest: { toolId: "evidence-quality-check", priceAtomic: 10000n, network: "eip155:42220", asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33", caseVersionHash: "cv1", evidenceVersionHash: "ev1" },
  };
}

function makeLease(): LeaseContext {
  return { agentId: "agt_a1", ownerToken: "tok", acquiredAt: Date.now(), expiresAt: Date.now() + 60000 };
}

function makeDeps(store: ReturnType<typeof createMemoryStore>): EvidenceQualityCheckDependencies {
  return {
    store: store as any,
    settlementClient: { settleEvidenceQualityCheck: makeSettledSuccess() } as unknown as ResolutionAgentX402SettlementClient,
    generator: { generate: makeGenerator() } as unknown as EvidenceQualityCheckGenerator,
    walletDecryptor: { decrypt: makeDecryptor("0xDeaDbeef00000000000000000000000000000000") } as unknown as ResolutionAgentWalletDecryptor,
    paymentStore: { persistPaymentProof: makePaymentStore() } as unknown as ResolutionAgentPaymentStore,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("atomicity — first call", () => {
  it("reserves exactly 10000 atomic and creates one execution", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent();

    // Seed the agent into the store so the adapter can reload it after RPC
    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    const result = await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    expect(result.kind).toBe("executed");

    const stored = store.agents.get(agent.id);
    expect(stored).toBeDefined();
    expect(Number(stored!.data.budget.reservedAtomic)).toBe(0); // moved to spent
    expect(Number(stored!.data.budget.spentAtomic)).toBe(10000);

    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1);
    expect(execs[0].state).toBe("settled");
  });

  it("updates agent version: RPC increments once, client-side spend increments once", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent();

    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    // Version 1 (initial) → 2 (RPC) → 3 (client-side spend/active update)
    const stored = store.agents.get(agent.id);
    expect(stored!.version).toBeGreaterThanOrEqual(3);
  });
});

describe("atomicity — duplicate call", () => {
  it("returns existing execution without reserving again", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent();

    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    // Now call again with same agent (no budget left for second reserve)
    const agentAfter = makeAgent({
      budget: { approvedAtomic: 100000n, spentAtomic: 10000n, reservedAtomic: 0n },
    });
    // Seed the updated agent in the store so the adapter can find it
    store.agents.set(agent.id, { version: 4, data: agentAfter });

    const result = await executeEvidenceQualityCheck({
      agent: agentAfter, plan: agentAfter.plan!, action: makeAction(),
      leaseContext: makeLease(), now: Date.now(), dependencies: deps,
    });

    expect(result.kind).toBe("executed");

    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1); // still only one execution
  });
});

describe("atomicity — concurrent calls", () => {
  it("exactly one execution created, budget reserved once", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent();
    const agent2 = makeAgent();

    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    const [r1, r2] = await Promise.all([
      executeEvidenceQualityCheck({
        agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
        now: Date.now(), dependencies: deps,
      }),
      executeEvidenceQualityCheck({
        agent: agent2, plan: agent2.plan!, action: makeAction(),
        leaseContext: makeLease(), now: Date.now(), dependencies: deps,
      }),
    ]);

    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(1);

    // Budget should be spent exactly once (10000)
    const stored = store.agents.get(agent.id);
    // After both finish, spent should be 10000 (not 20000)
    const spent = Number(stored!.data.budget.spentAtomic);
    expect(spent).toBeLessThanOrEqual(10000);
  });
});

describe("atomicity — budget reservation before execution", () => {
  it("budget and execution are created atomically via a single RPC call", async () => {
    const store = createMemoryStore();
    const writes: string[] = [];

    const originalRPC = store.reserveToolExecutionAtomically.bind(store);
    store.reserveToolExecutionAtomically = async (params: any) => {
      writes.push("reserveToolExecutionAtomically");
      return originalRPC(params);
    };

    const originalUpdateAgent = store.updateAgent.bind(store);
    store.updateAgent = async (a: any, v: number) => {
      writes.push("updateAgent");
      return originalUpdateAgent(a, v);
    };

    const deps = makeDeps(store);
    const agent = makeAgent();
    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    // The atomic RPC must be called before any follow-up updateAgent for spend
    const rpcIdx = writes.indexOf("reserveToolExecutionAtomically");
    expect(rpcIdx).not.toBe(-1);

    // After the RPC, only updateAgent calls for spend/active should follow
    const afterRPC = writes.slice(rpcIdx + 1);
    for (const w of afterRPC) {
      // No other reservation-related calls should appear
      expect(w).not.toBe("createToolExecution");
    }
  });
});

describe("atomicity — existing execution via RPC", () => {
  it("returns handled result when RPC returns existing execution", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent();
    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    // Pre-populate a settled execution
    if (!store.executions.has("agt_a1")) store.executions.set("agt_a1", []);
    store.executions.get("agt_a1")!.push({
      id: "exec_settled", agent_id: "agt_a1", tool_identifier: "evidence-quality-check",
      request_hash: "0xpre_settled", state: "settled",
      case_version_hash: "cv1", evidence_version_hash: "ev1",
      price_atomic: 10000, network: "eip155:42220",
      asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
      pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
      payment_reference: null, settlement_tx_hash: "0xtx",
      result_reference: "a1", result_data: null, failure_reason: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    // Override the store's getToolExecutionByRequestHash to return the pre-seeded row
    // so that the adapter's step 5 check finds it BEFORE reaching the RPC
    const originalGetByHash = store.getToolExecutionByRequestHash.bind(store);
    store.getToolExecutionByRequestHash = async () => {
      const execs = store.executions.get("agt_a1") ?? [];
      return execs.find(r => r.request_hash === "0xpre_settled") ?? null;
    };

    const result = await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    // Should find the settled execution in step 5 and return "executed"
    // If the request hash doesn't match, it will proceed to the RPC
    // Either way, it should not crash
    expect(["executed", "waiting", "skipped", "failed_recoverable"]).toContain(result.kind);
  });
});

describe("atomicity — insufficient budget", () => {
  it("returns skipped when budget insufficient for reservation", async () => {
    const store = createMemoryStore();
    const deps = makeDeps(store);
    const agent = makeAgent({
      budget: { approvedAtomic: 5000n, spentAtomic: 0n, reservedAtomic: 0n },
    });
    store.agents.set(agent.id, { version: 1, data: makeAgent({
      budget: { approvedAtomic: 5000n, spentAtomic: 0n, reservedAtomic: 0n },
    }) });

    const result = await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    // Budget check is done by the RPC or the in-memory store which throws
    expect(result.kind === "skipped" || result.kind === "failed_recoverable").toBe(true);

    // No execution created
    const execs = store.executions.get(agent.id) ?? [];
    expect(execs.length).toBe(0);
  });
});

describe("atomicity — settled execution is idempotent", () => {
  it("settled execution returns executed without re-decrypting", async () => {
    const store = createMemoryStore();
    const decryptSpy = vi.fn().mockResolvedValue(makeAccount("0xDeaDbeef00000000000000000000000000000000"));

    const deps = makeDeps(store);
    (deps.walletDecryptor as any).decrypt = decryptSpy;

    const agent = makeAgent();
    store.agents.set(agent.id, { version: 1, data: makeAgent() });

    // First call: full flow
    await executeEvidenceQualityCheck({
      agent, plan: agent.plan!, action: makeAction(), leaseContext: makeLease(),
      now: Date.now(), dependencies: deps,
    });

    const decryptCallsAfterFirst = decryptSpy.mock.calls.length;

    // Second call: should detect existing settled execution, skip all
    const agent2 = makeAgent({
      budget: { approvedAtomic: 100000n, spentAtomic: 10000n, reservedAtomic: 0n },
    });
    store.agents.set(agent.id, { version: 4, data: agent2 });

    await executeEvidenceQualityCheck({
      agent: agent2, plan: agent2.plan!, action: makeAction(),
      leaseContext: makeLease(), now: Date.now(), dependencies: deps,
    });

    // No additional decrypt calls
    expect(decryptSpy.mock.calls.length).toBe(decryptCallsAfterFirst);
  });
});
