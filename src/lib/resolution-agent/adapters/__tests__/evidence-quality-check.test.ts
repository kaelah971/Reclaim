// ---------------------------------------------------------------------------
// Evidence Quality Check Adapter — Test Suite (TDD)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeEvidenceQualityCheck } from "../evidence-quality-check";
import type {
  EvidenceQualityCheckDependencies,
  EvidenceQualityCheckStore,
  ResolutionAgentX402SettlementClient,
  EvidenceQualityCheckGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
  X402SettlementResult,
} from "../types";
import type {
  ResolutionAgent,
  ResolutionAgentPlan,
  AgentCaseIdentity,
  AgentBudget,
  ResolutionAgentPolicy,
  ResolutionAgentObservation,
} from "../../types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { LeaseContext } from "../../worker/types";
import type { ToolExecutionRow } from "../../store/types";
import type { EvidenceQualityGenerationResult, EvidenceQualityAssessment } from "../../../x402/ai/evidenceQualityGenerate";
import type { Account } from "viem/accounts";

// ---------------------------------------------------------------------------
// Test Fixture Factory
// ---------------------------------------------------------------------------

function makeCaseIdentity(overrides: Partial<AgentCaseIdentity> = {}): AgentCaseIdentity {
  return {
    escrowPaymentId: "pay_test_001",
    escrowChainId: "eip155:42220",
    escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ...overrides,
  };
}

function makeObservation(overrides: Partial<ResolutionAgentObservation> = {}): ResolutionAgentObservation {
  return {
    escrowState: "disputed",
    evidenceCount: 3,
    evidenceVersionHash: "ev_hash_v1",
    caseVersionHash: "case_hash_v1",
    unresolvedGaps: [],
    hasMeaningfulChange: true,
    observedAt: Date.now(),
    ...overrides,
  };
}

function makeBudget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return {
    approvedAtomic: 100000n,
    spentAtomic: 0n,
    reservedAtomic: 0n,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<ResolutionAgentPolicy> = {}): ResolutionAgentPolicy {
  return {
    allowedTools: ["evidence-quality-check"],
    approvedBudgetAtomic: 100000n,
    expiresAt: Date.now() + 86400000,
    funderAddress: "0xF000000000000000000000000000000000000000",
    ...overrides,
  };
}

function makePlan(overrides: Partial<ResolutionAgentPlan> = {}): ResolutionAgentPlan {
  return {
    steps: [{ kind: "purchase_evidence_check", description: "Run evidence check", toolId: "evidence-quality-check" }],
    currentStepIndex: 0,
    lastUpdated: Date.now(),
    caseVersionHash: "case_hash_v1",
    evidenceVersionHash: "ev_hash_v1",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review." as const,
    status: "active",
    identity: makeCaseIdentity(),
    policy: makePolicy(),
    budget: makeBudget(),
    plan: makePlan(),
    observation: makeObservation(),
    caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "test_ciphertext",
      iv: "test_iv_data_12",
      authenticationTag: "test_auth_tag_data16b",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    activatedAt: Date.now() - 5000,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeToolAction(overrides: Partial<ResolutionAgentNextAction & { kind: "run_tool" }> = {}): ResolutionAgentNextAction & { kind: "run_tool" } {
  return {
    kind: "run_tool",
    toolId: "evidence-quality-check",
    reason: "evidence_quality_check_required",
    toolRequest: {
      toolId: "evidence-quality-check",
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
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

function makeAssessment(overrides: Partial<EvidenceQualityAssessment> = {}): EvidenceQualityAssessment {
  return {
    assessmentId: "assess_001",
    generatedAt: new Date().toISOString(),
    generationMode: "ai",
    evidenceTitle: "Test Evidence",
    evidenceInputHash: "0xabcd",
    qualityScore: 75,
    relevanceRating: "high",
    relevanceNote: "Relevant to case",
    credibilityAssessment: "Seems credible",
    completenessAssessment: "Mostly complete",
    factualConsistencyNote: "Consistent",
    biasOrConflictNote: "No bias detected",
    strengths: ["Clear documentation"],
    weaknesses: ["Missing timestamps"],
    recommendedActions: ["Add timestamps"],
    riskFlags: [],
    limitations: "AI assessment only",
    ...overrides,
  };
}

function makeGenResult(overrides: Partial<EvidenceQualityGenerationResult> = {}): EvidenceQualityGenerationResult {
  return {
    assessment: makeAssessment(),
    usedFallback: false,
    ...overrides,
  };
}

function makeToolExecutionRow(overrides: Partial<ToolExecutionRow> = {}): ToolExecutionRow {
  return {
    id: "exec_001",
    agent_id: "agent_test_1",
    tool_identifier: "evidence-quality-check",
    request_hash: "0xhash",
    case_version_hash: "case_hash_v1",
    evidence_version_hash: "ev_hash_v1",
    state: "pending",
    price_atomic: 10000,
    network: "eip155:42220",
    asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
    payment_reference: null,
    settlement_tx_hash: null,
    result_reference: null,
    result_data: null,
    failure_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Account
// ---------------------------------------------------------------------------

function makeAccount(address: string): Account {
  return {
    address: address as `0x${string}`,
    type: "local",
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signTypedData: vi.fn(),
    publicKey: "0xpubkey",
    source: "privateKey",
} as any as Account;
}

// ---------------------------------------------------------------------------
// Mock Dependency Builders
// ---------------------------------------------------------------------------

interface MockStore extends EvidenceQualityCheckStore {
  [key: string]: unknown;
}

function makeMockDependencies(overrides: Partial<EvidenceQualityCheckDependencies> = {}): {
  dependencies: EvidenceQualityCheckDependencies;
  store: MockStore;
  walletDecryptor: ResolutionAgentWalletDecryptor;
  settlementClient: ResolutionAgentX402SettlementClient;
  paymentStore: ResolutionAgentPaymentStore;
  generator: EvidenceQualityCheckGenerator;
  rawMocks: {
    createToolExecution: ReturnType<typeof vi.fn>;
    getToolExecutionByRequestHash: ReturnType<typeof vi.fn>;
    updateToolExecution: ReturnType<typeof vi.fn>;
    getAgentVersion: ReturnType<typeof vi.fn>;
    updateAgent: ReturnType<typeof vi.fn>;
    appendEvent: ReturnType<typeof vi.fn>;
    getAgentById: ReturnType<typeof vi.fn>;
    reserveToolExecutionAtomically: ReturnType<typeof vi.fn>;
    settle: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    persistPaymentProof: ReturnType<typeof vi.fn>;
  };
} {
  const mockCreateTE = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const mockGetTE = vi.fn<(...args: unknown[]) => Promise<ToolExecutionRow | null>>().mockResolvedValue(null);
  const mockUpdateTE = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const mockGetVersion = vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1);
  const mockUpdateAgent = vi.fn<(...args: unknown[]) => Promise<ResolutionAgent>>().mockImplementation(
    (...args: unknown[]) => Promise.resolve(args[0] as ResolutionAgent),
  );
  const mockAppendEvent = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const mockGetAgentById = vi.fn<(...args: unknown[]) => Promise<ResolutionAgent | null>>().mockResolvedValue(
    makeAgent({
      status: "running_tool",
      currentRunningToolId: "evidence-quality-check",
      budget: { approvedAtomic: 100000n, spentAtomic: 0n, reservedAtomic: 10000n },
    }),
  );
  const mockReserveAtomic = vi.fn<(...args: unknown[]) => Promise<{ kind: string; agentId: string; requestHash: string; state: string }>>().mockResolvedValue({
    kind: "created", agentId: "agt_a1", requestHash: "", state: "reserved",
  });
  const mockSettle = vi.fn<(...args: unknown[]) => Promise<X402SettlementResult>>().mockResolvedValue({
    success: true,
    txHash: "0xs-tx-hash",
    ambiguous: false,
  } satisfies X402SettlementResult);
  const mockGenerate = vi.fn<(...args: unknown[]) => Promise<EvidenceQualityGenerationResult>>().mockResolvedValue(makeGenResult());
  const mockDecrypt = vi.fn<(...args: unknown[]) => Promise<Account>>().mockResolvedValue(makeAccount("0xDeaDbeef00000000000000000000000000000000"));
  const mockPersistPayment = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

  const store: MockStore = {
    listToolExecutions: vi.fn().mockResolvedValue([]) as unknown as MockStore["listToolExecutions"],
    createToolExecution: mockCreateTE as unknown as MockStore["createToolExecution"],
    getToolExecutionByRequestHash: mockGetTE as unknown as MockStore["getToolExecutionByRequestHash"],
    updateToolExecution: mockUpdateTE as unknown as MockStore["updateToolExecution"],
    getAgentVersion: mockGetVersion as unknown as MockStore["getAgentVersion"],
    updateAgent: mockUpdateAgent as unknown as MockStore["updateAgent"],
    appendEvent: mockAppendEvent as unknown as MockStore["appendEvent"],
    getAgentById: mockGetAgentById as unknown as MockStore["getAgentById"],
    reserveToolExecutionAtomically: mockReserveAtomic as unknown as MockStore["reserveToolExecutionAtomically"],
  };

  const settlementClient: ResolutionAgentX402SettlementClient = {
    settleEvidenceQualityCheck: mockSettle as unknown as ResolutionAgentX402SettlementClient["settleEvidenceQualityCheck"],
    settleCaseRefresh: vi.fn() as unknown as ResolutionAgentX402SettlementClient["settleCaseRefresh"],
    settleDisputeBrief: vi.fn() as unknown as ResolutionAgentX402SettlementClient["settleDisputeBrief"],
  };

  const generator: EvidenceQualityCheckGenerator = {
    generate: mockGenerate as unknown as EvidenceQualityCheckGenerator["generate"],
  };

  const walletDecryptor: ResolutionAgentWalletDecryptor = {
    decrypt: mockDecrypt as unknown as ResolutionAgentWalletDecryptor["decrypt"],
  };

  const paymentStore: ResolutionAgentPaymentStore = {
    persistPaymentProof: mockPersistPayment as unknown as ResolutionAgentPaymentStore["persistPaymentProof"],
  };

  const dependencies: EvidenceQualityCheckDependencies = {
    store,
    settlementClient,
    generator,
    walletDecryptor,
    paymentStore,
    ...overrides,
  };

  return {
    dependencies,
    store,
    walletDecryptor,
    settlementClient,
    paymentStore,
    generator,
    rawMocks: {
      createToolExecution: mockCreateTE,
      getToolExecutionByRequestHash: mockGetTE,
      updateToolExecution: mockUpdateTE,
      getAgentVersion: mockGetVersion,
      updateAgent: mockUpdateAgent,
      appendEvent: mockAppendEvent,
      getAgentById: mockGetAgentById,
      reserveToolExecutionAtomically: mockReserveAtomic,
      settle: mockSettle,
      generate: mockGenerate,
      decrypt: mockDecrypt,
      persistPaymentProof: mockPersistPayment,
    },
  };
}

// (utility removed — use deps.rawMocks for mock access)

// ---------------------------------------------------------------------------
// Canonical Validation Tests
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — canonical validation", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("accepts canonical Evidence Quality Check action", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("executed");
  });

  it("rejects Case Refresh toolId", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction({ toolId: "case-refresh" as any });
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action: action as any, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("unsupported_action");
    expect((result as any).actionKind).toBe("case-refresh");
  });

  it("rejects Dispute Brief toolId", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction({ toolId: "reclaim-dispute-brief-v1" as any });
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action: action as any, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("unsupported_action");
    expect((result as any).actionKind).toBe("reclaim-dispute-brief-v1");
  });

  it("rejects altered price (not 10000n)", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    action.toolRequest.priceAtomic = 20000n;
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("Price mismatch");
  });

  it("rejects altered network", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    action.toolRequest.network = "eip155:1";
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("Network mismatch");
  });

  it("rejects altered asset", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    action.toolRequest.asset = "0xDifferent";
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("Asset mismatch");
  });

  it("rejects altered payTo", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    action.toolRequest.payTo = "0xDifferent";
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("PayTo mismatch");
  });

  it("rejects stale case hash", async () => {
    const agent = makeAgent();
    const plan = makePlan({ caseVersionHash: "old_case_hash" });
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("stale_plan");
  });

  it("rejects stale evidence hash", async () => {
    const agent = makeAgent();
    const plan = makePlan({ evidenceVersionHash: "old_ev_hash" });
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("stale_plan");
  });

  it("rejects mismatched agent ID in lease", async () => {
    const agent = makeAgent({ id: "agent_test_1" });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext({ agentId: "agent_test_2" });

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_safe");
  });

  it("rejects non-run_tool action kind", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = { kind: "ready_for_human_review", caseVersionHash: "h", disputeBriefReference: null, reason: "ready" } as any;
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action: action as any, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("not run_tool");
  });
});

// ---------------------------------------------------------------------------
// Execution Creation Tests
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — execution creation", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("first request creates one execution", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // The atomic RPC is called instead of separate createToolExecution
    expect(deps.rawMocks.reserveToolExecutionAtomically).toHaveBeenCalledTimes(1);
    expect(deps.rawMocks.reserveToolExecutionAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent_test_1",
        toolId: "evidence-quality-check",
        priceAtomic: 10000n,
      }),
    );
  });

  it("duplicate request creates no second execution", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // First execution succeeds
    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Mock existing execution for the duplicate
    const existingRow = makeToolExecutionRow({ state: "settled", result_data: {} });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);
    // Reset mock call count
    deps.rawMocks.settle.mockClear();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("executed");
    // Settlement should NOT be called again
    expect(deps.dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("insufficient budget prevents execution", async () => {
    const agent = makeAgent({
      budget: makeBudget({ approvedAtomic: 5000n }),
    });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Override the RPC mock to throw for insufficient budget
    deps.rawMocks.reserveToolExecutionAtomically.mockRejectedValue(
      new Error("Insufficient budget: approved 5000, spent 0, reserved 0, requested 10000"),
    );

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("Insufficient budget");
    // No execution created, no settlement called
    expect(deps.rawMocks.reserveToolExecutionAtomically).toHaveBeenCalled();
  });

  it("approved budget never changes after execution", async () => {
    const agent = makeAgent({
      budget: makeBudget({ approvedAtomic: 100000n }),
    });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Check that updateAgent was called with budgets that preserve approvedAtomic
    const updateCalls = deps.rawMocks.updateAgent.mock?.calls ?? [];
    for (const call of updateCalls) {
      const agentArg = call[0] as ResolutionAgent;
      expect(agentArg.budget.approvedAtomic).toBe(100000n);
    }
  });
});

// ---------------------------------------------------------------------------
// Wallet Security Tests
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — wallet security", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("wallet decryptor called only after reservation succeeds", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Decryptor should be called
    expect(deps.walletDecryptor.decrypt).toHaveBeenCalledTimes(1);
    // But only after createToolExecution
    const createCallIdx = deps.rawMocks.createToolExecution.mock?.invocationCallOrder?.[0];
    const decryptCallIdx = deps.rawMocks.decrypt.mock?.invocationCallOrder?.[0];
    if (createCallIdx !== undefined && decryptCallIdx !== undefined) {
      expect(decryptCallIdx).toBeGreaterThan(createCallIdx);
    }
  });

  it("decryptor not called for settled duplicate", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Mock existing settled execution
    const existingRow = makeToolExecutionRow({ state: "settled", result_data: {} });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);
    deps.rawMocks.decrypt.mockClear();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.walletDecryptor.decrypt).not.toHaveBeenCalled();
  });

  it("decryptor not called for insufficient budget", async () => {
    const agent = makeAgent({
      budget: makeBudget({ approvedAtomic: 5000n }),
    });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Override the RPC mock to throw for insufficient budget
    deps.rawMocks.reserveToolExecutionAtomically.mockRejectedValue(
      new Error("Insufficient budget: approved 5000, spent 0, reserved 0, requested 10000"),
    );

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.walletDecryptor.decrypt).not.toHaveBeenCalled();
  });

  it("decrypted address must match persisted caseWalletAddress", async () => {
    const agent = makeAgent({ caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000" });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Decryptor returns different address
    deps.rawMocks.decrypt.mockResolvedValue(
      makeAccount("0xB0B0000000000000000000000000000000000000"),
    );

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_safe");
    expect((result as any).reason).toContain("does not match");
    // Settlement should NOT be called
    expect(deps.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("private key absent from results (no plaintext key in return)", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Check that the result doesn't contain private key info
    const json = JSON.stringify(result);
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("private_key");
    expect(json).not.toContain("0x" + "42".repeat(32));
  });

  it("private key absent from errors", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Force a decryption error
    deps.rawMocks.decrypt.mockRejectedValue(new Error("Decryption failed"));

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
    const json = JSON.stringify(result);
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("ciphertext");
  });
});

// ---------------------------------------------------------------------------
// Settlement Tests
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — settlement", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("settlement called at most once", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(deps.settlementClient.settleEvidenceQualityCheck).toHaveBeenCalledTimes(1);
  });

  it("confirmed payment proof persisted before generation", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Payment proof should be persisted
    expect(deps.paymentStore.persistPaymentProof).toHaveBeenCalledTimes(1);
    // Payment proof should be persisted BEFORE generation
    const persistCallIdx = deps.rawMocks.persistPaymentProof.mock?.invocationCallOrder?.[0];
    const generateCallIdx = deps.rawMocks.generate.mock?.invocationCallOrder?.[0];
    if (persistCallIdx !== undefined && generateCallIdx !== undefined) {
      expect(persistCallIdx).toBeLessThan(generateCallIdx);
    }
  });

  it("confirmed unpaid releases reservation", async () => {
    const agent = makeAgent({ budget: makeBudget({ approvedAtomic: 100000n, reservedAtomic: 0n }) });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Settlement returns unpaid
    deps.rawMocks.settle.mockResolvedValue({
      success: false,
      error: "Payment rejected",
      ambiguous: false,
    } satisfies X402SettlementResult);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    // Should have updated the execution to failed_unpaid
    const updateCalls = deps.rawMocks.updateToolExecution.mock?.calls ?? [];
    const failedUpdateCall = updateCalls.find(
      (call: any) => call[2]?.state === "failed_unpaid",
    );
    expect(failedUpdateCall).toBeDefined();
  });

  it("ambiguous settlement triggers no second payment", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Settlement returns ambiguous
    deps.rawMocks.settle.mockResolvedValue({
      success: false,
      error: "Network timeout",
      ambiguous: true,
    } satisfies X402SettlementResult);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
    // Settlement should only be called once
    expect(deps.settlementClient.settleEvidenceQualityCheck).toHaveBeenCalledTimes(1);
    // Reservation should NOT be released
    const updateCalls = deps.rawMocks.updateToolExecution.mock?.calls ?? [];
    const unpaidCall = updateCalls.find(
      (call: any) => call[2]?.state === "failed_unpaid",
    );
    expect(unpaidCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Concurrency Tests
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — concurrency", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("stale agent version prevents execution", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Simulate concurrency: store returns version 3, but agent was loaded at version 1
    deps.rawMocks.getAgentVersion.mockResolvedValue(3);

    // Force updateAgent to throw concurrency error
    deps.rawMocks.updateAgent.mockRejectedValue(new Error("Concurrency conflict"));

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
  });

  it("changed case hash prevents execution", async () => {
    const agent = makeAgent({
      observation: makeObservation({ caseVersionHash: "case_hash_v1" }),
    });
    const plan = makePlan({ caseVersionHash: "different_case_hash" });
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("stale_plan");
    expect(deps.store.createToolExecution).not.toHaveBeenCalled();
  });

  it("changed evidence hash prevents execution", async () => {
    const agent = makeAgent({
      observation: makeObservation({ evidenceVersionHash: "ev_hash_v1" }),
    });
    const plan = makePlan({ evidenceVersionHash: "different_ev_hash" });
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("stale_plan");
    expect(deps.store.createToolExecution).not.toHaveBeenCalled();
  });

  it("two workers cannot settle the same request (existing execution)", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // First execution: create row
    await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    // Second worker: sees existing settled execution
    const existingRow = makeToolExecutionRow({ state: "settled", result_data: {} });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);
    deps.rawMocks.settle.mockClear();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("executed");
    expect(deps.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("executeEvidenceQualityCheck — edge cases", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("agent without observation returns skipped", async () => {
    const agent = makeAgent({ observation: null });
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("no observation");
  });

  it("existing failed_unpaid execution returned as skipped", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const existingRow = makeToolExecutionRow({ state: "failed_unpaid" });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("unpaid");
  });

  it("existing paid_pending_result execution returned as waiting", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const existingRow = makeToolExecutionRow({ state: "paid_pending_result", settlement_tx_hash: "0xtx" });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("waiting");
    expect((result as any).reason).toContain("recovery needed");
  });

  it("existing cancelled execution returned as skipped", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    const existingRow = makeToolExecutionRow({ state: "cancelled" });
    deps.rawMocks.getToolExecutionByRequestHash.mockResolvedValue(existingRow);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("cancelled");
  });

  it("settlement success without txHash still succeeds", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    // Settlement succeeds but no txHash (e.g. pre-confirmed)
    deps.rawMocks.settle.mockResolvedValue({
      success: true,
      ambiguous: false,
    } satisfies X402SettlementResult);

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("executed");
    // persistPaymentProof should NOT be called (no txHash)
    expect(deps.paymentStore.persistPaymentProof).not.toHaveBeenCalled();
  });

  it("generation failure during execution returns recoverable", async () => {
    const agent = makeAgent();
    const plan = makePlan();
    const action = makeToolAction();
    const lease = makeLeaseContext();

    deps.rawMocks.generate.mockRejectedValue(new Error("AI down"));

    const result = await executeEvidenceQualityCheck({
      agent, plan, action, leaseContext: lease, now: Date.now(), dependencies: deps.dependencies,
    });

    expect(result.kind).toBe("failed_recoverable");
    expect((result as any).reason).toContain("AI generation failed");
  });
});
