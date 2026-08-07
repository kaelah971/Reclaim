import { describe, it, expect, vi } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  fulfillEvidenceRequest,
  buildEvidencePreimage,
  preimageContainsRequestId,
} from "../fulfillment";
import { reconcileEvidenceRequestOnChain } from "../reconciliation";
import type { EvidenceRequestRow } from "../../store/types";
import type { FulfillmentStore } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function validPreimage(requestId: string): string {
  return buildEvidencePreimage(requestId, "proof of delivery evidence");
}

function validEvidenceRef(preimage: string): string {
  return keccak256(stringToHex(preimage));
}

// ---------------------------------------------------------------------------
// Fulfillment with proof
// ---------------------------------------------------------------------------

describe("fulfillEvidenceRequest with proof", () => {
  const now = 2_000_000;
  const caseHash = "case_v2";
  const evHash = "ev_v2";

  it("fulfills when all proof validates", async () => {
    const request = makeRequest({ status: "open" });
    const preimage = validPreimage(request.id);
    const evRef = validEvidenceRef(preimage);
    const store = makeMockStore([request]);

    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: request.responsible_party as "client",
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      evidenceReference: evRef,
      preimage,
      now,
      store,
    });

    expect(result.status).toBe("fulfilled");
    expect(store.updateEvidenceRequest).toHaveBeenCalledWith(
      "agt_test_1",
      request.id,
      expect.objectContaining({
        status: "fulfilled",
        fulfillment_evidence_reference: evRef.toLowerCase(),
        evidence_preimage: preimage,
      }),
    );
    expect(store.appendEvent).toHaveBeenCalled();
  });

  it("rejects fulfillment with invalid evidenceReference (wrong hash)", async () => {
    const request = makeRequest({ status: "open" });
    const preimage = validPreimage(request.id);
    const wrongRef = "0x" + "aa".repeat(32);
    const store = makeMockStore([request]);

    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: request.responsible_party as "client",
        caseVersionHash: caseHash,
        evidenceVersionHash: evHash,
        evidenceReference: wrongRef,
        preimage,
        now,
        store,
      }),
    ).rejects.toThrow(/Preimage does not hash/);
  });

  it("rejects fulfillment with preimage missing the request ID", async () => {
    const request = makeRequest({ status: "open", id: "evreq_xyz" });
    const badPreimage = "reclaim-evidence-request:evreq_abc:some evidence";
    const evRef = keccak256(stringToHex(badPreimage));
    const store = makeMockStore([request]);

    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: request.responsible_party as "client",
        caseVersionHash: caseHash,
        evidenceVersionHash: evHash,
        evidenceReference: evRef,
        preimage: badPreimage,
        now,
        store,
      }),
    ).rejects.toThrow(/does not reference the request ID/);
  });

  it("rejects zero hash as evidenceReference", async () => {
    const request = makeRequest({ status: "open" });
    const preimage = validPreimage(request.id);
    const store = makeMockStore([request]);

    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: request.responsible_party as "client",
        caseVersionHash: caseHash,
        evidenceVersionHash: evHash,
        evidenceReference: "0x0000000000000000000000000000000000000000000000000000000000000000",
        preimage,
        now,
        store,
      }),
    ).rejects.toThrow(/must not be the zero hash/);
  });

  it("rejects malformed hex as evidenceReference", async () => {
    const request = makeRequest({ status: "open" });
    const preimage = validPreimage(request.id);
    const store = makeMockStore([request]);

    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: request.responsible_party as "client",
        caseVersionHash: caseHash,
        evidenceVersionHash: evHash,
        evidenceReference: "not-a-hash",
        preimage,
        now,
        store,
      }),
    ).rejects.toThrow(/Invalid evidenceReference/);
  });

  it("still enforces responsible party authorization", async () => {
    const request = makeRequest({ status: "open", responsible_party: "worker" });
    const preimage = validPreimage(request.id);
    const evRef = validEvidenceRef(preimage);
    const store = makeMockStore([request]);

    await expect(
      fulfillEvidenceRequest({
        agentId: "agt_test_1",
        requestId: request.id,
        fulfilledBy: "client",
        caseVersionHash: caseHash,
        evidenceVersionHash: evHash,
        evidenceReference: evRef,
        preimage,
        now,
        store,
      }),
    ).rejects.toThrow(/responsible party/);
  });

  it("is idempotent for already-fulfilled requests", async () => {
    const preimage = validPreimage("evreq_test_1");
    const evRef = validEvidenceRef(preimage);
    const request = makeRequest({
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:00:00.000Z",
      fulfillment_evidence_reference: evRef.toLowerCase(),
      evidence_preimage: preimage,
    });
    const store = makeMockStore([request]);

    const result = await fulfillEvidenceRequest({
      agentId: "agt_test_1",
      requestId: request.id,
      fulfilledBy: request.responsible_party as "client",
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      evidenceReference: evRef,
      preimage,
      now,
      store,
    });

    expect(result.status).toBe("fulfilled");
    expect(store.updateEvidenceRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Preimage helpers
// ---------------------------------------------------------------------------

describe("buildEvidencePreimage", () => {
  it("includes the request ID in the preimage", () => {
    const preimage = buildEvidencePreimage("evreq_123", "delivery proof");
    expect(preimage).toContain("reclaim-evidence-request:");
    expect(preimage).toContain("evreq_123");
    expect(preimage).toContain("delivery proof");
  });

  it("is deterministic", () => {
    const a = buildEvidencePreimage("id1", "manifest");
    const b = buildEvidencePreimage("id1", "manifest");
    expect(keccak256(stringToHex(a))).toBe(keccak256(stringToHex(b)));
  });

  it("produces different hashes for different request IDs with same manifest", () => {
    const h1 = keccak256(stringToHex(buildEvidencePreimage("id_a", "same manifest")));
    const h2 = keccak256(stringToHex(buildEvidencePreimage("id_b", "same manifest")));
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for same request ID with different manifests", () => {
    const h1 = keccak256(stringToHex(buildEvidencePreimage("id_a", "manifest 1")));
    const h2 = keccak256(stringToHex(buildEvidencePreimage("id_a", "manifest 2")));
    expect(h1).not.toBe(h2);
  });
});

describe("preimageContainsRequestId", () => {
  it("returns true for preimages containing the ID", () => {
    const preimage = buildEvidencePreimage("evreq_abc", "data");
    expect(preimageContainsRequestId(preimage, "evreq_abc")).toBe(true);
  });

  it("returns false for preimages not containing the ID", () => {
    const preimage = buildEvidencePreimage("evreq_abc", "data");
    expect(preimageContainsRequestId(preimage, "evreq_xyz")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation — crash recovery
// ---------------------------------------------------------------------------

describe("reconcileEvidenceRequestOnChain", () => {
  const caseHash = "case_v2";
  const evHash = "ev_v2";
  const now = 2_000_000;

  it("reconciles a single open request with matching preimage", async () => {
    const preimage = buildEvidencePreimage("evreq_1", "proof");
    const evRef = validEvidenceRef(preimage);
    const request = makeRequest({
      id: "evreq_1",
      status: "open",
      evidence_preimage: preimage,
    });
    const store = makeMockStore([request]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: evRef,
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });

    expect(result.kind).toBe("reconciled");
    expect((result as { requestId: string }).requestId).toBe("evreq_1");
  });

  it("returns already_fulfilled when already done", async () => {
    const preimage = buildEvidencePreimage("evreq_1", "proof");
    const evRef = validEvidenceRef(preimage);
    const request = makeRequest({
      id: "evreq_1",
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:00:00.000Z",
      fulfillment_evidence_reference: evRef.toLowerCase(),
      evidence_preimage: preimage,
    });
    const store = makeMockStore([request]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: evRef,
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });

    expect(result.kind).toBe("already_fulfilled");
  });

  it("returns no_match when no preimage matches on-chain hash", async () => {
    const preimage = buildEvidencePreimage("evreq_1", "proof");
    const request = makeRequest({
      id: "evreq_1",
      status: "open",
      evidence_preimage: preimage,
    });
    const store = makeMockStore([request]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: "0x" + "bb".repeat(32),
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });

    expect(result.kind).toBe("no_match");
  });

  it("returns no_match for zero evidenceReference", async () => {
    const store = makeMockStore([]);
    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: "0x0000000000000000000000000000000000000000000000000000000000000000",
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });
    expect(result.kind).toBe("no_match");
  });

  it("returns no_match when no open requests have preimages", async () => {
    const request = makeRequest({ id: "evreq_1", status: "open", evidence_preimage: null });
    const store = makeMockStore([request]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: "0x" + "cc".repeat(32),
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });
    expect(result.kind).toBe("no_match");
  });

  it("correctly matches request A but not B with two open requests", async () => {
    const preimageA = buildEvidencePreimage("evreq_a", "proof A");
    const evRefA = validEvidenceRef(preimageA);
    const preimageB = buildEvidencePreimage("evreq_b", "proof B");

    const requestA = makeRequest({ id: "evreq_a", status: "open", evidence_preimage: preimageA });
    const requestB = makeRequest({ id: "evreq_b", status: "open", evidence_preimage: preimageB });
    const store = makeMockStore([requestA, requestB]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: evRefA,
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });

    expect(result.kind).toBe("reconciled");
    expect((result as { requestId: string }).requestId).toBe("evreq_a");
  });

  it("reconciliation is idempotent (second call sees already-fulfilled)", async () => {
    const preimage = buildEvidencePreimage("evreq_1", "proof");
    const evRef = validEvidenceRef(preimage);
    const request = makeRequest({
      id: "evreq_1",
      status: "open",
      evidence_preimage: preimage,
    });
    const store = makeMockStore([request]);

    // First call — reconciles
    const r1 = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: evRef,
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });
    expect(r1.kind).toBe("reconciled");

    // Update mock: request is now fulfilled
    const fulfilledRequest = {
      ...request,
      status: "fulfilled",
      fulfilled_at: "2024-01-01T00:30:00.000Z",
      fulfillment_evidence_reference: evRef.toLowerCase(),
    };
    store.listEvidenceRequests = vi.fn().mockResolvedValue([fulfilledRequest]);

    // Second call — sees already fulfilled
    const r2 = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: evRef,
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });
    expect(r2.kind).toBe("already_fulfilled");
  });

  it("hash change alone does NOT trigger reconciliation (no preimage match)", async () => {
    // Open request WITHOUT a preimage
    const request = makeRequest({ id: "evreq_1", status: "open", evidence_preimage: null });
    const store = makeMockStore([request]);

    const result = await reconcileEvidenceRequestOnChain({
      agentId: "agt_test_1",
      evidenceReference: "0x" + "dd".repeat(32),
      caseVersionHash: caseHash,
      evidenceVersionHash: evHash,
      now,
      store,
    });
    expect(result.kind).toBe("no_match");
    expect(store.updateEvidenceRequest).not.toHaveBeenCalled();
  });
});
