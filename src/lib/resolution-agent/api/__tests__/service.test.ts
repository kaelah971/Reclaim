// ---------------------------------------------------------------------------
// Resolution Agent API — Service Function Tests
//
// Tests the service functions against a fully in-memory MockResolutionAgentStore.
// The service layer uses dependency injection (store, authenticatedCaller, now
// are passed as parameters), so we can test business logic without a database.
//
// Internal dependencies (wallet generation, encryption config, supabase client)
// are mocked via vi.mock to avoid real crypto / RPC calls.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures — must use vi.hoisted for values used in vi.mock factories
// (vi.mock calls are hoisted above file-level const declarations)
// ---------------------------------------------------------------------------

const {
  FIXED_FUNDER_A,
  FIXED_FUNDER_B,
  FIXED_CASE_WALLET,
  FIXED_ENCRYPTED_SECRET,
} = vi.hoisted(() => ({
  FIXED_FUNDER_A: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  FIXED_FUNDER_B: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  FIXED_CASE_WALLET: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  FIXED_ENCRYPTED_SECRET: {
    version: 1 as const,
    algorithm: "AES-256-GCM" as const,
    ciphertext: "bW9jay1jaXBoZXJ0ZXh0LWZvci10ZXN0aW5n",
    iv: "bW9jay1pdi1mb3ItdGVzdGluZw==",
    authenticationTag: "bW9jay1hdXRoLXRhZy1mb3ItdGVzdA==",
  },
}));

// ---------------------------------------------------------------------------
// In-memory shared state for the mock store
// ---------------------------------------------------------------------------

import type { ResolutionAgent } from "../../types";
import type { AgentEventRow } from "../../store/types";

const storeAgents = new Map<string, ResolutionAgent>();
const storeVersions = new Map<string, number>();
const storeEvents = new Map<string, AgentEventRow[]>();

function resetStoreState(): void {
  storeAgents.clear();
  storeVersions.clear();
  storeEvents.clear();
}

// ---------------------------------------------------------------------------
// Mock store class — implements the same interface as SupabaseResolutionAgentStore
// ---------------------------------------------------------------------------

class MockStoreClass {
  // Private client property for SupabaseResolutionAgentStore compatibility
  private readonly client = null as unknown;

  async createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    for (const existing of storeAgents.values()) {
      if (
        existing.identity.escrowChainId === agent.identity.escrowChainId &&
        existing.identity.escrowContractAddress.toLowerCase() ===
          agent.identity.escrowContractAddress.toLowerCase() &&
        existing.identity.escrowPaymentId === agent.identity.escrowPaymentId
      ) {
        const err: Error & { name?: string; agentId?: string } = new Error(
          `Resolution agent already exists: ${existing.id}`,
        );
        err.name = "ResolutionAgentAlreadyExistsError";
        err.agentId = existing.id;
        throw err;
      }
    }
    storeAgents.set(agent.id, agent);
    storeVersions.set(agent.id, 1);
    return agent;
  }

  async getAgentById(agentId: string): Promise<ResolutionAgent | null> {
    return storeAgents.get(agentId) ?? null;
  }

  async getAgentByCaseIdentity(
    chainId: string,
    contractAddress: string,
    paymentId: string,
  ): Promise<ResolutionAgent | null> {
    const addr = contractAddress.toLowerCase();
    for (const agent of storeAgents.values()) {
      if (
        agent.identity.escrowChainId === chainId &&
        agent.identity.escrowContractAddress.toLowerCase() === addr &&
        agent.identity.escrowPaymentId === paymentId
      ) {
        return agent;
      }
    }
    return null;
  }

  async updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent> {
    const currentVersion = storeVersions.get(agent.id);
    if (currentVersion === undefined) {
      throw new Error(`Agent ${agent.id} not found`);
    }
    if (currentVersion !== expectedVersion) {
      const err: Error & { name?: string } = new Error(
        `Concurrency conflict for agent ${agent.id}: expected ${expectedVersion}, actual ${currentVersion}`,
      );
      err.name = "ResolutionAgentConcurrencyError";
      throw err;
    }
    storeAgents.set(agent.id, agent);
    storeVersions.set(agent.id, currentVersion + 1);
    return agent;
  }

  async appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!storeEvents.has(agentId)) storeEvents.set(agentId, []);
    storeEvents.get(agentId)!.push({
      id: crypto.randomUUID(),
      agent_id: agentId,
      event_type: eventType,
      reason,
      previous_status: previousStatus,
      next_status: nextStatus,
      metadata: metadata ?? null,
      created_at: new Date().toISOString(),
    });
  }

  async getAgentVersion(agentId: string): Promise<number> {
    const version = storeVersions.get(agentId);
    if (version === undefined) {
      throw new Error(`Agent ${agentId} not found`);
    }
    return version;
  }

  async listEvents(agentId: string, limit = 100): Promise<AgentEventRow[]> {
    return (storeEvents.get(agentId) ?? []).slice(0, limit);
  }

  async createToolExecution(): Promise<void> { /* no-op */ }
  async getToolExecutionByRequestHash(): Promise<null> { return null; }
  async updateToolExecution(): Promise<void> { /* no-op */ }
  async createEvidenceRequest(): Promise<unknown> {
    throw new Error("Mock: not implemented");
  }
  async listEvidenceRequests(): Promise<unknown[]> { return []; }
  async updateEvidenceRequest(): Promise<void> { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Mock internal dependencies (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("../../server/wallet", () => ({
  generateEncryptedCaseWallet: vi.fn().mockResolvedValue({
    address: FIXED_CASE_WALLET,
    encryptedSecret: { ...FIXED_ENCRYPTED_SECRET },
  }),
}));

vi.mock("../../server/config", () => ({
  parseWalletEncryptionKey: vi.fn().mockReturnValue(
    Buffer.alloc(32, 0xAB),
  ),
  WALLET_ENCRYPTION_KEY_ENV: "RESOLUTION_AGENT_WALLET_ENCRYPTION_KEY",
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { version: 2 } }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock funding reader
// ---------------------------------------------------------------------------

class MockFundingReader {
  private balance: bigint;
  constructor(balance: bigint = 0n) {
    this.balance = balance;
  }
  setBalance(b: bigint) { this.balance = b; }
  async getUsdcBalanceAtomic(_address: string): Promise<bigint> {
    return this.balance;
  }
}

// ---------------------------------------------------------------------------
// Imports from the service module
// ---------------------------------------------------------------------------

import {
  createResolutionAgentForCase,
  getResolutionAgentPublicView,
  refreshFundingStatus,
  activateResolutionAgent,
} from "../service";
import type { FundingStatusResponse } from "../service";
import { toResolutionAgentPublicView } from "../../public-view";
import { FIXED_AGENT_GOAL, AGENT_TOOL_IDS } from "../../types";
import type { AgentCaseIdentity } from "../../types";

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStoreState();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaseIdentity(
  overrides: Partial<{
    escrowChainId: string;
    escrowContractAddress: string;
    escrowPaymentId: string;
  }> = {},
): AgentCaseIdentity {
  return {
    escrowChainId: overrides.escrowChainId ?? "eip155:11142220",
    escrowContractAddress:
      overrides.escrowContractAddress ??
      "0x1111111111111111111111111111111111111111",
    escrowPaymentId: overrides.escrowPaymentId ?? "pay_test_service_001",
  };
}

function makeCreateParams(
  overrides: Partial<{
    authenticatedCaller: string;
    caseIdentity: AgentCaseIdentity;
    approvedBudgetAtomic: bigint;
    now: number;
    store: MockStoreClass;
  }> = {},
) {
  return {
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_FUNDER_A,
    caseIdentity: overrides.caseIdentity ?? makeCaseIdentity(),
    approvedBudgetAtomic: overrides.approvedBudgetAtomic ?? 30_000n,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
  };
}

function makeFundingParams(
  overrides: Partial<{
    agentId: string;
    authenticatedCaller: string;
    now: number;
    store: MockStoreClass;
    fundingReader: MockFundingReader;
  }> = {},
) {
  return {
    agentId: overrides.agentId ?? "",
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_FUNDER_A,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
    fundingReader: overrides.fundingReader ?? new MockFundingReader(),
  };
}

function makeActivateParams(
  overrides: Partial<{
    agentId: string;
    authenticatedCaller: string;
    now: number;
    store: MockStoreClass;
  }> = {},
) {
  return {
    agentId: overrides.agentId ?? "",
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_FUNDER_A,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
  };
}

// =========================================================================
// CREATION TESTS
// =========================================================================

describe("createResolutionAgentForCase", () => {
  it("valid client can create an agent", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view).toBeDefined();
    expect(view.id).toBeDefined();
    // Service transitions: draft → awaiting_funding
    expect(view.status).toBe("awaiting_funding");
  });

  it("created agent has fixed goal (server-owned, not client-supplied)", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view.goal).toBe(FIXED_AGENT_GOAL);
  });

  it("created agent has canonical tool allowlist (3 tools)", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view.allowedTools).toHaveLength(3);
    expect(view.allowedTools).toEqual(
      expect.arrayContaining([...AGENT_TOOL_IDS] as string[]),
    );
  });

  it("valid budget 30000 accepted", async () => {
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n }),
    );
    expect(view.budget.approvedAtomic).toBe("30000");
  });

  it("valid budget 40000 accepted", async () => {
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 40_000n }),
    );
    expect(view.budget.approvedAtomic).toBe("40000");
  });

  it("valid budget 50000 accepted", async () => {
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 50_000n }),
    );
    expect(view.budget.approvedAtomic).toBe("50000");
  });

  it("budget 20000 rejected", async () => {
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ approvedBudgetAtomic: 20_000n }),
      ),
    ).rejects.toThrow();
  });

  it("budget 60000 rejected", async () => {
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ approvedBudgetAtomic: 60_000n }),
      ),
    ).rejects.toThrow();
  });

  it("budget 0 rejected", async () => {
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ approvedBudgetAtomic: 0n }),
      ),
    ).rejects.toThrow();
  });

  it("created agent status is awaiting_funding", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view.status).toBe("awaiting_funding");
  });

  it("spent budget starts at 0", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view.budget.spentAtomic).toBe("0");
  });

  it("reserved budget starts at 0", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    expect(view.budget.reservedAtomic).toBe("0");
  });

  it("expiry is set (within 7 days + small margin)", async () => {
    const now = Date.now();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ now }),
    );
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(view.expiresAt).toBeGreaterThan(now);
    expect(view.expiresAt).toBeLessThanOrEqual(now + sevenDaysMs + 10_000);
  });

  it("caller becomes original funder", async () => {
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_FUNDER_A }),
    );
    expect(view.funderAddress.toLowerCase()).toBe(
      FIXED_FUNDER_A.toLowerCase(),
    );
  });

  it("repeated same-funder creation returns existing agent (idempotent)", async () => {
    const store = new MockStoreClass();
    const baseParams = makeCreateParams({
      authenticatedCaller: FIXED_FUNDER_A,
      store,
    });

    const first = await createResolutionAgentForCase(baseParams);
    const second = await createResolutionAgentForCase(baseParams);

    expect(second.id).toBe(first.id);
  });

  it("repeated creation does NOT generate another wallet (same caseWalletAddress)", async () => {
    const store = new MockStoreClass();
    const baseParams = makeCreateParams({ store });

    const first = await createResolutionAgentForCase(baseParams);
    const second = await createResolutionAgentForCase(baseParams);

    expect(second.caseWalletAddress.toLowerCase()).toBe(
      first.caseWalletAddress.toLowerCase(),
    );
  });

  it("different-funder duplicate creation is rejected", async () => {
    const store = new MockStoreClass();
    // Create first with funder A
    await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_FUNDER_A, store }),
    );
    // Same case identity, different funder → rejected
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_FUNDER_B, store }),
      ),
    ).rejects.toThrow();
  });

  it("agent-created event is appended", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const events = await store.listEvents(view.id);
    const creationEvents = events.filter((e) => e.event_type === "created");
    expect(creationEvents).toHaveLength(1);
  });

  it("encrypted secret is NEVER returned in response", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    const raw = view as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("encryptedSecret");
  });

  it("public view excludes ciphertext, IV, authenticationTag", async () => {
    const view = await createResolutionAgentForCase(makeCreateParams());
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.ciphertext);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.iv);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.authenticationTag);
  });
});

// =========================================================================
// PUBLIC READ TESTS
// =========================================================================

describe("getResolutionAgentPublicView", () => {
  it("case party (funder) can retrieve public view", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_FUNDER_A, store }),
    );

    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(view.id);
  });

  it("response includes case-wallet address", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    expect(retrieved.caseWalletAddress.toLowerCase()).toBe(
      FIXED_CASE_WALLET.toLowerCase(),
    );
  });

  it("response includes budget (as strings, bigint-safe)", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    expect(typeof retrieved.budget.approvedAtomic).toBe("string");
    expect(typeof retrieved.budget.spentAtomic).toBe("string");
    expect(typeof retrieved.budget.reservedAtomic).toBe("string");
    expect(typeof retrieved.budget.remainingAtomic).toBe("string");
  });

  it("response includes allowed tools", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    expect(retrieved.allowedTools).toHaveLength(3);
  });

  it("response excludes encrypted wallet envelope", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    const raw = retrieved as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("encryptedSecret");
  });

  it("JSON serialization excludes ciphertext etc.", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_FUNDER_A,
      store: store as any,
    });
    const serialized = JSON.stringify(retrieved);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.ciphertext);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.iv);
    expect(serialized).not.toContain(FIXED_ENCRYPTED_SECRET.authenticationTag);
  });

  it("non-funder caller is rejected", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_FUNDER_A, store }),
    );
    await expect(
      getResolutionAgentPublicView({
        agentId: view.id,
        authenticatedCaller: FIXED_FUNDER_B,
        store: store as any,
      }),
    ).rejects.toThrow(/denied/i);
  });
});

// =========================================================================
// FUNDING TESTS
// =========================================================================

describe("refreshFundingStatus", () => {
  it("zero balance keeps awaiting_funding", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(0n);

    const result = await refreshFundingStatus(
      makeFundingParams({
        agentId: view.id,
        store,
        fundingReader,
      }),
    );
    expect(result.isSufficientlyFunded).toBe(false);
    expect(result.agent.status).toBe("awaiting_funding");
  });

  it("partial balance keeps awaiting_funding", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(15_000n);

    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(result.isSufficientlyFunded).toBe(false);
    expect(result.agent.status).toBe("awaiting_funding");
  });

  it("exact balance → funded → awaiting_activation", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(30_000n);

    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(result.isSufficientlyFunded).toBe(true);
    expect(result.agent.status).toBe("awaiting_activation");
  });

  it("excess balance confirms funding but approvedBudgetAtomic unchanged", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(100_000n);

    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(result.isSufficientlyFunded).toBe(true);
    expect(result.agent.budget.approvedAtomic).toBe("30000");
  });

  it("funding alone never activates (status is NOT active)", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(30_000n);

    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(result.agent.status).not.toBe("active");
  });

  it("repeated funding check is idempotent", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(30_000n);

    const first = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    const second = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(first.isSufficientlyFunded).toBe(true);
    expect(second.isSufficientlyFunded).toBe(true);
  });

  it("funding check returns walletBalanceAtomic as string", async () => {
    const store = new MockStoreClass();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ approvedBudgetAtomic: 30_000n, store }),
    );
    const fundingReader = new MockFundingReader(25_000n);

    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    expect(typeof result.walletBalanceAtomic).toBe("string");
    expect(result.walletBalanceAtomic).toBe("25000");
  });
});

// =========================================================================
// ACTIVATION TESTS
// =========================================================================

describe("activateResolutionAgent", () => {
  async function createAndFundAgent(store: MockStoreClass): Promise<string> {
    const view = await createResolutionAgentForCase(
      makeCreateParams({
        authenticatedCaller: FIXED_FUNDER_A,
        approvedBudgetAtomic: 30_000n,
        store,
      }),
    );
    // Fund the agent
    const fundingReader = new MockFundingReader(30_000n);
    await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, store, fundingReader }),
    );
    return view.id;
  }

  it("only original funder can activate", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    await expect(
      activateResolutionAgent(
        makeActivateParams({
          agentId,
          authenticatedCaller: FIXED_FUNDER_B,
          store,
        }),
      ),
    ).rejects.toThrow(/denied/i);
  });

  it("awaiting_funding cannot activate", async () => {
    const store = new MockStoreClass();
    // Create agent but do NOT fund it — stays in awaiting_funding
    const view = await createResolutionAgentForCase(
      makeCreateParams({ store }),
    );

    await expect(
      activateResolutionAgent(
        makeActivateParams({
          agentId: view.id,
          authenticatedCaller: FIXED_FUNDER_A,
          store,
        }),
      ),
    ).rejects.toThrow(/cannot be activated/);
  });

  it("awaiting_activation + correct caller → active", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    const result = await activateResolutionAgent(
      makeActivateParams({
        agentId,
        authenticatedCaller: FIXED_FUNDER_A,
        store,
      }),
    );
    expect(result.status).toBe("active");
  });

  it("activated_at is persisted", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    await activateResolutionAgent(
      makeActivateParams({
        agentId,
        authenticatedCaller: FIXED_FUNDER_A,
        store,
      }),
    );
    const agent = await store.getAgentById(agentId);
    expect(agent!.activatedAt).not.toBeNull();
    expect(typeof agent!.activatedAt).toBe("number");
    expect(agent!.activatedAt!).toBeGreaterThan(0);
  });

  it("activation appends one event", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    await activateResolutionAgent(
      makeActivateParams({
        agentId,
        authenticatedCaller: FIXED_FUNDER_A,
        store,
      }),
    );
    const events = await store.listEvents(agentId);
    const activationEvents = events.filter(
      (e) => e.event_type === "status_change" && e.next_status === "active",
    );
    expect(activationEvents).toHaveLength(1);
  });

  it("repeated activation is idempotent (same active status)", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    const first = await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_FUNDER_A, store }),
    );
    expect(first.status).toBe("active");

    const second = await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_FUNDER_A, store }),
    );
    expect(second.status).toBe("active");
  });

  it("repeated activation does NOT append duplicate event", async () => {
    const store = new MockStoreClass();
    const agentId = await createAndFundAgent(store);

    await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_FUNDER_A, store }),
    );
    await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_FUNDER_A, store }),
    );

    const events = await store.listEvents(agentId);
    const activationEvents = events.filter(
      (e) => e.event_type === "status_change" && e.next_status === "active",
    );
    expect(activationEvents).toHaveLength(1);
  });

  it("activation for unknown agent ID throws", async () => {
    const store = new MockStoreClass();
    await expect(
      activateResolutionAgent(
        makeActivateParams({
          agentId: "nonexistent_agent_id",
          store,
        }),
      ),
    ).rejects.toThrow();
  });
});

// =========================================================================
// MODULE SHAPE
// =========================================================================

describe("service module shape", () => {
  it("exports createResolutionAgentForCase as function", () => {
    expect(typeof createResolutionAgentForCase).toBe("function");
  });

  it("exports getResolutionAgentPublicView as function", () => {
    expect(typeof getResolutionAgentPublicView).toBe("function");
  });

  it("exports refreshFundingStatus as function", () => {
    expect(typeof refreshFundingStatus).toBe("function");
  });

  it("exports activateResolutionAgent as function", () => {
    expect(typeof activateResolutionAgent).toBe("function");
  });
});
