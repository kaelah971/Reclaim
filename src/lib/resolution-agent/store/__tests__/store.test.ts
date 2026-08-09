import { describe, it, expect, vi, beforeAll } from "vitest";
import type { SupabaseResolutionAgentStore } from "../supabase";
import type { ResolutionAgent } from "../../types";

// ---------------------------------------------------------------------------
// Determine whether integration tests should run
// ---------------------------------------------------------------------------

const hasSupabaseConfig =
  typeof process.env.SUPABASE_URL === "string" &&
  process.env.SUPABASE_URL.length > 0;

// ---------------------------------------------------------------------------
// Structure / Signature Tests (no live DB required)
// ---------------------------------------------------------------------------

const mockClient = {
  from: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    match: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
  rpc: vi.fn(),
};

describe("SupabaseResolutionAgentStore — structure", () => {
  it("can be imported", async () => {
    const mod = await import("../supabase");
    expect(mod.SupabaseResolutionAgentStore).toBeDefined();
  });

  it("createAgent exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.createAgent).toBe("function");
  });

  it("createAgent has length 1 (takes one argument: agent)", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(store.createAgent.length).toBe(1);
  });

  it("getAgentById exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.getAgentById).toBe("function");
  });

  it("getAgentById has length 1 (takes agentId)", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(store.getAgentById.length).toBe(1);
  });

  it("getAgentByCaseIdentity exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.getAgentByCaseIdentity).toBe("function");
  });

  it("getAgentByCaseIdentity has length 3 (chainId, contractAddress, paymentId)", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(store.getAgentByCaseIdentity.length).toBe(3);
  });

  it("updateAgent accepts expectedVersion parameter", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(store.updateAgent.length).toBe(2);
  });

  it("appendEvent exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.appendEvent).toBe("function");
  });

  it("listEvents exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.listEvents).toBe("function");
  });

  it("createToolExecution exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.createToolExecution).toBe("function");
  });

  it("getToolExecutionByRequestHash exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.getToolExecutionByRequestHash).toBe("function");
  });

  it("updateToolExecution exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.updateToolExecution).toBe("function");
  });

  it("createEvidenceRequest accepts responsibleParty parameter", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.createEvidenceRequest).toBe("function");
    expect(store.createEvidenceRequest.length).toBe(6);
  });

  it("listEvidenceRequests exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.listEvidenceRequests).toBe("function");
  });

  it("updateEvidenceRequest exists and is a function", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.updateEvidenceRequest).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Optimistic Concurrency — Signature Verification
// ---------------------------------------------------------------------------

describe("SupabaseResolutionAgentStore — optimistic concurrency contract", () => {
  it("updateAgent method accepts expectedVersion", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const store = // eslint-disable-next-line @typescript-eslint/no-explicit-any
new SupabaseResolutionAgentStore(mockClient as any);
    expect(typeof store.updateAgent).toBe("function");
    expect(store.updateAgent.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Integration Tests (only when Supabase is configured)
// ---------------------------------------------------------------------------

const integrationDescribe = hasSupabaseConfig ? describe : describe.skip;

integrationDescribe("SupabaseResolutionAgentStore — integration", () => {
  let store: SupabaseResolutionAgentStore;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      "";

    const client = createClient(supabaseUrl, supabaseKey);
    store = new SupabaseResolutionAgentStore(client);
  });

  const TEST_AGENT_ID = `test_store_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  function makeIntegrationTestAgent(
    overrides: Partial<ResolutionAgent> = {},
  ) {
    return {
      id: TEST_AGENT_ID,
      goal: "Prepare this payment case for fair human review." as const,
      status: "draft" as const,
      identity: {
        escrowPaymentId: `pay_int_${Date.now()}`,
        escrowChainId: "eip155:42220",
        escrowContractAddress:
          "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      policy: {
        allowedTools: ["evidence-quality-check", "case-refresh"] as string[],
        approvedBudgetAtomic: 500000n,
        expiresAt: 9999999999,
        funderAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
      budget: {
        approvedAtomic: 500000n,
        spentAtomic: 0n,
        reservedAtomic: 0n,
      },
      plan: null,
      observation: null,
      caseWalletAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      encryptedSecret: {
        version: 1 as const,
        algorithm: "AES-256-GCM" as const,
        ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
        iv: "dGVzdC1pdi0xMg==",
        authenticationTag: "dGVzdC1hdXRoLXRhZw==",
      },
      settledToolIds: [] as string[],
      currentRunningToolId: null as string | null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activatedAt: null as number | null,
      pausedAt: null as number | null,
      closedAt: null as number | null,
      reclaimAmountAtomic: null,
      reclaimDestination: null,
      reclaimNonce: null,
      ...overrides,
    } as ResolutionAgent;
  }

  afterAll(async () => {
    if (!hasSupabaseConfig) return;
    try {
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const client = getSupabaseClient();
      await client.from("resolution_agents").delete().eq("agent_id", TEST_AGENT_ID);
    } catch {
      // cleanup best-effort
    }
  });

  it("create and retrieve agent", async () => {
    const agent = makeIntegrationTestAgent();
    const created = await store.createAgent(agent);
    expect(created.id).toBe(TEST_AGENT_ID);
    expect(created.status).toBe("draft");

    const retrieved = await store.getAgentById(TEST_AGENT_ID);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(TEST_AGENT_ID);
  });

  it("duplicate agent ID rejected", async () => {
    const agent = makeIntegrationTestAgent({
      identity: {
        ...makeIntegrationTestAgent().identity,
        escrowPaymentId: `pay_dup_${Date.now()}`,
      },
      id: `${TEST_AGENT_ID}_dup`,
    });
    await store.createAgent(agent);
    // Second create with same ID should fail
    await expect(store.createAgent(agent)).rejects.toThrow();
  });

  it("updateAgent with correct expected version succeeds", async () => {
    const agent = makeIntegrationTestAgent({ id: `${TEST_AGENT_ID}_ver` });
    const created = await store.createAgent(agent);
    expect(created.status).toBe("draft");

    const updated = { ...created, status: "awaiting_funding" as const };
    const result = await store.updateAgent(updated, 1);
    expect(result.status).toBe("awaiting_funding");
  });

  it("updateAgent with stale expected version rejected", async () => {
    const agent = makeIntegrationTestAgent({ id: `${TEST_AGENT_ID}_stale` });
    const created = await store.createAgent(agent);

    const updated = { ...created, status: "awaiting_funding" as const };
    await store.updateAgent(updated, 1);

    // Try updating again with the old version
    const updated2 = { ...updated, status: "funded" as const };
    await expect(store.updateAgent(updated2, 1)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RA1R.7E regression — case-identity lookup binds to the CANONICAL escrow
// identity regardless of chain-id format
// ---------------------------------------------------------------------------

describe("getAgentByCaseIdentity — canonical CAIP-2 chain binding (RA1R.7E)", () => {
  const ROW = {
    id: "0e8cd60c-cca5-4018-8db4-e8bbca44e0f0",
    escrow_chain_id: "eip155:11142220",
    escrow_contract_address: "0x1a1ca38d6ac538d491a5c0db2ed7fddc3aec709f",
    escrow_payment_id: "1",
    agent_id: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    case_wallet_address: "0x22bf4271a3f8f3c6885c0d2c825f06f9c9d7f72a",
    encrypted_wallet_secret: {
      iv: "iv_iv_iv_iv_iv",
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "ciphertext",
      authenticationTag: "tag_tag_tag_tag_tag",
    },
    funder_address: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    allowed_tools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
    approved_budget_atomic: 40000,
    spent_budget_atomic: 0,
    reserved_budget_atomic: 0,
    current_plan: null,
    observations: {
      observedAt: 1,
      escrowState: "delivered",
      evidenceCount: 1,
      evidenceVersionHash: "0xhash",
      caseVersionHash: "0xhash",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
    },
    evidence_version_hash: "0xhash",
    case_version_hash: "0xhash",
    expires_at: "2026-08-08T03:57:20.000Z",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    funded_at: null,
    paused_at: null,
    closed_at: null,
    version: 8,
    lease_owner: null,
    lease_expires_at: null,
    current_running_tool_id: null,
  };

  function makeLookupClient() {
    const eqFilters: [string, string][] = [];
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((key: string, value: string) => {
        eqFilters.push([key, String(value)]);
        return builder;
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: ROW, error: null }),
    };
    const client = {
      from: vi.fn().mockReturnValue(builder),
    };
    return { client, eqFilters };
  }

  it("numeric chain id filter resolves the agent persisted with eip155:11142220", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, eqFilters } = makeLookupClient();
    const store = new SupabaseResolutionAgentStore(client as never);

    // Exactly the filter the GET /api/resolution-agents?paymentId=1 endpoint
    // generates: String(CANONICAL_ESCROW_CHAIN_ID) = "11142220".
    const agent = await store.getAgentByCaseIdentity(
      "11142220",
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      "1",
    );

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(agent!.caseWalletAddress).toBe("0x22bf4271a3f8f3c6885c0d2c825f06f9c9d7f72a");
    expect(agent!.policy.funderAddress).toBe("0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486");
    expect(agent!.policy.approvedBudgetAtomic).toBe(40000n);
    expect(agent!.budget.spentAtomic).toBe(0n);
    expect(agent!.budget.reservedAtomic).toBe(0n);

    // The chain filter must be normalized to the persisted CAIP-2 form.
    const chainFilter = eqFilters.find(([k]) => k === "escrow_chain_id");
    expect(chainFilter).toBeDefined();
    expect(chainFilter![1]).toBe("eip155:11142220");
  });

  it("CAIP-2 chain id input passes through unchanged", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, eqFilters } = makeLookupClient();
    const store = new SupabaseResolutionAgentStore(client as never);

    const agent = await store.getAgentByCaseIdentity(
      "eip155:11142220",
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      "1",
    );

    expect(agent).not.toBeNull();
    const chainFilter = eqFilters.find(([k]) => k === "escrow_chain_id");
    expect(chainFilter![1]).toBe("eip155:11142220");
  });
});
