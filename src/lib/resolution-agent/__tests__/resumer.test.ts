import { describe, it, expect } from "vitest";
import { evaluateResolutionAgentResumption, type ResumptionInput } from "../resumer";
import type { ResolutionAgent } from "../types";
import type { EvidenceRequestRow } from "../store/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_test_1",
    goal: "Prepare this payment case for fair human review.",
    status: "waiting_for_evidence",
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
      steps: [{ kind: "wait_for_evidence", description: "waiting" }],
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

function makeRequest(overrides: Partial<EvidenceRequestRow> = {}): EvidenceRequestRow {
  return {
    id: "evreq_test_1",
    agent_id: "agt_test_1",
    responsible_party: "client",
    evidence_item: "missing receipt",
    reason: "Receipt is required",
    status: "open",
    created_case_version_hash: "case_v1",
    evidence_version_hash: "ev_v1",
    fulfilled_case_version_hash: null,
    fulfillment_evidence_reference: null,
    evidence_preimage: null,
    created_at: "2024-01-01T00:00:00.000Z",
    fulfilled_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function makeInput(params: Partial<ResolutionAgent> = {}, requests: EvidenceRequestRow[] = []): ResumptionInput {
  return {
    agent: makeTestAgent(params),
    evidenceRequests: requests,
    now: 2_000_000,
  };
}

// ---------------------------------------------------------------------------
// Resumer — Basic
// ---------------------------------------------------------------------------

describe("evaluateResolutionAgentResumption basic", () => {
  it("returns stay_waiting for a non-waiting agent", async () => {
    const input = makeInput({ status: "active" });
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
    expect(result.reasonCode).toBe("still_waiting_on_open_request");
  });

  it("returns stay_waiting when one open request exists", async () => {
    const request = makeRequest({ status: "open" });
    const input = makeInput({ status: "waiting_for_evidence" }, [request]);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
    expect(result.reasonCode).toBe("still_waiting_on_open_request");
  });

  it("returns resume when the single open request is fulfilled", async () => {
    const request = makeRequest({
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:30:00.000Z",
      fulfilled_case_version_hash: "case_v2",
    });
    const input = makeInput({ status: "waiting_for_evidence" }, [request]);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
    expect(result.reasonCode).toBe("all_evidence_requests_resolved");
  });

  it("returns resume when the single open request is cancelled", async () => {
    const request = makeRequest({
      status: "cancelled",
      cancelled_at: "2024-01-01T00:30:00.000Z",
    });
    const input = makeInput({ status: "waiting_for_evidence" }, [request]);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
    expect(result.reasonCode).toBe("evidence_request_cancelled");
  });

  it("returns resume when all requests are fulfilled (no open)", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
    expect(result.reasonCode).toBe("all_evidence_requests_resolved");
  });

  it("returns stay_waiting with mixed fulfilled/open", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "open" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });

  it("returns stay_waiting with mixed cancelled/open", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "cancelled", cancelled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "open" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });

  it("returns resume when all open requests are resolved (fulfilled + cancelled)", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "cancelled", cancelled_at: "2024-01-01T00:30:00.000Z" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
  });
});

// ---------------------------------------------------------------------------
// Resumer — Malformed State
// ---------------------------------------------------------------------------

describe("evaluateResolutionAgentResumption malformed state", () => {
  it("returns failed_recoverable when waiting but no requests exist", async () => {
    const input = makeInput({ status: "waiting_for_evidence" }, []);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("failed_recoverable");
    expect(result.reasonCode).toBe("malformed_waiting_state");
  });

  it("returns stay_waiting when requests belong to another agent", async () => {
    const request = makeRequest({ agent_id: "agt_other", status: "open" });
    const input = makeInput({ status: "waiting_for_evidence" }, [request]);
    // Requests from another agent are filtered out, resulting in 0 relevant requests
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("failed_recoverable");
    expect(result.reasonCode).toBe("malformed_waiting_state");
  });
});

// ---------------------------------------------------------------------------
// Resumer — Multiple Requests
// ---------------------------------------------------------------------------

describe("evaluateResolutionAgentResumption multiple requests", () => {
  it("stays waiting when one of two is fulfilled, one is open", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "open" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });

  it("resumes when both are fulfilled", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
  });

  it("resumes when one fulfilled, one cancelled", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "cancelled", cancelled_at: "2024-01-01T00:30:00.000Z" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
  });

  it("resumes when all cancelled", async () => {
    const requests = [
      makeRequest({ id: "r1", status: "cancelled", cancelled_at: "2024-01-01T00:30:00.000Z" }),
      makeRequest({ id: "r2", status: "cancelled", cancelled_at: "2024-01-01T00:30:00.000Z" }),
    ];
    const input = makeInput({ status: "waiting_for_evidence" }, requests);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("resume");
    expect(result.reasonCode).toBe("evidence_request_cancelled");
  });
});

// ---------------------------------------------------------------------------
// Resumer — Unrelated Changes Do NOT Resume
// ---------------------------------------------------------------------------

describe("evaluateResolutionAgentResumption unrelated signals ignored", () => {
  it("stay_waiting when evidence hash changed but request is still open", async () => {
    const request = makeRequest({ status: "open", created_case_version_hash: "case_v1" });
    const input = makeInput(
      {
        status: "waiting_for_evidence",
        observation: {
          escrowState: "disputed",
          evidenceCount: 5,
          evidenceVersionHash: "ev_changed",
          caseVersionHash: "case_changed",
          unresolvedGaps: [],
          hasMeaningfulChange: true,
          observedAt: 2_000_000,
        },
      },
      [request],
    );
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });

  it("stay_waiting with different updatedAt does not resume", async () => {
    const request = makeRequest({ status: "open" });
    const input = makeInput(
      { status: "waiting_for_evidence", updatedAt: 9_999_999 },
      [request],
    );
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });

  it("does not resume for active agents even with changes", async () => {
    const request = makeRequest({ status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" });
    const input = makeInput({ status: "active" }, [request]);
    const result = evaluateResolutionAgentResumption(input);
    expect(result.kind).toBe("stay_waiting");
  });
});

// ---------------------------------------------------------------------------
// Resumer — Idempotency
// ---------------------------------------------------------------------------

describe("evaluateResolutionAgentResumption idempotency", () => {
  it("yields same result on repeated calls with same input", async () => {
    const request = makeRequest({ status: "fulfilled", fulfilled_at: "2024-01-01T00:30:00.000Z" });
    const input = makeInput({ status: "waiting_for_evidence" }, [request]);

    const result1 = evaluateResolutionAgentResumption(input);
    const result2 = evaluateResolutionAgentResumption(input);
    expect(result1.kind).toBe(result2.kind);
    expect(result1.reasonCode).toBe(result2.reasonCode);
  });
});
