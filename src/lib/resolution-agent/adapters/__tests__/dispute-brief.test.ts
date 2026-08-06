// ---------------------------------------------------------------------------
// Dispute Brief Adapter — Test Suite (TDD)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeDisputeBrief } from "../dispute-brief";
import type {
  DisputeBriefDependencies,
  DisputeBriefGenerationResult,
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
    allowedTools: ["reclaim-dispute-brief-v1"],
    approvedBudgetAtomic: 100000n,
    expiresAt: Date.now() + 86400000,
    funderAddress: "0xF000000000000000000000000000000000000000",
    ...overrides,
  };
}

function makePlan(overrides: Partial<ResolutionAgentPlan> = {}): ResolutionAgentPlan {
  return {
    steps: [{ kind: "purchase_dispute_brief", description: "Generate dispute brief", toolId: "reclaim-dispute-brief-v1" }],
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

function makeLeaseContext(overrides: Partial<LeaseContext> = {}): LeaseContext {
  return {
    agentId: "agent_test_1",
    ownerToken: "token_abc",
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 60000,
    ...overrides,
  };
}

function makeAction(overrides: Partial<ResolutionAgentNextAction & { kind: "run_tool" }> = {}): ResolutionAgentNextAction & { kind: "run_tool" } {
  return {
    kind: "run_tool",
    toolId: "reclaim-dispute-brief-v1",
    reason: "dispute_brief_ready",
    toolRequest: {
      toolId: "reclaim-dispute-brief-v1",
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

function makeGenResult(overrides: Partial<DisputeBriefGenerationResult> = {}): DisputeBriefGenerationResult {
  return {
    briefId: "brief_001",
    generatedAt: new Date().toISOString(),
    generationMode: "ai",
    reviewerPacketReady: true,
    summary: "Dispute brief successfully generated.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dependency Mocks
// ---------------------------------------------------------------------------

function createMockDependencies(overrides: Partial<DisputeBriefDependencies> = {}): DisputeBriefDependencies {
  return {
    store: {
      getAgentById: vi.fn().mockResolvedValue(makeAgent({
        status: "running_tool",
        currentRunningToolId: "reclaim-dispute-brief-v1",
        budget: makeBudget({ reservedAtomic: 10000n }),
      })),
      getToolExecutionByRequestHash: vi.fn().mockResolvedValue(null),
      getAgentVersion: vi.fn().mockResolvedValue(1),
      listToolExecutions: vi.fn().mockResolvedValue([
        {
          id: "exec_qc_1", agent_id: "agent_test_1", tool_identifier: "evidence-quality-check",
          request_hash: "0xqc", state: "settled",
          updated_at: new Date().toISOString(),
          result_data: { evidenceVersionHash: "ev_hash_v1", readiness: "ready" },
          case_version_hash: null, evidence_version_hash: "ev_hash_v1",
          price_atomic: 10000, network: "eip155:42220",
          asset_address: "0xc", pay_to_address: "0x8",
          payment_reference: null, settlement_tx_hash: null,
          result_reference: null, failure_reason: null,
          created_at: new Date().toISOString(),
        },
        {
          id: "exec_cr_1", agent_id: "agent_test_1", tool_identifier: "case-refresh",
          request_hash: "0xcr", state: "settled",
          updated_at: new Date().toISOString(),
          result_data: { caseVersionHash: "case_hash_v1", readiness: "ready" },
          case_version_hash: "case_hash_v1", evidence_version_hash: null,
          price_atomic: 10000, network: "eip155:42220",
          asset_address: "0xc", pay_to_address: "0x8",
          payment_reference: null, settlement_tx_hash: null,
          result_reference: null, failure_reason: null,
          created_at: new Date().toISOString(),
        },
      ] as any),
      reserveToolExecutionAtomically: vi.fn().mockResolvedValue({ kind: "created", agentId: "agent_test_1", requestHash: "0xhash", state: "reserved" }),
      updateToolExecution: vi.fn().mockResolvedValue(undefined),
      updateAgent: vi.fn().mockResolvedValue(makeAgent({ status: "active" })),
      appendEvent: vi.fn().mockResolvedValue(undefined),
      createToolExecution: vi.fn().mockResolvedValue(undefined),
    } as any,
    settlementClient: {
      settleDisputeBrief: vi.fn().mockResolvedValue({
        success: true,
        txHash: "0xtxhash",
        ambiguous: false,
      }),
      settleEvidenceQualityCheck: vi.fn(),
      settleCaseRefresh: vi.fn(),
    } as any,
    generator: {
      generate: vi.fn().mockResolvedValue(makeGenResult()),
    } as any,
    walletDecryptor: {
      decrypt: vi.fn().mockResolvedValue({
        address: "0xDeaDbeef00000000000000000000000000000000",
      } as unknown as Account),
    } as any,
    paymentStore: {
      persistPaymentProof: vi.fn().mockResolvedValue(undefined),
    } as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeDisputeBrief", () => {
  let agent: ResolutionAgent;
  let plan: ResolutionAgentPlan;
  let action: ResolutionAgentNextAction & { kind: "run_tool" };
  let leaseContext: LeaseContext;
  let dependencies: DisputeBriefDependencies;

  beforeEach(() => {
    agent = makeAgent();
    plan = makePlan();
    action = makeAction();
    leaseContext = makeLeaseContext();
    dependencies = createMockDependencies();
  });

  // ---- Validation Tests ----

  it("skips non-run_tool actions", async () => {
    const result = await executeDisputeBrief({
      agent, plan,
      action: { kind: "wait_for_evidence", evidenceRequestIds: [], caseVersionHash: "x", evidenceVersionHash: "y", reason: "evidence_missing" } as ResolutionAgentNextAction,
      leaseContext,
      now: Date.now(),
      dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  it("returns unsupported_action for wrong toolId", async () => {
    action.toolId = "evidence-quality-check";
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("unsupported_action");
  });

  it("skips on price mismatch", async () => {
    action.toolRequest.priceAtomic = 9999n;
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  it("skips on network mismatch", async () => {
    action.toolRequest.network = "eip155:1";
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  it("skips on asset mismatch", async () => {
    action.toolRequest.asset = "0x0000000000000000000000000000000000000000";
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  it("skips on payTo mismatch", async () => {
    action.toolRequest.payTo = "0x0000000000000000000000000000000000000000";
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  // ---- Plan Validation Tests ----

  it("returns stale_plan when caseVersionHash mismatches", async () => {
    plan.caseVersionHash = "different_hash";
    agent.plan = plan;
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("stale_plan");
  });

  it("returns stale_plan when evidenceVersionHash mismatches", async () => {
    plan.evidenceVersionHash = "different_ev_hash";
    agent.plan = plan;
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("stale_plan");
  });

  // ---- Missing Observation ----

  it("skips when agent has no observation", async () => {
    agent.observation = null;
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
    expect((result as any).reason).toContain("no observation");
  });

  // ---- Existing Execution Tests ----

  it("returns executed when existing execution is settled", async () => {
    (dependencies.store.getToolExecutionByRequestHash as any).mockResolvedValue({
      state: "settled",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("executed");
  });

  it("returns waiting when existing execution is paid_pending_result", async () => {
    (dependencies.store.getToolExecutionByRequestHash as any).mockResolvedValue({
      state: "paid_pending_result",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("waiting");
  });

  it("returns waiting when existing execution is settling", async () => {
    (dependencies.store.getToolExecutionByRequestHash as any).mockResolvedValue({
      state: "settling",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("waiting");
  });

  // ---- Successful Execution Tests ----

  it("successfully executes a full flow and returns executed", async () => {
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("executed");
  });

  it("calls reserveToolExecutionAtomically during creation", async () => {
    await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(dependencies.store.reserveToolExecutionAtomically).toHaveBeenCalled();
  });

  it("calls walletDecryptor.decrypt", async () => {
    await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(dependencies.walletDecryptor.decrypt).toHaveBeenCalled();
  });

  it("calls settlementClient.settleDisputeBrief", async () => {
    await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(dependencies.settlementClient.settleDisputeBrief).toHaveBeenCalled();
  });

  it("calls generator.generate", async () => {
    await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(dependencies.generator.generate).toHaveBeenCalled();
  });

  // ---- Existing via atomic RPC ----

  it("handles existing execution from RPC idempotent return", async () => {
    (dependencies.store.reserveToolExecutionAtomically as any).mockResolvedValue({
      kind: "existing",
      state: "settled",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("executed");
  });

  it("handles existing paid_pending_result from RPC", async () => {
    (dependencies.store.reserveToolExecutionAtomically as any).mockResolvedValue({
      kind: "existing",
      state: "paid_pending_result",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("waiting");
  });

  // ---- Wallet Decryption Failure ----

  it("returns failed_recoverable on wallet decryption failure", async () => {
    (dependencies.walletDecryptor.decrypt as any).mockRejectedValue(new Error("Decrypt failed"));
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("failed_recoverable");
  });

  // ---- Wallet Address Mismatch ----

  it("returns failed_safe on wallet address mismatch", async () => {
    (dependencies.walletDecryptor.decrypt as any).mockResolvedValue({
      address: "0xBadBeee000000000000000000000000000000000",
    } as unknown as Account);
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("failed_safe");
  });

  // ---- Settlement Failure ----

  it("returns skipped on confirmed unpaid", async () => {
    (dependencies.settlementClient.settleDisputeBrief as any).mockResolvedValue({
      success: false,
      ambiguous: false,
      error: "Insufficient balance",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("skipped");
  });

  it("returns failed_recoverable on ambiguous settlement", async () => {
    (dependencies.settlementClient.settleDisputeBrief as any).mockResolvedValue({
      success: false,
      ambiguous: true,
      error: "Network timeout",
    });
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("failed_recoverable");
  });

  // ---- Lease Agent ID Mismatch ----

  it("returns failed_safe on lease context agent ID mismatch", async () => {
    leaseContext.agentId = "different_agent";
    const result = await executeDisputeBrief({
      agent, plan, action, leaseContext,
      now: Date.now(), dependencies,
    });
    expect(result.kind).toBe("failed_safe");
  });
});
