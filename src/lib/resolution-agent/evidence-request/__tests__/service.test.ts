import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreateEvidenceRequest, executeWaitForEvidence } from "../service";
import type { ResolutionAgent, ResolutionAgentPlan } from "../../types";
import type { ResolutionAgentNextAction, PlannerReasonCode } from "../../planner/types";
import type { LeaseContext } from "../../worker/types";
import type { EvidenceRequestRow } from "../../store/types";
import type { EvidenceRequestStore } from "../types";
import {
  ResolutionAgentEvidenceRequestStalePlanError,
  ResolutionAgentEvidenceRequestUnauthorizedPartyError,
  ResolutionAgentEvidenceRequestConflictError,
} from "../errors";

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

function makeEvidenceRequestRow(overrides: Partial<EvidenceRequestRow> = {}): EvidenceRequestRow {
  return {
    id: "evreq_test_1",
    agent_id: "agt_test_1",
    responsible_party: "client",
    evidence_item: "missing receipt",
    reason: "Receipt is required",
    status: "open",
    created_case_version_hash: "case_v1",
    evidence_version_hash: null,
    fulfilled_case_version_hash: null,
    created_at: "2024-01-01T00:00:00.000Z",
    fulfilled_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function makeMockStore(overrides: Partial<EvidenceRequestStore> = {}): EvidenceRequestStore {
  return {
    listEvidenceRequests: vi.fn().mockResolvedValue([]),
    createEvidenceRequest: vi.fn().mockImplementation(
      (agentId, responsibleParty, evidenceItem, reason, caseVersionHash, evidenceVersionHash) =>
        Promise.resolve(makeEvidenceRequestRow({
          id: "evreq_new_1",
          agent_id: agentId,
          responsible_party: responsibleParty,
          evidence_item: evidenceItem,
          reason,
          created_case_version_hash: caseVersionHash ?? null,
          fulfilled_case_version_hash: evidenceVersionHash ?? null, // Not actually set — just matching the Row
        })),
    ),
    updateAgent: vi.fn().mockImplementation((agent) => Promise.resolve(agent)),
    getAgentVersion: vi.fn().mockResolvedValue(1),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// executeCreateEvidenceRequest tests
// ---------------------------------------------------------------------------

describe("executeCreateEvidenceRequest", () => {
  const now = 1_000_000;
  let agent: ResolutionAgent;
  let plan: ResolutionAgentPlan;
  let leaseCtx: LeaseContext;
  let store: EvidenceRequestStore;

  beforeEach(() => {
    agent = makeTestAgent();
    plan = agent.plan!;
    leaseCtx = makeLeaseContext();
    store = makeMockStore();
  });

  describe("valid creation", () => {
    it("creates a worker request with status open", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "worker",
        evidenceItem: "proof of delivery",
        reason: "Need proof for review",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { result, agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(result.kind).toBe("executed");
      expect(store.createEvidenceRequest).toHaveBeenCalledWith(
        "agt_test_1",
        "worker",
        "proof of delivery",
        "Need proof for review",
        "case_v1",
        "ev_v1",
      );
      expect(updated.status).toBe("waiting_for_evidence");
    });

    it("creates a client request with status open", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "signed contract",
        reason: "Contract is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { result } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(result.kind).toBe("executed");
      expect(store.createEvidenceRequest).toHaveBeenCalledWith(
        "agt_test_1",
        "client",
        "signed contract",
        "Contract is required",
        "case_v1",
        "ev_v1",
      );
    });

    it("agent transitions to waiting_for_evidence", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(updated.status).toBe("waiting_for_evidence");
      expect(store.updateAgent).toHaveBeenCalled();
      expect(store.appendEvent).toHaveBeenCalled();
    });

    it("created_case_version_hash and evidence_version_hash are passed to store", async () => {
      const createSpy = vi.fn().mockResolvedValue(
        makeEvidenceRequestRow({ created_case_version_hash: "case_v1" }),
      );
      const testStore = makeMockStore({ createEvidenceRequest: createSpy });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(createSpy).toHaveBeenCalledWith(
        "agt_test_1",
        "client",
        "receipt",
        "Need it",
        "case_v1",
        "ev_v1",
      );
    });

    it("does not change budget", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(updated.budget.approvedAtomic).toBe(agent.budget.approvedAtomic);
      expect(updated.budget.spentAtomic).toBe(agent.budget.spentAtomic);
      expect(updated.budget.reservedAtomic).toBe(agent.budget.reservedAtomic);
    });

    it("does not decrypt wallet (encryptedSecret unchanged)", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(updated.encryptedSecret).toEqual(agent.encryptedSecret);
      expect(updated.encryptedSecret.ciphertext).toBe("test-ciphertext");
    });

    it("no settlement called (settledToolIds unchanged)", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(updated.settledToolIds).toEqual([]);
    });

    it("appends evidence_request_created event", async () => {
      const appendSpy = vi.fn().mockResolvedValue(undefined);
      const testStore = makeMockStore({ appendEvent: appendSpy });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      const creationCalls = appendSpy.mock.calls.filter(
        (call: unknown[]) => call[1] === "evidence_request_created",
      );
      expect(creationCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("duplication / idempotency", () => {
    it("second identical request returns existing, no duplicate row", async () => {
      const existingRow = makeEvidenceRequestRow({
        id: "evreq_existing",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "open",
      });

      const createSpy = vi.fn().mockResolvedValue(existingRow);
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingRow]),
        createEvidenceRequest: createSpy,
      });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { result } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(result.kind).toBe("executed");
      // Should NOT create a new row
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("idempotent repeated call does NOT create duplicate append event for the same request", async () => {
      const existingRow = makeEvidenceRequestRow({
        id: "evreq_existing",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "open",
      });

      const appendSpy = vi.fn().mockResolvedValue(undefined);
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingRow]),
        appendEvent: appendSpy,
      });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      // First call
      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Second call (same action, same store)
      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // evidence_request_created should NEVER be emitted for duplicates
      const createdEvents = appendSpy.mock.calls.filter(
        (call: unknown[]) => call[1] === "evidence_request_created",
      );
      expect(createdEvents.length).toBe(0);
    });

    it("different case hash may create new request", async () => {
      const existingRow = makeEvidenceRequestRow({
        id: "evreq_existing",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "open",
      });

      const createSpy = vi.fn().mockResolvedValue(
        makeEvidenceRequestRow({
          id: "evreq_new",
          responsible_party: "client",
          evidence_item: "missing receipt",
          created_case_version_hash: "case_v2",
        }),
      );
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingRow]),
        createEvidenceRequest: createSpy,
      });

      // Different plan with new case hash
      const planV2: ResolutionAgentPlan = {
        ...plan,
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
      };

      const agentV2 = makeTestAgent({
        observation: {
          escrowState: "disputed",
          evidenceCount: 2,
          evidenceVersionHash: "ev_v2",
          caseVersionHash: "case_v2",
          unresolvedGaps: [],
          hasMeaningfulChange: true,
          observedAt: 1_000_000,
        },
        plan: planV2,
      });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await executeCreateEvidenceRequest({
        agent: agentV2,
        plan: planV2,
        action,
        leaseContext: { ...leaseCtx, agentId: "agt_test_1" },
        now,
        store: testStore,
      });

      // Should have created a new request because case hash differs
      expect(createSpy).toHaveBeenCalled();
    });

    it("different party may create new request", async () => {
      const existingRow = makeEvidenceRequestRow({
        id: "evreq_existing",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "open",
      });

      const createSpy = vi.fn().mockResolvedValue(
        makeEvidenceRequestRow({
          id: "evreq_new",
          responsible_party: "worker",
          evidence_item: "missing receipt",
          created_case_version_hash: "case_v1",
        }),
      );
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingRow]),
        createEvidenceRequest: createSpy,
      });

      // Request from a different party (worker vs client)
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "worker",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Should have created a new request because party differs
      expect(createSpy).toHaveBeenCalled();
    });

    it("already fulfilled request with same evidenceItem doesn't block new creation", async () => {
      const existingFulfilled = makeEvidenceRequestRow({
        id: "evreq_fulfilled",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "fulfilled",
        fulfilled_at: "2024-01-01T00:00:00.000Z",
      });

      const createSpy = vi.fn().mockResolvedValue(
        makeEvidenceRequestRow({
          id: "evreq_new",
          responsible_party: "client",
          evidence_item: "missing receipt",
          created_case_version_hash: "case_v1",
        }),
      );
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingFulfilled]),
        createEvidenceRequest: createSpy,
      });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Should create because the existing one is fulfilled (not open)
      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe("validation / errors", () => {
    it("rejects non-create_evidence_request action", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "no_action",
        reason: "no_meaningful_change" as PlannerReasonCode,
      };

      const { result } = await executeCreateEvidenceRequest({
        agent,
        plan,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        action: action as any,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(result.kind).toBe("unsupported_action");
    });

    it("rejects invalid responsibleParty", async () => {
      const action = {
        kind: "create_evidence_request" as const,
        responsibleParty: "attacker" as string,
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await expect(
        executeCreateEvidenceRequest({
          agent,
          plan,
          action: action as ResolutionAgentNextAction & { kind: "create_evidence_request" },
          leaseContext: leaseCtx,
          now,
          store,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestUnauthorizedPartyError);
    });

    it("rejects stale plan (case hash mismatch)", async () => {
      const stalePlan: ResolutionAgentPlan = {
        ...plan,
        caseVersionHash: "case_old",
      };

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await expect(
        executeCreateEvidenceRequest({
          agent,
          plan: stalePlan,
          action,
          leaseContext: leaseCtx,
          now,
          store,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestStalePlanError);
    });

    it("rejects stale plan (evidence hash mismatch)", async () => {
      const stalePlan: ResolutionAgentPlan = {
        ...plan,
        evidenceVersionHash: "ev_old",
      };

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await expect(
        executeCreateEvidenceRequest({
          agent,
          plan: stalePlan,
          action,
          leaseContext: leaseCtx,
          now,
          store,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestStalePlanError);
    });

    it("rejects lease context mismatch (different agentId)", async () => {
      const badLease: LeaseContext = {
        ...leaseCtx,
        agentId: "agt_other",
      };

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await expect(
        executeCreateEvidenceRequest({
          agent,
          plan,
          action,
          leaseContext: badLease,
          now,
          store,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestConflictError);
    });

    it("rejects empty evidenceItem", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      await expect(
        executeCreateEvidenceRequest({
          agent,
          plan,
          action,
          leaseContext: leaseCtx,
          now,
          store,
        }),
      ).rejects.toThrow("Evidence item must not be empty");
    });
  });

  describe("crash recovery — consistency", () => {
    it("after crash between request creation and status transition: one request exists", async () => {
      // Simulate the scenario where a crash happened after createEvidenceRequest
      // but before the agent status was updated. On re-processing, the agent
      // is still "active" but the evidence request already exists.
      const existingRow = makeEvidenceRequestRow({
        id: "evreq_crashed",
        responsible_party: "client",
        evidence_item: "missing receipt",
        created_case_version_hash: "case_v1",
        status: "open",
      });

      const agentStillActive = makeTestAgent({ status: "active" }); // Not yet transitioned

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([existingRow]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "missing receipt",
        reason: "Receipt is required",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent: agentStillActive,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // The agent should be reconciled to waiting_for_evidence
      expect(updated.status).toBe("waiting_for_evidence");
      // Only one request should exist (the pre-existing one)
      expect(testStore.listEvidenceRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe("security", () => {
    it("no secrets in result", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { result, agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      // Result should not contain secrets
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain("ciphertext");
      expect(resultStr).not.toContain("authenticationTag");
      expect(resultStr).not.toContain("privateKey");
      expect(resultStr).not.toContain("secret");

      // Agent still has encryptedSecret but that's the domain object, not leaked
      expect(updated.encryptedSecret.ciphertext).toBe("test-ciphertext");
    });

    it("no budget change", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(updated.budget.spentAtomic).toBe(0n);
      expect(updated.budget.reservedAtomic).toBe(0n);
      expect(updated.budget.approvedAtomic).toBe(1_000_000n);
    });

    it("no wallet decryption", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      // encryptedSecret stays exactly as-is (no decryption attempted)
      expect(updated.encryptedSecret).toStrictEqual(agent.encryptedSecret);
    });

    it("no settlement", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "create_evidence_request",
        responsibleParty: "client",
        evidenceItem: "receipt",
        reason: "Need it",
        plannerReason: "evidence_missing" as PlannerReasonCode,
      };

      const { agent: updated } = await executeCreateEvidenceRequest({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store,
      });

      // No tools settled
      expect(updated.settledToolIds).toEqual([]);
      // Not in a settled terminal state
      expect(updated.status).not.toBe("closed");
      expect(updated.status).not.toBe("ready_for_human_review");
    });
  });
});

// ---------------------------------------------------------------------------
// executeWaitForEvidence tests
// ---------------------------------------------------------------------------

describe("executeWaitForEvidence", () => {
  const now = 1_000_000;
  let agent: ResolutionAgent;
  let plan: ResolutionAgentPlan;
  let leaseCtx: LeaseContext;
  let store: EvidenceRequestStore;

  beforeEach(() => {
    agent = makeTestAgent();
    plan = agent.plan!;
    leaseCtx = makeLeaseContext();
    store = makeMockStore();
  });

  describe("open request produces wait", () => {
    it("returns waiting with open request", async () => {
      const openReq = makeEvidenceRequestRow({
        id: "evreq_open_1",
        responsible_party: "client",
        status: "open",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_open_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { result } = await executeWaitForEvidence({
        agent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(result.kind).toBe("waiting");
    });

    it("agent keeps waiting_for_evidence state", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({
        id: "evreq_open_1",
        status: "open",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_open_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(updated.status).toBe("waiting_for_evidence");
    });

    it("transitions active agent to waiting_for_evidence", async () => {
      const activeAgent = makeTestAgent({ status: "active" });
      const openReq = makeEvidenceRequestRow({
        id: "evreq_open_1",
        status: "open",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_open_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { agent: updated } = await executeWaitForEvidence({
        agent: activeAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(updated.status).toBe("waiting_for_evidence");
    });
  });

  describe("no duplicate waiting events", () => {
    it("does not append waiting event on repeated calls when already waiting", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({
        id: "evreq_open_1",
        status: "open",
      });

      const appendSpy = vi.fn().mockResolvedValue(undefined);
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
        appendEvent: appendSpy,
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_open_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      // First call (should append a status_change event if transitioning)
      await executeWaitForEvidence({
        agent: makeTestAgent({ status: "active" }), // Not yet waiting
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Now do repeated calls with agent already waiting
      for (let i = 0; i < 3; i++) {
        await executeWaitForEvidence({
          agent: waitingAgent,
          plan,
          action,
          leaseContext: leaseCtx,
          now,
          store: testStore,
        });
      }

      // For the already-waiting agent, updateAgent should never be called
      // because no transition is needed
      const nonTransitionCalls = appendSpy.mock.calls.filter(
        (call: unknown[]) => call[1] === "status_change",
      );
      // status_change events should only be from the first (transitioning) call
      expect(nonTransitionCalls.length).toBe(1);
    });
  });

  describe("validation", () => {
    it("referenced request not belonging to agent is rejected", async () => {
      const otherAgentReq = makeEvidenceRequestRow({
        id: "evreq_other",
        agent_id: "agt_other",
        status: "open",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([otherAgentReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_other"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      await expect(
        executeWaitForEvidence({
          agent,
          plan,
          action,
          leaseContext: leaseCtx,
          now,
          store: testStore,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestConflictError);
    });

    it("missing referenced request fails safely", async () => {
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_nonexistent"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      await expect(
        executeWaitForEvidence({
          agent,
          plan,
          action,
          leaseContext: leaseCtx,
          now,
          store: testStore,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestConflictError);
    });

    it("rejects stale plan", async () => {
      const stalePlan: ResolutionAgentPlan = {
        ...plan,
        caseVersionHash: "case_old",
      };

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      await expect(
        executeWaitForEvidence({
          agent,
          plan: stalePlan,
          action,
          leaseContext: leaseCtx,
          now,
          store,
        }),
      ).rejects.toThrow(ResolutionAgentEvidenceRequestStalePlanError);
    });

    it("rejects non-wait_for_evidence action", async () => {
      const action: ResolutionAgentNextAction = {
        kind: "no_action",
        reason: "no_meaningful_change" as PlannerReasonCode,
      };

      const { result } = await executeWaitForEvidence({
        agent,
        plan,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        action: action as any,
        leaseContext: leaseCtx,
        now,
        store,
      });

      expect(result.kind).toBe("unsupported_action");
    });
  });

  describe("fulfilled requests", () => {
    it("all fulfilled requests don't auto-resume — returns waiting", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const fulfilledReq = makeEvidenceRequestRow({
        id: "evreq_fulfilled",
        status: "fulfilled",
        fulfilled_at: "2024-01-01T00:00:00.000Z",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([fulfilledReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_fulfilled"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { result, agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Task 12 handles auto-resumption — we just stay waiting
      expect(result.kind).toBe("waiting");
      expect(updated.status).toBe("waiting_for_evidence");
    });

    it("all cancelled requests don't auto-resume", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const cancelledReq = makeEvidenceRequestRow({
        id: "evreq_cancelled",
        status: "cancelled",
        cancelled_at: "2024-01-01T00:00:00.000Z",
      });

      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([cancelledReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_cancelled"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { result, agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      // Task 12 handles auto-resumption
      expect(result.kind).toBe("waiting");
      expect(updated.status).toBe("waiting_for_evidence");
    });
  });

  describe("security", () => {
    it("no secrets in result", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({ id: "evreq_1", status: "open" });
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { result } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain("ciphertext");
      expect(resultStr).not.toContain("authenticationTag");
      expect(resultStr).not.toContain("privateKey");
    });

    it("no budget change", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({ id: "evreq_1", status: "open" });
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(updated.budget.spentAtomic).toBe(0n);
      expect(updated.budget.reservedAtomic).toBe(0n);
    });

    it("no wallet decryption", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({ id: "evreq_1", status: "open" });
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(updated.encryptedSecret).toStrictEqual(waitingAgent.encryptedSecret);
    });

    it("no settlement", async () => {
      const waitingAgent = makeTestAgent({ status: "waiting_for_evidence" });
      const openReq = makeEvidenceRequestRow({ id: "evreq_1", status: "open" });
      const testStore = makeMockStore({
        listEvidenceRequests: vi.fn().mockResolvedValue([openReq]),
      });

      const action: ResolutionAgentNextAction = {
        kind: "wait_for_evidence",
        evidenceRequestIds: ["evreq_1"],
        caseVersionHash: "case_v1",
        evidenceVersionHash: "ev_v1",
        reason: "evidence_request_already_open" as PlannerReasonCode,
      };

      const { agent: updated } = await executeWaitForEvidence({
        agent: waitingAgent,
        plan,
        action,
        leaseContext: leaseCtx,
        now,
        store: testStore,
      });

      expect(updated.settledToolIds).toEqual([]);
    });
  });
});
