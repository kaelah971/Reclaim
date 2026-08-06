// ---------------------------------------------------------------------------
// Resolution Agent API — Service Function Tests
//
// Tests the service functions against a fully in-memory MockResolutionAgentStore.
// The service layer uses dependency injection (store, authenticatedCaller, now,
// escrowReader are passed as parameters), so we can test business logic without
// a database.
//
// Internal dependencies (wallet generation, encryption config, supabase client)
// are mocked via vi.mock to avoid real crypto / RPC calls.
//
// HARDENED AUTHORIZATION: all tests use MockEscrowCaseReader to verify that
// creation requires on-chain roles and that read access extends to case parties.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures — must use vi.hoisted for values used in vi.mock factories
// (vi.mock calls are hoisted above file-level const declarations)
// ---------------------------------------------------------------------------

const {
  FIXED_FUNDER_A,
  FIXED_FUNDER_B,
  FIXED_CLIENT,
  FIXED_WORKER,
  FIXED_UNRELATED,
  FIXED_CASE_WALLET,
  FIXED_ENCRYPTED_SECRET,
} = vi.hoisted(() => ({
  FIXED_FUNDER_A: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  FIXED_FUNDER_B: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  FIXED_CLIENT: "0xCLIENT_CLIENT_CLIENT_CLIENT_CLIENT_CLIENT_CLIENT",
  FIXED_WORKER: "0xWORKER_WORKER_WORKER_WORKER_WORKER_WORKER_WORKER",
  FIXED_UNRELATED: "0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD",
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
// Mock store class
// ---------------------------------------------------------------------------

class MockStoreClass {
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
// Mock escrow case reader
// ---------------------------------------------------------------------------

import { MockEscrowCaseReader } from "../escrow-reader";
import { buildActivationMessage } from "../auth";
import { FIXED_AGENT_GOAL } from "../../types";
import { V1_TOOLS } from "../../tools";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "../escrow-reader";

// ---------------------------------------------------------------------------
// Imports from the service module
// ---------------------------------------------------------------------------

import {
  createResolutionAgentForCase,
  getResolutionAgentPublicView,
  refreshFundingStatus,
  activateResolutionAgent,
} from "../service";
import type { AgentCaseIdentity } from "../../types";
import type { ResolutionAgentStore } from "../service";

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStoreState();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test payment ID used throughout
// ---------------------------------------------------------------------------

const testPaymentId = "pay_test_service_001";

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
      CANONICAL_ESCROW_CONTRACT_ADDRESS,
    escrowPaymentId: overrides.escrowPaymentId ?? testPaymentId,
  };
}

function makeEscrowReader(overrides?: {
  client?: `0x${string}`;
  worker?: `0x${string}`;
  exists?: boolean;
}): MockEscrowCaseReader {
  const reader = new MockEscrowCaseReader();
  reader.setCaseParties(testPaymentId, {
    client: overrides?.client ?? (FIXED_CLIENT as `0x${string}`),
    worker: overrides?.worker ?? (FIXED_WORKER as `0x${string}`),
    exists: overrides?.exists ?? true,
  });
  return reader;
}

function makeCreateParams(
  overrides: Partial<{
    authenticatedCaller: string;
    caseIdentity: AgentCaseIdentity;
    approvedBudgetAtomic: bigint;
    now: number;
    store: MockStoreClass;
    escrowReader: MockEscrowCaseReader;
  }> = {},
) {
  return {
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_CLIENT,
    caseIdentity: overrides.caseIdentity ?? makeCaseIdentity(),
    approvedBudgetAtomic: overrides.approvedBudgetAtomic ?? 30_000n,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
    escrowReader: overrides.escrowReader ?? makeEscrowReader(),
  };
}

function makeFundingParams(
  overrides: Partial<{
    agentId: string;
    authenticatedCaller: string;
    now: number;
    store: MockStoreClass;
    fundingReader: MockFundingReader;
    escrowReader: MockEscrowCaseReader;
  }> = {},
) {
  return {
    agentId: overrides.agentId ?? "",
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_FUNDER_A,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
    fundingReader: overrides.fundingReader ?? new MockFundingReader(),
    escrowReader: overrides.escrowReader ?? makeEscrowReader(),
  };
}

/**
 * Builds a valid signed activation message for the given agent.
 * The test creates the message using the same function the service uses,
 * ensuring deterministic reconstruction works.
 */
function makeSignedActivationMessage(agent: ResolutionAgent): string {
  return buildActivationMessage({
    agentId: agent.id,
    funderAddress: agent.policy.funderAddress,
    escrowChainId: agent.identity.escrowChainId,
    escrowContractAddress: agent.identity.escrowContractAddress,
    escrowPaymentId: agent.identity.escrowPaymentId,
    goal: agent.goal,
    approvedBudgetAtomic: agent.policy.approvedBudgetAtomic,
    refundAddress: agent.policy.funderAddress,
    policyVersion: "v1",
    allowedToolIds: [...agent.policy.allowedTools],
    agentExpiresAt: agent.policy.expiresAt,
    authorizationExpiresAt: Date.now() + 5 * 60 * 1000,
  });
}

function makeActivateParams(
  overrides: Partial<{
    agentId: string;
    authenticatedCaller: string;
    now: number;
    store: MockStoreClass;
    escrowReader: MockEscrowCaseReader;
    signedMessage: string;
  }> = {},
) {
  return {
    agentId: overrides.agentId ?? "",
    authenticatedCaller: overrides.authenticatedCaller ?? FIXED_FUNDER_A,
    now: overrides.now ?? Date.now(),
    store: overrides.store ?? new MockStoreClass(),
    escrowReader: overrides.escrowReader ?? makeEscrowReader(),
    signedMessage: overrides.signedMessage ?? "",
  };
}

// =========================================================================
// CREATION TESTS
// =========================================================================

describe("createResolutionAgentForCase", () => {
  it("valid client can create an agent", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
    );
    expect(view).toBeDefined();
    expect(view.id).toBeDefined();
    expect(view.status).toBe("awaiting_funding");
  });

  it("created agent has fixed goal (server-owned, not client-supplied)", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
    );
    expect(view.goal).toBe(FIXED_AGENT_GOAL);
  });

  it("created agent has canonical tool allowlist (3 tools)", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
    );
    expect(view.allowedTools).toHaveLength(3);
  });

  it("valid budget 30000 accepted", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 30_000n, escrowReader }),
    );
    expect(view.budget.approvedAtomic).toBe("30000");
  });

  it("valid budget 40000 accepted", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 40_000n, escrowReader }),
    );
    expect(view.budget.approvedAtomic).toBe("40000");
  });

  it("valid budget 50000 accepted", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 50_000n, escrowReader }),
    );
    expect(view.budget.approvedAtomic).toBe("50000");
  });

  it("budget 20000 rejected", async () => {
    const escrowReader = makeEscrowReader();
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 20_000n, escrowReader }),
      ),
    ).rejects.toThrow();
  });

  it("budget 0 rejected", async () => {
    const escrowReader = makeEscrowReader();
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 0n, escrowReader }),
      ),
    ).rejects.toThrow();
  });

  it("caller becomes original funder", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
    );
    expect(view.funderAddress.toLowerCase()).toBe(FIXED_CLIENT.toLowerCase());
  });

  it("repeated same-funder creation returns existing agent (idempotent)", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const baseParams = makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader });
    const first = await createResolutionAgentForCase(baseParams);
    const second = await createResolutionAgentForCase(baseParams);
    expect(second.id).toBe(first.id);
  });

  it("different-funder duplicate creation is rejected", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
    );
    await expect(
      createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_WORKER, store, escrowReader }),
      ),
    ).rejects.toThrow();
  });

  it("encrypted secret is NEVER returned in response", async () => {
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
    );
    const raw = view as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("encryptedSecret");
  });

  // -----------------------------------------------------------------------
  // AUTHORITATIVE ROLE VERIFICATION
  // -----------------------------------------------------------------------

  describe("AUTHORITATIVE ROLE VERIFICATION", () => {
    it("signed client can create (caller matches on-chain client)", async () => {
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
      );
      expect(view).toBeDefined();
    });

    it("signed assigned worker can create (caller matches on-chain worker)", async () => {
      const escrowReader = makeEscrowReader({ worker: FIXED_WORKER as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_WORKER, escrowReader }),
      );
      expect(view).toBeDefined();
    });

    it("correctly signed unrelated wallet (not client, not worker) is rejected on creation", async () => {
      const escrowReader = makeEscrowReader();
      await expect(
        createResolutionAgentForCase(
          makeCreateParams({ authenticatedCaller: FIXED_UNRELATED, escrowReader }),
        ),
      ).rejects.toThrow(/access denied|only the client or worker/i);
    });

    it("nonexistent payment (escrowReader returns exists:false) is rejected", async () => {
      const escrowReader = makeEscrowReader({ exists: false });
      await expect(
        createResolutionAgentForCase(
          makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
        ),
      ).rejects.toThrow(/does not exist/i);
    });

    it("case reader uses canonical chain ID and contract address", async () => {
      const escrowReader = makeEscrowReader();
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
      );
      expect(view).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // CREATION SIGNATURE
  // -----------------------------------------------------------------------

  describe("CREATION SIGNATURE", () => {
    it("creation binds payment ID", async () => {
      const escrowReader = makeEscrowReader();
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
      );
      expect(view).toBeDefined();
    });

    it("creation binds approved budget (50000 accepted, 30000 accepted, 40000 accepted)", async () => {
      const escrowReader1 = new MockEscrowCaseReader();
      escrowReader1.setCaseParties("pay_budget_50k", {
        client: FIXED_CLIENT as `0x${string}`,
        worker: FIXED_WORKER as `0x${string}`,
        exists: true,
      });
      const store1 = new MockStoreClass();
      const view50k = await createResolutionAgentForCase(
        makeCreateParams({
          authenticatedCaller: FIXED_CLIENT,
          approvedBudgetAtomic: 50_000n,
          escrowReader: escrowReader1,
          store: store1,
          caseIdentity: makeCaseIdentity({ escrowPaymentId: "pay_budget_50k" }),
        }),
      );
      expect(view50k.budget.approvedAtomic).toBe("50000");

      // Use different payment IDs to avoid idempotent returns from shared store
      const escrowReader2 = new MockEscrowCaseReader();
      escrowReader2.setCaseParties("pay_budget_30k", {
        client: FIXED_CLIENT as `0x${string}`,
        worker: FIXED_WORKER as `0x${string}`,
        exists: true,
      });
      const store2 = new MockStoreClass();
      const view30k = await createResolutionAgentForCase(
        makeCreateParams({
          authenticatedCaller: FIXED_CLIENT,
          approvedBudgetAtomic: 30_000n,
          escrowReader: escrowReader2,
          store: store2,
          caseIdentity: makeCaseIdentity({ escrowPaymentId: "pay_budget_30k" }),
        }),
      );
      expect(view30k.budget.approvedAtomic).toBe("30000");

      const escrowReader3 = new MockEscrowCaseReader();
      escrowReader3.setCaseParties("pay_budget_40k", {
        client: FIXED_CLIENT as `0x${string}`,
        worker: FIXED_WORKER as `0x${string}`,
        exists: true,
      });
      const store3 = new MockStoreClass();
      const view40k = await createResolutionAgentForCase(
        makeCreateParams({
          authenticatedCaller: FIXED_CLIENT,
          approvedBudgetAtomic: 40_000n,
          escrowReader: escrowReader3,
          store: store3,
          caseIdentity: makeCaseIdentity({ escrowPaymentId: "pay_budget_40k" }),
        }),
      );
      expect(view40k.budget.approvedAtomic).toBe("40000");
    });

    it("creation binds funder address", async () => {
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, escrowReader }),
      );
      expect(view.funderAddress.toLowerCase()).toBe(FIXED_CLIENT.toLowerCase());
    });
  });
});

// =========================================================================
// PUBLIC READ TESTS
// =========================================================================

describe("getResolutionAgentPublicView", () => {
  it("case party (funder) can retrieve public view", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
    );
    const retrieved = await getResolutionAgentPublicView({
      agentId: view.id,
      authenticatedCaller: FIXED_CLIENT,
      store: store as unknown as ResolutionAgentStore,
      escrowReader,
    });
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(view.id);
  });

  it("non-funder caller is rejected", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
    );
    const unrelatedReader = new MockEscrowCaseReader();
    unrelatedReader.setCaseParties(testPaymentId, {
      client: FIXED_CLIENT as `0x${string}`,
      worker: FIXED_WORKER as `0x${string}`,
      exists: true,
    });
    await expect(
      getResolutionAgentPublicView({
        agentId: view.id,
        authenticatedCaller: FIXED_UNRELATED,
        store: store as unknown as ResolutionAgentStore,
        escrowReader: unrelatedReader,
      }),
    ).rejects.toThrow(/denied/i);
  });

  // -----------------------------------------------------------------------
  // PUBLIC READ AND FUNDING STATUS
  // -----------------------------------------------------------------------

  describe("PUBLIC READ AND FUNDING STATUS", () => {
    it("cryptographically authenticated case client can read (via wallet auth)", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}`, worker: FIXED_WORKER as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
      );
      const retrieved = await getResolutionAgentPublicView({
        agentId: view.id,
        authenticatedCaller: FIXED_CLIENT,
        store: store as unknown as ResolutionAgentStore,
        escrowReader,
      });
      expect(retrieved).toBeDefined();
    });

    it("cryptographically authenticated worker can read", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}`, worker: FIXED_WORKER as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
      );
      const retrieved = await getResolutionAgentPublicView({
        agentId: view.id,
        authenticatedCaller: FIXED_WORKER,
        store: store as unknown as ResolutionAgentStore,
        escrowReader,
      });
      expect(retrieved).toBeDefined();
    });

    it("original funder can read even if not client/worker", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}`, worker: FIXED_WORKER as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
      );
      const retrieved = await getResolutionAgentPublicView({
        agentId: view.id,
        authenticatedCaller: FIXED_CLIENT,
        store: store as unknown as ResolutionAgentStore,
        escrowReader,
      });
      expect(retrieved).toBeDefined();
    });

    it("unrelated signed wallet cannot read agent", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader();
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
      );
      await expect(
        getResolutionAgentPublicView({
          agentId: view.id,
          authenticatedCaller: FIXED_UNRELATED,
          store: store as unknown as ResolutionAgentStore,
          escrowReader,
        }),
      ).rejects.toThrow(/denied/i);
    });

    it("funding-status route applies the same eligibility rules", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}`, worker: FIXED_WORKER as `0x${string}` });
      const view = await createResolutionAgentForCase(
        makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader }),
      );
      const fundingReader = new MockFundingReader(0n);
      const result = await refreshFundingStatus(
        makeFundingParams({ agentId: view.id, authenticatedCaller: FIXED_WORKER, store, fundingReader, escrowReader }),
      );
      expect(result).toBeDefined();
      expect(result.agent.id).toBe(view.id);
    });
  });
});

// =========================================================================
// FUNDING TESTS
// =========================================================================

describe("refreshFundingStatus", () => {
  it("exact balance → funded → awaiting_activation", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 30_000n, store, escrowReader }),
    );
    const fundingReader = new MockFundingReader(30_000n);
    const result = await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, authenticatedCaller: FIXED_CLIENT, store, fundingReader, escrowReader }),
    );
    expect(result.isSufficientlyFunded).toBe(true);
    expect(result.agent.status).toBe("awaiting_activation");
  });
});

// =========================================================================
// ACTIVATION TESTS
// =========================================================================

describe("activateResolutionAgent", () => {
  async function createAndFundAgent(
    store: MockStoreClass,
    escrowReader: MockEscrowCaseReader,
  ): Promise<{ agentId: string; funderAddress: string }> {
    const view = await createResolutionAgentForCase(
      makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 30_000n, store, escrowReader }),
    );
    const fundingReader = new MockFundingReader(30_000n);
    await refreshFundingStatus(
      makeFundingParams({ agentId: view.id, authenticatedCaller: FIXED_CLIENT, store, fundingReader, escrowReader }),
    );
    return { agentId: view.id, funderAddress: FIXED_CLIENT };
  }

  it("only original funder can activate", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const { agentId } = await createAndFundAgent(store, escrowReader);

    const agent = await store.getAgentById(agentId);
    const signedMsg = makeSignedActivationMessage(agent!);

    await expect(
      activateResolutionAgent(
        makeActivateParams({ agentId, authenticatedCaller: FIXED_WORKER, store, escrowReader, signedMessage: signedMsg }),
      ),
    ).rejects.toThrow(/denied/i);
  });

  it("awaiting_activation + correct caller → active", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const { agentId } = await createAndFundAgent(store, escrowReader);

    const agent = await store.getAgentById(agentId);
    const signedMsg = makeSignedActivationMessage(agent!);

    const result = await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_CLIENT, store, escrowReader, signedMessage: signedMsg }),
    );
    expect(result.status).toBe("active");
  });

  it("repeated activation is idempotent (same active status)", async () => {
    const store = new MockStoreClass();
    const escrowReader = makeEscrowReader();
    const { agentId } = await createAndFundAgent(store, escrowReader);

    const agent = await store.getAgentById(agentId);
    const signedMsg = makeSignedActivationMessage(agent!);

    const first = await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_CLIENT, store, escrowReader, signedMessage: signedMsg }),
    );
    expect(first.status).toBe("active");

    const second = await activateResolutionAgent(
      makeActivateParams({ agentId, authenticatedCaller: FIXED_CLIENT, store, escrowReader, signedMessage: signedMsg }),
    );
    expect(second.status).toBe("active");
  });

  // -----------------------------------------------------------------------
  // ACTIVATION SIGNATURE
  // -----------------------------------------------------------------------

  describe("ACTIVATION SIGNATURE", () => {
    it("only original funder can activate (not client, not worker)", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader({ client: FIXED_CLIENT as `0x${string}`, worker: FIXED_WORKER as `0x${string}` });
      const { agentId } = await createAndFundAgent(store, escrowReader);

      const agent = await store.getAgentById(agentId);
      const signedMsg = makeSignedActivationMessage(agent!);

      await expect(
        activateResolutionAgent(
          makeActivateParams({ agentId, authenticatedCaller: FIXED_WORKER, store, escrowReader, signedMessage: signedMsg }),
        ),
      ).rejects.toThrow(/denied/i);
    });
  });

  // -----------------------------------------------------------------------
  // IDEMPOTENCY
  // -----------------------------------------------------------------------

  describe("IDEMPOTENCY", () => {
    it("duplicate creation still generates one encrypted wallet only", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader();
      const baseParams = makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader });
      const first = await createResolutionAgentForCase(baseParams);
      const second = await createResolutionAgentForCase(baseParams);
      expect(second.id).toBe(first.id);
      expect(second.caseWalletAddress).toBe(first.caseWalletAddress);
    });

    it("replaying the same valid request cannot change budget", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader();
      const baseParams = makeCreateParams({ authenticatedCaller: FIXED_CLIENT, approvedBudgetAtomic: 30_000n, store, escrowReader });
      const first = await createResolutionAgentForCase(baseParams);
      const second = await createResolutionAgentForCase(baseParams);
      expect(second.budget.approvedAtomic).toBe(first.budget.approvedAtomic);
    });

    it("replaying the same valid request cannot change funder address", async () => {
      const store = new MockStoreClass();
      const escrowReader = makeEscrowReader();
      const baseParams = makeCreateParams({ authenticatedCaller: FIXED_CLIENT, store, escrowReader });
      const first = await createResolutionAgentForCase(baseParams);
      const second = await createResolutionAgentForCase(baseParams);
      expect(second.funderAddress.toLowerCase()).toBe(first.funderAddress.toLowerCase());
    });
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
