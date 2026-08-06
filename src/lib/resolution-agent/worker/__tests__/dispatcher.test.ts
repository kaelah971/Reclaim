import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchControlAction, isPlanStale } from "../dispatcher";
import type { ResolutionAgent, ResolutionAgentPlan } from "../../types";
import type { ResolutionAgentNextAction, PlannerReasonCode } from "../../planner/types";
import type { LeaseContext, ResolutionAgentActionExecutor, ActionExecutionResult } from "../types";
import type { ResolutionAgentStore } from "../../api/service";

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
    budget: {
      approvedAtomic: 1_000_000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: {
      steps: [{ kind: "check_evidence", description: "waiting" }],
      currentStepIndex: 0,
      lastUpdated: 1_000_000,
      caseVersionHash: "case_v1",
      evidenceVersionHash: "ev_v1",
    },
    observation: {
      escrowState: "disputed",
      evidenceCount: 2,
      evidenceVersionHash: "ev_v1",
      caseVersionHash: "case_v1",
      unresolvedGaps: [],
      hasMeaningfulChange: false,
      observedAt: 1_000_000,
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
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeLeaseContext(): LeaseContext {
  return {
    agentId: "agt_test_1",
    ownerToken: "token-123",
    acquiredAt: 1_000_000,
    expiresAt: 1_060_000,
  };
}

function makeMockStore(agent: ResolutionAgent): ResolutionAgentStore {
  return {
    getAgentById: vi.fn().mockResolvedValue(agent),
    getAgentByCaseIdentity: vi.fn().mockResolvedValue(null),
    createAgent: vi.fn().mockResolvedValue(agent),
    updateAgent: vi.fn().mockResolvedValue(agent),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
  };
}

function makeMockExecutor(): ResolutionAgentActionExecutor {
  return {
    executeOneAction: vi.fn().mockResolvedValue({ kind: "executed" } as ActionExecutionResult),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatchControlAction", () => {
  const now = 1_000_000;
  let agent: ResolutionAgent;
  let plan: ResolutionAgentPlan;
  let leaseCtx: LeaseContext;
  let store: ResolutionAgentStore;
  let executor: ResolutionAgentActionExecutor;

  beforeEach(() => {
    agent = makeTestAgent();
    plan = agent.plan!;
    leaseCtx = makeLeaseContext();
    store = makeMockStore(agent);
    executor = makeMockExecutor();
  });

  describe("no_action", () => {
    it("returns skipped, no state change", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "no_action",
        reason: "no_meaningful_change" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("skipped");
      expect(updated.status).toBe("active"); // unchanged
      expect(store.updateAgent).not.toHaveBeenCalled();
    });
  });

  describe("budget_exhausted", () => {
    it("transitions to budget_exhausted", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "budget_exhausted",
        reason: "insufficient_budget" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("executed");
      expect(updated.status).toBe("budget_exhausted");
    });

    it("is idempotent — already budget_exhausted returns skipped", async () => {
      const budgetExhaustedAgent = makeTestAgent({ status: "budget_exhausted" });
      const budgetStore = makeMockStore(budgetExhaustedAgent);
      const action: ResolutionAgentNextAction = {
        kind: "budget_exhausted",
        reason: "insufficient_budget" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent: budgetExhaustedAgent,
        plan: budgetExhaustedAgent.plan!,
        action,
        leaseContext: leaseCtx,
        now,
        store: budgetStore,
        executor,
      });
      expect(result.kind).toBe("skipped");
      expect(updated.status).toBe("budget_exhausted"); // unchanged
    });
  });

  describe("ready_for_human_review", () => {
    it("transitions safely", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "ready_for_human_review",
        caseVersionHash: "case_v1",
        disputeBriefReference: null,
        reason: "ready_for_human_review" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("executed");
      expect(updated.status).toBe("ready_for_human_review");
    });

    it("does not settle escrow", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "ready_for_human_review",
        caseVersionHash: "case_v1",
        disputeBriefReference: null,
        reason: "ready_for_human_review" as PlannerReasonCode,
      };
      const { agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      // Escrow settlement is a human decision — agent stops here
      expect(updated.status).toBe("ready_for_human_review");
      // No further transition to anything escrow-settled-related
    });
  });

  describe("waiting_for_human_approval", () => {
    it("transitions safely", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "waiting_for_human_approval",
        reason: "ready_for_human_review" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("executed");
      expect(updated.status).toBe("waiting_for_human_approval");
    });

    it("is idempotent when already in that state", async () => {
      const alreadyWaiting = makeTestAgent({ status: "waiting_for_human_approval" });
      const waitingStore = makeMockStore(alreadyWaiting);
      const action: ResolutionAgentNextAction = {
        kind: "waiting_for_human_approval",
        reason: "ready_for_human_review" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent: alreadyWaiting,
        plan: alreadyWaiting.plan!,
        action,
        leaseContext: leaseCtx,
        now,
        store: waitingStore,
        executor,
      });
      expect(result.kind).toBe("skipped");
      expect(updated.status).toBe("waiting_for_human_approval");
    });
  });

  describe("wait_for_evidence", () => {
    it("returns waiting (no state change)", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["req_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("waiting");
      expect(updated.status).toBe("active"); // no state change
    });
  });

  describe("create_evidence_request", () => {
    it("returns unsupported_action", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_gaps_found" as PlannerReasonCode,
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("unsupported_action");
      expect(updated.status).toBe("active"); // no state change
    });
  });

  describe("run_tool", () => {
    it("returns unsupported_action", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "run_tool",
        toolId: "evidence-quality-check",
        reason: "evidence_quality_check_required" as PlannerReasonCode,
        toolRequest: {
          toolId: "evidence-quality-check",
          priceAtomic: 10_000n,
          network: "eip155:42220",
          asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
          payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
          caseVersionHash: "case_v1",
          evidenceVersionHash: "ev_v1",
        },
      };
      const { result, agent: updated } = await dispatchControlAction({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
        executor,
      });
      expect(result.kind).toBe("unsupported_action");
      expect(updated.status).toBe("active"); // no state change
    });
  });
});

describe("isPlanStale", () => {
  it("returns false when hashes match", () => {
    const agent = makeTestAgent({
      observation: {
        escrowState: "disputed",
        evidenceCount: 1,
        evidenceVersionHash: "ev_v1",
        caseVersionHash: "case_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: 1_000_000,
      },
      plan: {
        steps: [],
        currentStepIndex: 0,
        lastUpdated: 1_000_000,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
      },
    });
    expect(
      isPlanStale({
        agent,
        planVersion: 1,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
      }),
    ).toBe(false);
  });

  it("returns true when caseVersionHash differs", () => {
    const agent = makeTestAgent({
      observation: {
        escrowState: "disputed",
        evidenceCount: 1,
        evidenceVersionHash: "ev_v1",
        caseVersionHash: "case_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: 1_000_000,
      },
      plan: {
        steps: [],
        currentStepIndex: 0,
        lastUpdated: 1_000_000,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
      },
    });
    expect(
      isPlanStale({
        agent,
        planVersion: 1,
        caseVersionHash: "case_v2_different",
        evidenceVersionHash: "ev_v1",
      }),
    ).toBe(true);
  });

  it("returns true when evidenceVersionHash differs", () => {
    const agent = makeTestAgent({
      observation: {
        escrowState: "disputed",
        evidenceCount: 1,
        evidenceVersionHash: "ev_v1",
        caseVersionHash: "case_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: 1_000_000,
      },
      plan: {
        steps: [],
        currentStepIndex: 0,
        lastUpdated: 1_000_000,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
      },
    });
    expect(
      isPlanStale({
        agent,
        planVersion: 1,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v2_different",
      }),
    ).toBe(true);
  });

  it("returns true when no observation exists", () => {
    const agent = makeTestAgent({ observation: null, plan: null });
    expect(
      isPlanStale({
        agent,
        planVersion: 1,
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
      }),
    ).toBe(true);
  });
});
