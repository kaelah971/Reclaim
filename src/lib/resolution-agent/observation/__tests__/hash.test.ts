// ---------------------------------------------------------------------------
// Hash computation — comprehensive test suite
// Tests: evidenceVersionHash, caseVersionHash, compareCaseObservation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  computeEvidenceVersionHash,
  computeCaseVersionHash,
  compareCaseObservation,
} from "../hash";
import type {
  CaseObservation,
} from "../types";
import { OBSERVATION_SCHEMA_VERSION } from "../types";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeMinimalCaseObservation(
  overrides?: Partial<CaseObservation>,
): CaseObservation {
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    caseIdentity: {
      escrowChainId: "11142220",
      escrowContractAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
      escrowPaymentId: "42",
    },
    escrow: {
      paymentId: "42",
      client: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      worker: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      token: "0xcccccccccccccccccccccccccccccccccccccccc",
      amount: "1000000",
      agreementLabel: "0x0000000000000000000000000000000000000000000000000000000000000001",
      deliverableSummary: "0x0000000000000000000000000000000000000000000000000000000000000002",
      deliveryFormat: "0x0000000000000000000000000000000000000000000000000000000000000003",
      releaseRule: "0x0000000000000000000000000000000000000000000000000000000000000004",
      evidenceExpectation: "0x0000000000000000000000000000000000000000000000000000000000000005",
      termsHash: "0x0000000000000000000000000000000000000000000000000000000000000006",
      evidenceReference: "0x0000000000000000000000000000000000000000000000000000000000000007",
      disputeReference: "0x0000000000000000000000000000000000000000000000000000000000000008",
      deliveryDeadline: 1717000000,
      autoReleaseSeconds: 86400,
      disputeWindowSeconds: 604800,
      state: "funded",
      createdAt: 1716800000,
      fundedAt: 1716810000,
      acceptedAt: 0,
      deliveryAt: 0,
      releaseRequestedAt: 0,
      releasedAt: 0,
    },
    evidence: {
      evidenceReference: null,
      title: null,
      evidenceType: null,
      description: null,
      relatedDeliverable: null,
      externalReference: null,
      fileCount: 0,
      latestUpdateTimestamp: null,
      availability: "none",
    },
    priorContext: {
      agentStatus: "active",
      openEvidenceRequests: [],
      fulfilledEvidenceRequests: [],
      settledToolResults: [],
      previousCaseVersionHash: null,
      previousEvidenceVersionHash: null,
    },
    observedAt: 1716900000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeEvidenceVersionHash
// ---------------------------------------------------------------------------

describe("computeEvidenceVersionHash", () => {
  it("returns a 0x-prefixed 66-character hex string", () => {
    const obs = makeMinimalCaseObservation();
    const hash = computeEvidenceVersionHash(obs);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces same hash for identical observations", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation();
    expect(computeEvidenceVersionHash(obs1)).toBe(computeEvidenceVersionHash(obs2));
  });

  it("produces different hash when evidenceReference changes", () => {
    const obs1 = makeMinimalCaseObservation({
      evidence: {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        availability: "none" as const,
      },
    });
    const obs2 = makeMinimalCaseObservation({
      evidence: {
        evidenceReference: "0xdead000000000000000000000000000000000000000000000000000000000001",
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        availability: "none" as const,
      },
    });
    expect(computeEvidenceVersionHash(obs1)).not.toBe(
      computeEvidenceVersionHash(obs2),
    );
  });

  it("produces different hash when evidence title changes", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      evidence: {
        evidenceReference: null,
        title: "New Title",
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        availability: "none" as const,
      },
    });
    expect(computeEvidenceVersionHash(obs1)).not.toBe(
      computeEvidenceVersionHash(obs2),
    );
  });

  it("produces different hash when fileCount changes", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      evidence: {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 5,
        latestUpdateTimestamp: null,
        availability: "none" as const,
      },
    });
    expect(computeEvidenceVersionHash(obs1)).not.toBe(
      computeEvidenceVersionHash(obs2),
    );
  });

  it("produces different hash when availability changes", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      evidence: {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        availability: "package_available" as const,
      },
    });
    expect(computeEvidenceVersionHash(obs1)).not.toBe(
      computeEvidenceVersionHash(obs2),
    );
  });

  it("is stable across multiple calls with same input", () => {
    const obs = makeMinimalCaseObservation();
    expect(computeEvidenceVersionHash(obs)).toBe(computeEvidenceVersionHash(obs));
    expect(computeEvidenceVersionHash(obs)).toBe(computeEvidenceVersionHash(obs));
  });
});

// ---------------------------------------------------------------------------
// computeCaseVersionHash
// ---------------------------------------------------------------------------

describe("computeCaseVersionHash", () => {
  it("returns a 0x-prefixed 66-character hex string", () => {
    const obs = makeMinimalCaseObservation();
    const evidenceHash = computeEvidenceVersionHash(obs);
    const caseHash = computeCaseVersionHash(obs, evidenceHash);
    expect(caseHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces same hash for identical observations and evidence hash", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation();
    const evHash = computeEvidenceVersionHash(obs1);
    expect(computeCaseVersionHash(obs1, evHash)).toBe(
      computeCaseVersionHash(obs2, evHash),
    );
  });

  it("produces different hash when escrow state changes", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      escrow: {
        ...makeMinimalCaseObservation().escrow,
        state: "delivered" as const,
      },
    });
    const evHash = computeEvidenceVersionHash(obs1);
    expect(computeCaseVersionHash(obs1, evHash)).not.toBe(
      computeCaseVersionHash(obs2, evHash),
    );
  });

  it("produces different hash when case identity changes", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      caseIdentity: {
        escrowChainId: "11142220",
        escrowContractAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        escrowPaymentId: "99",
      },
    });
    const evHash = computeEvidenceVersionHash(obs1);
    expect(computeCaseVersionHash(obs1, evHash)).not.toBe(
      computeCaseVersionHash(obs2, evHash),
    );
  });

  it("produces different hash when evidenceVersionHash changes", () => {
    const obs = makeMinimalCaseObservation();
    const evHash1 = computeEvidenceVersionHash(obs);
    const evHash2 = "0x9999999999999999999999999999999999999999999999999999999999999999";
    expect(computeCaseVersionHash(obs, evHash1)).not.toBe(
      computeCaseVersionHash(obs, evHash2),
    );
  });

  it("produces different hash when settled tool results change", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      priorContext: {
        ...makeMinimalCaseObservation().priorContext,
        settledToolResults: [
          {
            toolId: "evidence-quality-check",
            settled: true,
            resultSummary: "Evidence passed quality check",
            settledAt: "2024-05-28T00:00:00.000Z",
          },
        ],
      },
    });
    const evHash = computeEvidenceVersionHash(obs1);
    expect(computeCaseVersionHash(obs1, evHash)).not.toBe(
      computeCaseVersionHash(obs2, evHash),
    );
  });

  it("produces different hash when open evidence requests change", () => {
    const obs1 = makeMinimalCaseObservation();
    const obs2 = makeMinimalCaseObservation({
      priorContext: {
        ...makeMinimalCaseObservation().priorContext,
        openEvidenceRequests: [
          {
            id: "req_1",
            responsibleParty: "client" as const,
            evidenceItem: "signed_agreement.pdf",
            reason: "Missing signed agreement",
            status: "open" as const,
            createdAt: "2024-05-27T00:00:00.000Z",
            fulfilledAt: null,
          },
        ],
      },
    });
    const evHash = computeEvidenceVersionHash(obs1);
    expect(computeCaseVersionHash(obs1, evHash)).not.toBe(
      computeCaseVersionHash(obs2, evHash),
    );
  });

  it("is stable across multiple calls", () => {
    const obs = makeMinimalCaseObservation();
    const evHash = computeEvidenceVersionHash(obs);
    expect(computeCaseVersionHash(obs, evHash)).toBe(
      computeCaseVersionHash(obs, evHash),
    );
  });
});

// ---------------------------------------------------------------------------
// compareCaseObservation
// ---------------------------------------------------------------------------

describe("compareCaseObservation", () => {
  const makeHash = (): string =>
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const makeHashB = (): string =>
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("returns first_observation when previous hashes are null", () => {
    const result = compareCaseObservation({
      previousCaseVersionHash: null,
      previousEvidenceVersionHash: null,
      nextCaseVersionHash: makeHash(),
      nextEvidenceVersionHash: makeHash(),
    });
    expect(result.firstObservation).toBe(true);
    expect(result.changeType).toBe("first_observation");
    expect(result.caseChanged).toBe(true);
    expect(result.evidenceChanged).toBe(true);
  });

  it("returns escrow_state_changed when case hash differs but evidence same", () => {
    const evHash = makeHash();
    const result = compareCaseObservation({
      previousCaseVersionHash: makeHash(),
      previousEvidenceVersionHash: evHash,
      nextCaseVersionHash: makeHashB(),
      nextEvidenceVersionHash: evHash,
    });
    expect(result.caseChanged).toBe(true);
    expect(result.evidenceChanged).toBe(false);
    expect(result.changeType).toBe("escrow_state_changed");
  });

  it("returns evidence_added or evidence_changed when evidence hash differs", () => {
    const caseHash = makeHash();
    const result = compareCaseObservation({
      previousCaseVersionHash: caseHash,
      previousEvidenceVersionHash: null,
      nextCaseVersionHash: makeHashB(),
      nextEvidenceVersionHash: makeHashB(),
    });
    expect(result.evidenceChanged).toBe(true);
    expect(["evidence_added", "evidence_changed"]).toContain(result.changeType);
  });

  it("returns no_meaningful_change when both hashes match", () => {
    const caseHash = makeHash();
    const evHash = makeHash();
    const result = compareCaseObservation({
      previousCaseVersionHash: caseHash,
      previousEvidenceVersionHash: evHash,
      nextCaseVersionHash: caseHash,
      nextEvidenceVersionHash: evHash,
    });
    expect(result.caseChanged).toBe(false);
    expect(result.evidenceChanged).toBe(false);
    expect(result.changeType).toBe("no_meaningful_change");
    expect(result.firstObservation).toBe(false);
  });

  it("sets evidenceChanged when evidence hash differs", () => {
    const caseHash = makeHash();
    const result = compareCaseObservation({
      previousCaseVersionHash: caseHash,
      previousEvidenceVersionHash: makeHash(),
      nextCaseVersionHash: makeHashB(),
      nextEvidenceVersionHash: makeHashB(),
    });
    expect(result.evidenceChanged).toBe(true);
  });

  it("provides a human-readable reason string", () => {
    const result = compareCaseObservation({
      previousCaseVersionHash: null,
      previousEvidenceVersionHash: null,
      nextCaseVersionHash: makeHash(),
      nextEvidenceVersionHash: makeHash(),
    });
    expect(result.reason).toBeTypeOf("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("does not return duplicate change types for identical input", () => {
    const caseHash = makeHash();
    const evHash = makeHash();
    const result = compareCaseObservation({
      previousCaseVersionHash: caseHash,
      previousEvidenceVersionHash: evHash,
      nextCaseVersionHash: caseHash,
      nextEvidenceVersionHash: evHash,
    });
    expect(result.changeType).toBe("no_meaningful_change");
  });
});
