// ---------------------------------------------------------------------------
// Executor Registry — Test Suite (TDD)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProductionActionExecutor,
  createProductionRecoveryHandler,
} from "../executor-registry";
import type {
  EvidenceQualityCheckDependencies,
  EvidenceQualityCheckStore,
  ResolutionAgentX402SettlementClient,
  EvidenceQualityCheckGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
} from "../types";
import type {
  ResolutionAgent,
  AgentBudget,
  ResolutionAgentObservation,
} from "../../types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { LeaseContext } from "../../worker/types";
import type { ToolExecutionRow } from "../../store/types";
import type { Account } from "viem/accounts";

// ---------------------------------------------------------------------------
// Test Fixture Factory
// ---------------------------------------------------------------------------

function makeBudget(): AgentBudget {
  return { approvedAtomic: 100000n, spentAtomic: 0n, reservedAtomic: 0n };
}

function makeObservation(): ResolutionAgentObservation {
  return {
    escrowState: "disputed",
    evidenceCount: 3,
    evidenceVersionHash: "ev_hash_v1",
    caseVersionHash: "case_hash_v1",
    unresolvedGaps: [],
    hasMeaningfulChange: true,
    observedAt: Date.now(),
  };
}

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review." as const,
    status: "active",
    identity: {
      escrowPaymentId: "pay_test_001",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: ["evidence-quality-check"],
      approvedBudgetAtomic: 100000n,
      expiresAt: Date.now() + 86400000,
      funderAddress: "0xF000000000000000000000000000000000000000",
    },
    budget: makeBudget(),
    plan: {
      steps: [{ kind: "purchase_evidence_check", description: "Run evidence check", toolId: "evidence-quality-check" }],
      currentStepIndex: 0,
      lastUpdated: Date.now(),
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
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
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeToolAction(toolId: string): ResolutionAgentNextAction & { kind: "run_tool" } {
  return {
    kind: "run_tool",
    toolId: toolId as any,
    reason: "evidence_quality_check_required",
    toolRequest: {
      toolId: toolId as any,
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
  };
}

function makeLeaseContext(): LeaseContext {
  return {
    agentId: "agent_test_1",
    ownerToken: "token_abc",
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 60000,
  };
}

function makeToolExecutionRow(toolId: string, state: string): ToolExecutionRow {
  return {
    id: "exec_001",
    agent_id: "agent_test_1",
    tool_identifier: toolId,
    request_hash: "0xhash",
    case_version_hash: "case_hash_v1",
    evidence_version_hash: "ev_hash_v1",
    state,
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
  };
}

// ---------------------------------------------------------------------------
// Mock Dependencies
// ---------------------------------------------------------------------------

interface MockStore extends EvidenceQualityCheckStore {
  [key: string]: unknown;
}

function makeMockDependencies(): {
  dependencies: EvidenceQualityCheckDependencies;
  store: MockStore;
} {
  const store: MockStore = {
    createToolExecution: vi.fn().mockResolvedValue(undefined),
    listToolExecutions: vi.fn().mockResolvedValue([
      { id: "e1", agent_id: "x", tool_identifier: "evidence-quality-check", state: "settled", updated_at: new Date().toISOString(), result_data: { evidenceVersionHash: "ev_hash_v1", readiness: "ready" }, request_hash: "h1", case_version_hash: null, evidence_version_hash: "ev_hash_v1", price_atomic: 10000, network: "n", asset_address: "a", pay_to_address: "p", payment_reference: null, settlement_tx_hash: null, result_reference: null, failure_reason: null, created_at: new Date().toISOString() },
      { id: "e2", agent_id: "x", tool_identifier: "case-refresh", state: "settled", updated_at: new Date().toISOString(), result_data: { caseVersionHash: "case_hash_v1", readiness: "ready" }, request_hash: "h2", case_version_hash: "case_hash_v1", evidence_version_hash: null, price_atomic: 10000, network: "n", asset_address: "a", pay_to_address: "p", payment_reference: null, settlement_tx_hash: null, result_reference: null, failure_reason: null, created_at: new Date().toISOString() },
    ]),
    getToolExecutionByRequestHash: vi.fn().mockResolvedValue(null),
    updateToolExecution: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
    updateAgent: vi.fn().mockImplementation((a: ResolutionAgent) => Promise.resolve(a)),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentById: vi.fn().mockResolvedValue(makeAgent({ status: "running_tool", currentRunningToolId: "evidence-quality-check", budget: { approvedAtomic: 100000n, spentAtomic: 0n, reservedAtomic: 10000n } })),
    reserveToolExecutionAtomically: vi.fn().mockResolvedValue({ kind: "created", agentId: "", requestHash: "", state: "reserved" }),
  };

  const settlementClient = {
    settleEvidenceQualityCheck: vi.fn().mockResolvedValue({
      success: true,
      txHash: "0xs-tx-hash",
      ambiguous: false,
    }),
  } as unknown as ResolutionAgentX402SettlementClient;

  const generator = {
    generate: vi.fn().mockResolvedValue({
      assessment: {
        assessmentId: "assess_001",
        generatedAt: new Date().toISOString(),
        generationMode: "ai" as const,
        evidenceTitle: "Test",
        evidenceInputHash: "0xabcd",
        qualityScore: 75,
        relevanceRating: "high" as const,
        relevanceNote: "Relevant",
        credibilityAssessment: "Credible",
        completenessAssessment: "Complete",
        factualConsistencyNote: "Consistent",
        biasOrConflictNote: "None",
        strengths: [],
        weaknesses: [],
        recommendedActions: [],
        riskFlags: [],
        limitations: "AI only",
      },
      usedFallback: false,
    }),
  } as unknown as EvidenceQualityCheckGenerator;

  const walletDecryptor = {
    decrypt: vi.fn().mockResolvedValue({
      address: "0xDeaDbeef00000000000000000000000000000000",
    } as unknown as Account),
  } as unknown as ResolutionAgentWalletDecryptor;

  const paymentStore = {
    persistPaymentProof: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResolutionAgentPaymentStore;

  const dependencies: EvidenceQualityCheckDependencies = {
    store,
    settlementClient,
    generator,
    walletDecryptor,
    paymentStore,
  };

  return { dependencies, store };
}

// ---------------------------------------------------------------------------
// Executor Registry Tests
// ---------------------------------------------------------------------------

describe("createProductionActionExecutor", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("evidence-quality-check dispatched to correct adapter", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = makeToolAction("evidence-quality-check");
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("executed");
    expect(deps.store.reserveToolExecutionAtomically).toHaveBeenCalled();
  });

  it("case-refresh is wired to adapter", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = makeToolAction("case-refresh");
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    // case-refresh is now supported — with proper deps it should not return unsupported_action
    // Without a CaseRefreshGenerator, it will fail recoverable
    expect(result.kind).not.toBe("unsupported_action");
  });

  it("Dispute Brief is wired to adapter", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = makeToolAction("reclaim-dispute-brief-v1");
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    // dispute-brief is now supported — with proper deps it should not return unsupported_action
    expect(result.kind).not.toBe("unsupported_action");
  });

  it("non-tool actions return skipped", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = {
      kind: "ready_for_human_review",
      caseVersionHash: "h",
      disputeBriefReference: null,
      reason: "ready",
    } as unknown as ResolutionAgentNextAction;
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("Non-tool action");
  });

  it("wait_for_evidence action returns skipped", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = {
      kind: "wait_for_evidence",
      evidenceRequestIds: [],
      caseVersionHash: "h",
      evidenceVersionHash: "h2",
      reason: "waiting",
    } as unknown as ResolutionAgentNextAction;
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("skipped");
  });

  it("create_evidence_request action returns skipped", async () => {
    const executor = createProductionActionExecutor(deps.dependencies);
    const agent = makeAgent();
    const plan = agent.plan!;
    const action = {
      kind: "create_evidence_request",
      responsibleParty: "client" as const,
      evidenceItem: "screenshots",
      reason: "need more",
      plannerReason: "evidence_missing" as const,
    } as unknown as ResolutionAgentNextAction;
    const lease = makeLeaseContext();

    const result = await executor.executeOneAction({
      agent, plan, action, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Recovery Handler Tests
// ---------------------------------------------------------------------------

describe("createProductionRecoveryHandler", () => {
  let deps: ReturnType<typeof makeMockDependencies>;

  beforeEach(() => {
    deps = makeMockDependencies();
  });

  it("recovers paid_pending_result evidence-quality-check execution", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow("evidence-quality-check", "paid_pending_result");
    execution.settlement_tx_hash = "0xtx123";
    execution.result_data = null;
    const lease = makeLeaseContext();

    const result = await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("recovered");
  });

  it("case-refresh is wired to recovery handler", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent();
    const execution = makeToolExecutionRow("case-refresh", "paid_pending_result");
    const lease = makeLeaseContext();

    const result = await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    // case-refresh is now supported — with proper deps it should not return unsupported_action
    expect(result.kind).not.toBe("unsupported_action");
  });

  it("Dispute Brief is wired to recovery handler", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent();
    const execution = makeToolExecutionRow("reclaim-dispute-brief-v1", "paid_pending_result");
    const lease = makeLeaseContext();

    const result = await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    // dispute-brief is now supported — with proper deps it should not return unsupported_action
    expect(result.kind).not.toBe("unsupported_action");
  });

  it("unknown tool returns unsupported_action in recovery", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent();
    const execution = makeToolExecutionRow("unknown-tool", "paid_pending_result");
    const lease = makeLeaseContext();

    const result = await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    expect(result.kind).toBe("unsupported_action");
    expect((result as any).actionKind).toBe("unknown-tool");
  });

  it("recovery handler never calls settlement", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow("evidence-quality-check", "paid_pending_result");
    execution.settlement_tx_hash = "0xtx123";
    const lease = makeLeaseContext();

    await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    expect(deps.dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("recovery handler never decrypts wallet", async () => {
    const handler = createProductionRecoveryHandler(deps.dependencies);
    const agent = makeAgent({ status: "running_tool" });
    const execution = makeToolExecutionRow("evidence-quality-check", "paid_pending_result");
    execution.settlement_tx_hash = "0xtx123";
    const lease = makeLeaseContext();

    await handler.recover({
      agent, execution, leaseContext: lease, now: Date.now(),
    });

    expect(deps.dependencies.walletDecryptor.decrypt).not.toHaveBeenCalled();
  });
});
