// ---------------------------------------------------------------------------
// Dispute Brief Input Builder — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildDisputeBriefInput,
  computeDisputeBriefInputHash,
} from "../dispute-brief-input";
import type {
  AgentCaseIdentity,
  ResolutionAgentObservation,
} from "../../types";
import type { NormalizedToolOutcome } from "../../planner/types";

// ---------------------------------------------------------------------------
// Fixtures
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

function makeQualityCheckOutcome(): NormalizedToolOutcome {
  return {
    kind: "evidence_quality",
    outcome: {
      evidenceVersionHash: "ev_hash_v1",
      readiness: "ready",
      missingEvidence: [],
      ambiguities: [],
      recommendedImprovements: [],
      reviewerQuestions: [],
      executionStatus: "settled",
    },
  };
}

function makeCaseRefreshOutcome(): NormalizedToolOutcome {
  return {
    kind: "case_refresh",
    outcome: {
      caseVersionHash: "case_hash_v1",
      readiness: "ready",
      unresolvedEvidenceGaps: [],
      newQuestions: [],
      executionStatus: "settled",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dispute Brief Input Builder", () => {
  it("builds input from observation with required fields", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const result = buildDisputeBriefInput(identity, observation, null, null);

    expect(result.escrowPaymentId).toBe("pay_test_001");
    expect(result.escrowChainId).toBe("eip155:42220");
    expect(result.escrowContractAddress).toBe("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(result.agreementLabel).toBeDefined();
    expect(result.deliverableSummary).toBeDefined();
    expect(result.deliveryFormat).toBe("digital");
    expect(result.releaseRule).toBe("standard");
    expect(result.evidenceExpectation).toBe("Relevant evidence for dispute resolution");
    expect(result.escrowState).toBe("disputed");
    expect(result.caseVersionHash).toBe("case_hash_v1");
    expect(result.evidenceVersionHash).toBe("ev_hash_v1");
    expect(result.evidenceCount).toBe(3);
    expect(result.hasMeaningfulChange).toBe(true);
    expect(Array.isArray(result.openEvidenceRequests)).toBe(true);
    expect(Array.isArray(result.fulfilledEvidenceRequests)).toBe(true);
  });

  it("reflects escrow state in input", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ escrowState: "funded" });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.escrowState).toBe("funded");
    expect(result.agreementLabel).toContain("funded");
  });

  it("handles evidence count correctly", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ evidenceCount: 10 });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.evidenceCount).toBe(10);
    expect(result.evidenceAvailability).toBe("metadata_available");
    expect(result.hasEvidenceMetadata).toBe(true);
  });

  it("handles zero evidence", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ evidenceCount: 0 });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.evidenceCount).toBe(0);
    expect(result.evidenceAvailability).toBe("none");
    expect(result.hasEvidenceMetadata).toBe(false);
  });

  it("handles unresolved gaps", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({
      unresolvedGaps: [
        { id: "gap1", description: "Missing screenshot", responsibleParty: "client", status: "open", createdAt: Date.now(), caseChangedAfterFulfillment: false },
        { id: "gap2", description: "Need receipt", responsibleParty: "worker", status: "open", createdAt: Date.now(), caseChangedAfterFulfillment: false },
      ],
    });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.openEvidenceRequests.length).toBe(2);
    expect(result.unresolvedGapsCount).toBe(2);
    expect(result.openEvidenceRequests[0].item).toBe("Missing screenshot");
    expect(result.openEvidenceRequests[0].party).toBe("client");
    expect(result.openEvidenceRequests[0].status).toBe("open");
  });

  it("separates open from fulfilled gaps", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({
      unresolvedGaps: [
        { id: "gap1", description: "Missing screenshot", responsibleParty: "client", status: "open", createdAt: Date.now(), caseChangedAfterFulfillment: false },
        { id: "gap2", description: "Need receipt", responsibleParty: "worker", status: "fulfilled", createdAt: Date.now() - 1000, fulfilledAt: Date.now(), caseChangedAfterFulfillment: false },
      ],
    });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.openEvidenceRequests.length).toBe(1);
    expect(result.fulfilledEvidenceRequests.length).toBe(1);
    expect(result.fulfilledEvidenceRequests[0].item).toBe("Need receipt");
  });

  it("passes through latest quality check outcome", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const qualityCheck = makeQualityCheckOutcome();
    const result = buildDisputeBriefInput(identity, observation, qualityCheck, null);
    expect(result.latestQualityCheck).not.toBeNull();
    expect(result.latestQualityCheck?.kind).toBe("evidence_quality");
  });

  it("passes through latest case refresh outcome", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const caseRefresh = makeCaseRefreshOutcome();
    const result = buildDisputeBriefInput(identity, observation, null, caseRefresh);
    expect(result.latestCaseRefresh).not.toBeNull();
    expect(result.latestCaseRefresh?.kind).toBe("case_refresh");
  });

  it("includes both quality check and case refresh", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const qualityCheck = makeQualityCheckOutcome();
    const caseRefresh = makeCaseRefreshOutcome();
    const result = buildDisputeBriefInput(identity, observation, qualityCheck, caseRefresh);
    expect(result.latestQualityCheck).not.toBeNull();
    expect(result.latestCaseRefresh).not.toBeNull();
  });

  it("defaults escrowState to unknown when empty", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ escrowState: "" });
    const result = buildDisputeBriefInput(identity, observation, null, null);
    expect(result.escrowState).toBe("unknown");
  });

  // ---------------------------------------------------------------------------
  // Input Hash Tests
  // ---------------------------------------------------------------------------

  it("computeDisputeBriefInputHash produces a keccak256 hash", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const input = buildDisputeBriefInput(identity, observation, null, null);
    const hash = computeDisputeBriefInputHash(input);

    expect(hash).toBeDefined();
    expect(hash.startsWith("0x")).toBe(true);
    expect(hash.length).toBe(66); // 0x + 64 hex chars
  });

  it("computeDisputeBriefInputHash is deterministic", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const input1 = buildDisputeBriefInput(identity, observation, null, null);
    const input2 = buildDisputeBriefInput(identity, observation, null, null);

    const hash1 = computeDisputeBriefInputHash(input1);
    const hash2 = computeDisputeBriefInputHash(input2);

    expect(hash1).toBe(hash2);
  });

  it("computeDisputeBriefInputHash changes when observation changes", () => {
    const identity = makeCaseIdentity();
    const obs1 = makeObservation({ evidenceCount: 3 });
    const obs2 = makeObservation({ evidenceCount: 5 });

    const input1 = buildDisputeBriefInput(identity, obs1, null, null);
    const input2 = buildDisputeBriefInput(identity, obs2, null, null);

    const hash1 = computeDisputeBriefInputHash(input1);
    const hash2 = computeDisputeBriefInputHash(input2);

    expect(hash1).not.toBe(hash2);
  });
});
