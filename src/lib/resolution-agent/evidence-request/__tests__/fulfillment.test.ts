import { describe, it, expect, vi } from "vitest";
import { fulfillEvidenceRequest } from "../fulfillment";
import type { EvidenceRequestRow } from "../../store/types";
import type { FulfillmentStore } from "../types";

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
    created_at: "2024-01-01T00:00:00.000Z",
    fulfilled_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function makeMockStore(
  requests: EvidenceRequestRow[],
  overrides: Partial<FulfillmentStore> = {},
): FulfillmentStore {
  return {
    listEvidenceRequests: vi.fn().mockResolvedValue(requests),
    updateEvidenceRequest: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fulfillment Authorization
// ---------------------------------------------------------------------------

describe("fulfillEvidenceRequest authorization", () => {
  it("fulfills an open request for matching responsible party (worker)", async () => {
    const request = makeRequest({ responsible_party: "worker", status: "open" });
    const store = makeMockStore([request]);
    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "worker",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
    expect(result.fulfilled_at).toBeDefined();
    expect(result.fulfilled_case_version_hash).toBe("case_v2");
  });

  it("fulfills an open request for matching responsible party (client)", async () => {
    const request = makeRequest({ responsible_party: "client", status: "open" });
    const store = makeMockStore([request]);
    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "client",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
  });

  it("rejects client fulfilling a worker-assigned request", async () => {
    const request = makeRequest({ responsible_party: "worker", status: "open" });
    const store = makeMockStore([request]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "client",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/responsible party/i);
  });

  it("rejects worker fulfilling a client-assigned request", async () => {
    const request = makeRequest({ responsible_party: "client", status: "open" });
    const store = makeMockStore([request]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "worker",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/responsible party/i);
  });

  it("rejects request from another agent", async () => {
    const request = makeRequest({ agent_id: "agt_other", status: "open" });
    const store = makeMockStore([request]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "client",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/does not belong to agent/);
  });

  it("rejects non-existent request", async () => {
    const store = makeMockStore([]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: "nonexistent",
        fulfilledBy: "client",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Fulfillment Ordering
// ---------------------------------------------------------------------------

describe("fulfillEvidenceRequest ordering", () => {
  it("sets fulfilledAt and fulfilledCaseVersionHash after persistence", async () => {
    const request = makeRequest({ status: "open" });
    const callOrder: string[] = [];
    const store = makeMockStore([request], {
      updateEvidenceRequest: vi.fn().mockImplementation(() => {
        callOrder.push("updateEvidenceRequest");
        return Promise.resolve();
      }),
    });

    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "client",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
    expect(store.updateEvidenceRequest).toHaveBeenCalledWith(
      "agt_test_1",
      request.id,
      expect.objectContaining({
        status: "fulfilled",
        fulfilled_case_version_hash: "case_v2",
        fulfilled_at: expect.any(String),
      }),
    );
  });

  it("appends evidence_request_fulfilled event after fulfillment", async () => {
    const request = makeRequest({ status: "open" });
    const store = makeMockStore([request]);
    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "client",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
    expect(store.appendEvent).toHaveBeenCalledWith(
      "agt_test_1",
      "evidence_request_fulfilled",
      expect.any(String),
      null,
      null,
      expect.objectContaining({
        evidenceRequestId: request.id,
        responsibleParty: request.responsible_party,
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Fulfillment Idempotency
// ---------------------------------------------------------------------------

describe("fulfillEvidenceRequest idempotency", () => {
  it("returns safely for an already fulfilled request", async () => {
    const request = makeRequest({
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:00:00.000Z",
      fulfilled_case_version_hash: "case_v1",
    });
    const store = makeMockStore([request]);
    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "client",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
    expect(result.fulfilled_at).toBe("2024-01-01T00:00:00.000Z");
    expect(store.updateEvidenceRequest).not.toHaveBeenCalled();
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("does not append duplicate fulfillment event", async () => {
    const request = makeRequest({
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:00:00.000Z",
    });
    const store = makeMockStore([request]);
    await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "client",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects fulfilment of a cancelled request", async () => {
    const request = makeRequest({ status: "cancelled", cancelled_at: "2024-01-01T00:00:00.000Z" });
    const store = makeMockStore([request]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "client",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("fulfillEvidenceRequest edge cases", () => {
  it("works with fulfilledBy matching responsible_party (worker)", async () => {
    const request = makeRequest({ responsible_party: "worker", status: "open" });
    const store = makeMockStore([request]);
    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: "worker",
      caseVersionHash: "case_v2",
      evidenceVersionHash: "ev_v2",
      now: 2_000_000,
      store,
    });
    expect(result.status).toBe("fulfilled");
  });

  it("rejects fulfillment without a valid responsible party match", async () => {
    const request = makeRequest({ responsible_party: "worker", status: "open" });
    const store = makeMockStore([request]);
    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "client",
        caseVersionHash: "case_v2",
        evidenceVersionHash: "ev_v2",
        now: 2_000_000,
        store,
      }),
    ).rejects.toThrow(/responsible party/i);
  });
});
