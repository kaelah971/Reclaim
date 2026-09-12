// ---------------------------------------------------------------------------
// Observation types — compile-time and runtime type tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  OBSERVATION_SCHEMA_VERSION,
  OBSERVABLE_AGENT_STATUSES,
  NON_OBSERVABLE_AGENT_STATUSES,
  ESCROW_STATE_MAP,
} from "../types";
import type {
  EscrowState,
  EscrowObservation,
  EvidenceObservation,
  EvidenceAvailability,
  ToolResultObservation,
  EvidenceRequestObservation,
  PriorAgentContext,
  CaseObservation,
  CaseChangeSummary,
  ChangeReasonCode,
  CaseObservationResult,
} from "../types";

describe("OBSERVATION_SCHEMA_VERSION", () => {
  it("is a non-empty string", () => {
    expect(OBSERVATION_SCHEMA_VERSION).toBeTypeOf("string");
    expect(OBSERVATION_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("contains expected substrings for versioning", () => {
    expect(OBSERVATION_SCHEMA_VERSION).toContain("reclaim");
    expect(OBSERVATION_SCHEMA_VERSION).toContain("observation");
    expect(OBSERVATION_SCHEMA_VERSION).toContain("v1");
  });
});

describe("OBSERVABLE_AGENT_STATUSES", () => {
  it("includes the expected observable states", () => {
    expect(OBSERVABLE_AGENT_STATUSES).toContain("awaiting_funding");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("awaiting_activation");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("active");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("waiting_for_evidence");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("waiting_for_human_approval");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("ready_for_human_review");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("paused");
    expect(OBSERVABLE_AGENT_STATUSES).toContain("failed_recoverable");
  });

  it("does NOT include closed", () => {
    expect(OBSERVABLE_AGENT_STATUSES).not.toContain("closed");
  });

  it("does NOT include closing", () => {
    expect(OBSERVABLE_AGENT_STATUSES).not.toContain("closing");
  });
});

describe("NON_OBSERVABLE_AGENT_STATUSES", () => {
  it("includes closed", () => {
    expect(NON_OBSERVABLE_AGENT_STATUSES).toContain("closed");
  });

  it("includes closing", () => {
    expect(NON_OBSERVABLE_AGENT_STATUSES).toContain("closing");
  });
});

describe("ESCROW_STATE_MAP", () => {
  it("maps uint8 value 0 to 'created'", () => {
    expect(ESCROW_STATE_MAP[0]).toBe("created");
  });

  it("maps uint8 value 1 to 'funded'", () => {
    expect(ESCROW_STATE_MAP[1]).toBe("funded");
  });

  it("maps uint8 value 5 to 'released'", () => {
    expect(ESCROW_STATE_MAP[5]).toBe("released");
  });

  it("maps uint8 value 8 to 'resolved'", () => {
    expect(ESCROW_STATE_MAP[8]).toBe("resolved");
  });

  it("has exactly 9 entries (0-8)", () => {
    expect(Object.keys(ESCROW_STATE_MAP).length).toBe(9);
  });

  it("all values are unique non-empty strings", () => {
    const values = Object.values(ESCROW_STATE_MAP);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeTypeOf("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe("EvidenceObservation type structural test", () => {
  it("accepts a valid EvidenceObservation value", () => {
    const obs: EvidenceObservation = {
      evidenceReference: "0xabc1230000000000000000000000000000000000000000000000000000000000",
      title: "Delivery Screenshots",
      evidenceType: "image/png",
      description: "Screenshots of the delivered work",
      relatedDeliverable: "QmHash123",
      externalReference: "https://example.com/evidence/123",
      fileCount: 3,
      latestUpdateTimestamp: 1716800000000,
      availability: "package_available",
      substantiveEvidence: true,
    };
    expect(obs.availability).toBe("package_available");
    expect(obs.fileCount).toBe(3);
  });

  it("accepts null fields", () => {
    const obs: EvidenceObservation = {
      evidenceReference: null,
      title: null,
      evidenceType: null,
      description: null,
      relatedDeliverable: null,
      externalReference: null,
      fileCount: 0,
      latestUpdateTimestamp: null,
      availability: "none",
      substantiveEvidence: false,
    };
    expect(obs.availability).toBe("none");
    expect(obs.evidenceReference).toBeNull();
  });
});

describe("CaseObservationResult structural test", () => {
  it("accepts a valid result", () => {
    const result: CaseObservationResult = {
      agentId: "agt_test123",
      observation: {
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
      substantiveEvidence: false,
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
      },
      evidenceVersionHash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
      caseVersionHash: "0xdef0000000000000000000000000000000000000000000000000000000000002",
      changeSummary: {
        caseChanged: true,
        evidenceChanged: true,
        firstObservation: true,
        changeType: "first_observation",
        reason: "First observation of this case.",
      },
      persisted: true,
    };
    expect(result.persisted).toBe(true);
    expect(result.changeSummary.firstObservation).toBe(true);
  });
});
