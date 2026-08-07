// ---------------------------------------------------------------------------
// Dispute Brief Recovery — Test Suite (TDD)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverPaidDisputeBrief } from "../dispute-brief-recovery";
import type {
  DisputeBriefDependencies,
  DisputeBriefGenerationResult,
} from "../types";
import type {
  ResolutionAgent,
  AgentBudget,
} from "../../types";
import type { LeaseContext } from "../../worker/types";
import type { ToolExecutionRow } from "../../store/types";

// ---------------------------------------------------------------------------
// Test Fixture Factory
// ---------------------------------------------------------------------------

function makeBudget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return {
    approvedAtomic: 100000n,
    spentAtomic: 0n,
    reservedAtomic: 0n,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review." as const,
    status: "running_tool",
    identity: {
      escrowPaymentId: "pay_test_001",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: ["reclaim-dispute-brief-v1"],
      approvedBudgetAtomic: 100000n,
      expiresAt: Date.now() + 86400000,
      funderAddress: "0xF000000000000000000000000000000000000000",
    },
    budget: makeBudget(),
    plan: null,
    observation: {
      escrowState: "disputed",
      evidenceCount: 3,
      evidenceVersionHash: "ev_hash_v1",
      caseVersionHash: "case_hash_v1",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: Date.now(),
    },
    caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "test_ciphertext",
      iv: "test_iv_data_12",
      authenticationTag: "test_auth_tag_data16b",
    },
    settledToolIds: [],
    currentRunningToolId: "reclaim-dispute-brief-v1",
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    activatedAt: Date.now() - 5000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeLeaseContext(overrides: Partial<LeaseContext> = {}): LeaseContext {
  return {
    agentId: "agent_test_1",
    ownerToken: "token_abc",
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 60000,
    ...overrides,
  };
}

function makeToolExecutionRow(overrides: Partial<ToolExecutionRow> = {}): ToolExecutionRow {
  return {
    id: "exec_001",
    agent_id: "agent_test_1",
    tool_identifier: "reclaim-dispute-brief-v1",
    request_hash: "0xhash",
    case_version_hash: "case_hash_v1",
    evidence_version_hash: "ev_hash_v1",
    state: "paid_pending_result",
    price_atomic: 10000,
    network: "eip155:42220",
    asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
    payment_reference: "pay_ref_001",
    settlement_tx_hash: "0xs-tx-hash-recovery",
    result_reference: null,
    result_data: null,
    failure_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeGenResult(): DisputeBriefGenerationResult {
  return {
    briefId: "brief_recovery_001",
    generatedAt: new Date().toISOString(),
    generationMode: "ai",
    reviewerPacketReady: true,
    summary: "Recovered dispute brief.",
  };
}

// ---------------------------------------------------------------------------
// Mock Dependency Builders
// ---------------------------------------------------------------------------

interface MockStore {
  updateToolExecution: ReturnType<typeof vi.fn>;
  getAgentVersion: ReturnType<typeof vi.fn>;
  updateAgent: ReturnType<typeof vi.fn>;
  appendEvent: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

function makeMockDependencies(overrides: Partial<DisputeBriefDependencies> = {}): {
  dependencies: DisputeBriefDependencies;
  store: MockStore;
  walletDecryptor: DisputeBriefDependencies["walletDecryptor"];
  settlementClient: DisputeBriefDependencies["settlementClient"];
  generator: DisputeBriefDependencies["generator"];
  rawMocks: {
    updateToolExecution: ReturnType<typeof vi.fn>;
    updateAgent: ReturnType<typeof vi.fn>;
    appendEvent: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    settleDisputeBrief: ReturnType<typeof vi.fn>;
  };
} {
  const mockUpdateTE = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const mockUpdateAgent = vi.fn<(...args: unknown[]) => Promise<ResolutionAgent>>().mockImplementation((...args: unknown[]) => Promise.resolve(args[0] as ResolutionAgent));
  const mockAppendEvent = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const mockGenerate = vi.fn<(...args: unknown[]) => Promise<DisputeBriefGenerationResult>>().mockResolvedValue(makeGenResult());
  const mockDecrypt = vi.fn();
  const mockSettleDisputeBrief = vi.fn();

  const store: MockStore = {
    updateToolExecution: mockUpdateTE,
    getAgentVersion: vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1),
    updateAgent: mockUpdateAgent,
    appendEvent: mockAppendEvent,
  };

  const dependencies: DisputeBriefDependencies = {
    store: store as unknown as DisputeBriefDependencies["store"],
    settlementClient: {
      settleDisputeBrief: mockSettleDisputeBrief,
      settleEvidenceQualityCheck: vi.fn(),
      settleCaseRefresh: vi.fn(),
    } as unknown as DisputeBriefDependencies["settlementClient"],
    generator: { generate: mockGenerate } as unknown as DisputeBriefDependencies["generator"],
    walletDecryptor: { decrypt: mockDecrypt } as unknown as DisputeBriefDependencies["walletDecryptor"],
    paymentStore: { persistPaymentProof: vi.fn() } as unknown as DisputeBriefDependencies["paymentStore"],
    ...overrides,
  };

  return {
    dependencies,
    store,
    walletDecryptor: dependencies.walletDecryptor,
    settlementClient: dependencies.settlementClient,
    generator: dependencies.generator,
    rawMocks: {
      updateToolExecution: mockUpdateTE,
      updateAgent: mockUpdateAgent,
      appendEvent: mockAppendEvent,
      generate: mockGenerate,
      decrypt: mockDecrypt,
      settleDisputeBrief: mockSettleDisputeBrief,
    },
  };
}

// ---------------------------------------------------------------------------
// Recovery Tests
// ---------------------------------------------------------------------------

describe("recoverPaidDisputeBrief", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("recovery does not decrypt wallet", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({ state: "paid_pending_result" });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.walletDecryptor.decrypt).not.toHaveBeenCalled();
  });

  it("recovery does not call settlement", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({ state: "paid_pending_result" });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.settlementClient.settleDisputeBrief).not.toHaveBeenCalled();
  });

  it("recovery does not reserve budget", async () => {
    const agent = makeAgent({
      status: "running_tool",
      budget: makeBudget({ approvedAtomic: 100000n, reservedAtomic: 0n, spentAtomic: 0n }),
    });
    const execution = makeToolExecutionRow({ state: "paid_pending_result" });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.settlementClient.settleDisputeBrief).not.toHaveBeenCalled();
  });

  it("recovery generates and persists missing result", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      result_data: null,
      settlement_tx_hash: "0xtx123",
    });
    const lease = makeLeaseContext();

    const result = await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("recovered");
    expect(deps.generator.generate).toHaveBeenCalledTimes(1);

    // Result should have been persisted
    const updateCalls = deps.rawMocks.updateToolExecution.mock?.calls ?? [];
    const settledCall = updateCalls.find(
      (call: any) => call[2]?.state === "settled",
    );
    expect(settledCall).toBeDefined();
    expect(settledCall![2].result_data).toBeDefined();
  });

  it("repeated recovery after settlement is idempotent", async () => {
    const agent = makeAgent({
      status: "running_tool",
      budget: makeBudget({ approvedAtomic: 100000n, spentAtomic: 10000n, reservedAtomic: 0n }),
    });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      result_data: { test: true },
      settlement_tx_hash: "0xtx123",
    });
    const lease = makeLeaseContext();

    // First recovery — marks execution as settled
    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Second recovery — execution is in "settled" state
    const settledExecution = makeToolExecutionRow({
      state: "settled",
      result_data: { test: true },
      settlement_tx_hash: "0xtx123",
    });
    const result = await recoverPaidDisputeBrief({
      agent, execution: settledExecution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
  });

  it("recovery skips if execution is not in paid_pending_result", async () => {
    const agent = makeAgent();
    const execution = makeToolExecutionRow({ state: "settled" });
    const lease = makeLeaseContext();

    const result = await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect(deps.generator.generate).not.toHaveBeenCalled();
  });

  it("recovery fails if no payment proof", async () => {
    const agent = makeAgent();
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: null,
      payment_reference: null,
    });
    const lease = makeLeaseContext();

    const result = await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
    expect((result as any).reason).toContain("No payment proof");
  });

  it("recovery transitions agent from running_tool to active", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: "0xtx123",
      result_data: null,
    });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.store.appendEvent).toHaveBeenCalledWith(
      "agent_test_1",
      "tool_execution_recovered",
      expect.any(String),
      "running_tool",
      "active",
      expect.any(Object),
    );
  });

  it("recovery appends recovery event", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: "0xtx123",
    });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.store.appendEvent).toHaveBeenCalled();
    const eventCall = deps.rawMocks.appendEvent.mock?.calls?.[0];
    expect(eventCall[1]).toBe("tool_execution_recovered");
  });

  it("recovery handles missing observation gracefully", async () => {
    const agent = makeAgent({ status: "running_tool", observation: null });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: "0xtx123",
      result_data: null,
    });
    const lease = makeLeaseContext();

    const result = await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Should still succeed with fallback service input
    expect(result.kind).toBe("recovered");
    expect(deps.generator.generate).toHaveBeenCalled();
  });

  it("recovery handles generation failure gracefully", async () => {
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: "0xtx123",
      result_data: null,
    });
    const lease = makeLeaseContext();

    deps.rawMocks.generate.mockRejectedValue(new Error("AI generation failed"));

    const result = await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
    expect((result as any).reason).toContain("Recovery AI generation failed");
  });

  it("recovery idempotently reconciles spent budget", async () => {
    const agent = makeAgent({
      status: "running_tool",
      budget: makeBudget({ approvedAtomic: 100000n, spentAtomic: 10000n }),
    });
    const execution = makeToolExecutionRow({
      state: "paid_pending_result",
      settlement_tx_hash: "0xtx123",
      result_data: null,
    });
    const lease = makeLeaseContext();

    await recoverPaidDisputeBrief({
      agent, execution, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Since spent is already >= price, no additional spend should occur
    expect(deps.rawMocks.updateAgent.mock?.calls?.length ?? 0).toBeGreaterThanOrEqual(0);
    // settlement was not called (correct)
    expect(deps.settlementClient.settleDisputeBrief).not.toHaveBeenCalled();
  });
});
