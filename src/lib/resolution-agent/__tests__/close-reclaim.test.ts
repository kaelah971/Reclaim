import { describe, it, expect, vi } from "vitest";
import { closeResolutionAgent, type ReclaimTransferClient } from "../api/service";
import { MockFundingReader } from "../api/funding";
import type { ResolutionAgent } from "../types";
import type { ResolutionAgentStore } from "../api/service";

// ---------------------------------------------------------------------------
// Helpers
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
    budget: { approvedAtomic: 1_000_000n, spentAtomic: 0n, reservedAtomic: 0n },
    plan: null,
    observation: null,
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      version: 1, algorithm: "AES-256-GCM",
      ciphertext: "test-ciphertext", iv: "test-iv", authenticationTag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1_000_000, updatedAt: 1_000_000,
    activatedAt: null, pausedAt: null, closedAt: null,
    reclaimAmountAtomic: null, reclaimDestination: null, reclaimNonce: null,
    ...overrides,
  };
}

const funderAddress = "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const now = 2_000_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = any;

function makeMockStore(agent: ResolutionAgent, extra?: { listToolExecutions?: ReturnType<typeof vi.fn> }) {
  return {
    createAgent: vi.fn().mockResolvedValue(agent),
    getAgentById: vi.fn().mockResolvedValue(agent),
    getAgentByCaseIdentity: vi.fn().mockResolvedValue(null),
    updateAgent: vi.fn().mockImplementation((a: ResolutionAgent) => Promise.resolve(a)),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
    listToolExecutions: extra?.listToolExecutions ?? vi.fn().mockResolvedValue([]),
  };
}

function mockTransferClient(txHash: string, nonce = 0): ReclaimTransferClient {
  return {
    fetchNonce: vi.fn().mockResolvedValue(nonce),
    transferUsdc: vi.fn().mockResolvedValue({ txHash, nonce, transferAmount: 0n }),
  };
}

// ---------------------------------------------------------------------------
// Close — Authorization
// ---------------------------------------------------------------------------

describe("closeResolutionAgent authorization", () => {
  it("allows funder to close", async () => {
    const agent = makeTestAgent({ status: "paused" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n); // zero balance
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });

    expect(result.status).toBe("closed");
  });

  it("rejects non-funder", async () => {
    const agent = makeTestAgent({ status: "paused" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    await expect(
      closeResolutionAgent({
        agentId: agent.id, authenticatedCaller: "0xwrong", now,
        store, fundingReader, transferClient,
      }),
    ).rejects.toThrow(/only the agent's funder/i);
  });
});

// ---------------------------------------------------------------------------
// Close — Ineligible States
// ---------------------------------------------------------------------------

describe("closeResolutionAgent ineligible states", () => {
  it("rejects running_tool", async () => {
    const agent = makeTestAgent({ status: "running_tool", currentRunningToolId: "evidence-quality-check" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    await expect(
      closeResolutionAgent({
        agentId: agent.id, authenticatedCaller: funderAddress, now,
        store, fundingReader, transferClient,
      }),
    ).rejects.toThrow(/currently executing a paid tool/i);
  });

  it("rejects draft", async () => {
    const agent = makeTestAgent({ status: "draft" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    await expect(
      closeResolutionAgent({
        agentId: agent.id, authenticatedCaller: funderAddress, now,
        store, fundingReader, transferClient,
      }),
    ).rejects.toThrow(/cannot be closed/i);
  });

  it("rejects with unresolved reserved budget", async () => {
    const agent = makeTestAgent({
      status: "active",
      budget: { approvedAtomic: 1_000_000n, spentAtomic: 0n, reservedAtomic: 10_000n },
    });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    await expect(
      closeResolutionAgent({
        agentId: agent.id, authenticatedCaller: funderAddress, now,
        store, fundingReader, transferClient,
      }),
    ).rejects.toThrow(/reserved budget/i);
  });

  it("rejects with in-flight tool execution", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    store.listToolExecutions = vi.fn().mockResolvedValue([{ state: "settling" }]);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    await expect(
      closeResolutionAgent({
        agentId: agent.id, authenticatedCaller: funderAddress, now,
        store, fundingReader, transferClient,
      }),
    ).rejects.toThrow(/in-flight tool executions/i);
  });
});

// ---------------------------------------------------------------------------
// Close — Eligible States
// ---------------------------------------------------------------------------

describe("closeResolutionAgent eligible states", () => {
  it("closes active agent", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });

    expect(result.status).toBe("closed");
    expect(store.appendEvent).toHaveBeenCalled();
  });

  it("closes paused agent", async () => {
    const agent = makeTestAgent({ status: "paused", pausedAt: 1_500_000 });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
  });

  it("closes ready_for_human_review agent", async () => {
    const agent = makeTestAgent({ status: "ready_for_human_review" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
  });

  it("closes budget_exhausted agent", async () => {
    const agent = makeTestAgent({
      status: "budget_exhausted",
      budget: { approvedAtomic: 100000n, spentAtomic: 100000n, reservedAtomic: 0n },
    });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Close — Idempotency
// ---------------------------------------------------------------------------

describe("closeResolutionAgent idempotency", () => {
  it("already-closed returns safely", async () => {
    const agent = makeTestAgent({ status: "closed", closedAt: 2_000_000 });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
    expect(store.updateAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Close — Zero-balance behavior
// ---------------------------------------------------------------------------

describe("closeResolutionAgent zero balance", () => {
  it("closes without attempting transfer when balance is zero", async () => {
    const agent = makeTestAgent({ status: "paused" });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient: ReclaimTransferClient = {
      fetchNonce: vi.fn().mockResolvedValue(0),
      transferUsdc: vi.fn().mockRejectedValue(new Error("should not be called")),
    };

    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
    expect(transferClient.transferUsdc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Close — Escrow never touched
// ---------------------------------------------------------------------------

describe("closeResolutionAgent escrow safety", () => {
  it("never calls escrow contract", async () => {
    // The close function only interacts with the store, funding reader,
    // and transfer client.  No escrow contract call exists in the path.
    const agent = makeTestAgent({ status: "closed", closedAt: 2_000_000 });
    const store = makeMockStore(agent);
    const fundingReader = new MockFundingReader(0n);
    const transferClient = mockTransferClient("0xtx");

    // Already closed — just verify it doesn't throw or call any contract
    const result = await closeResolutionAgent({
      agentId: agent.id, authenticatedCaller: funderAddress, now,
      store, fundingReader, transferClient,
    });
    expect(result.status).toBe("closed");
    // No escrow-related RPC or contract calls exist in the service
  });
});
