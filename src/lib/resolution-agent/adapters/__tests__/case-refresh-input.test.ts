// ---------------------------------------------------------------------------
// Case Refresh Adapter Input Builder — Test Suite (TDD)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildCaseRefreshInput,
} from "../case-refresh-input";
import type {
  AgentCaseIdentity,
  ResolutionAgentObservation,
} from "../../types";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Case Refresh Input Builder", () => {
  it("builds input from observation with required fields", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const result = buildCaseRefreshInput(identity, observation);

    expect(result.escrowPaymentId).toBe("pay_test_001");
    expect(result.agreementLabel).toBe("Case observation");
    expect(result.deliverableSummary).toBeDefined();
    expect(result.deliveryFormat).toBe("digital");
    expect(result.releaseRule).toBe("standard");
    expect(result.evidenceExpectation).toBe("Relevant evidence for dispute resolution");
    expect(result.escrowState).toBe("disputed");
    expect(result.caseVersionHash).toBe("case_hash_v1");
    expect(result.evidenceVersionHash).toBe("ev_hash_v1");
    expect(result.evidenceCount).toBe(3);
    expect(Array.isArray(result.openEvidenceRequests)).toBe(true);
    expect(Array.isArray(result.fulfilledEvidenceRequests)).toBe(true);
  });

  it("reflects escrow state in evidence availability", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ evidenceCount: 0 });
    const result = buildCaseRefreshInput(identity, observation);
    expect(result.evidenceAvailability).toBeDefined();
    expect(result.evidenceCount).toBe(0);
  });

  it("handles evidence count correctly", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({ evidenceCount: 10 });
    const result = buildCaseRefreshInput(identity, observation);
    expect(result.evidenceCount).toBe(10);
    expect(result.evidenceAvailability).toBe("metadata_available");
  });

  it("handles unresolved gaps", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation({
      unresolvedGaps: [
        { id: "gap1", description: "Missing screenshot", responsibleParty: "client", status: "open", createdAt: Date.now(), caseChangedAfterFulfillment: false },
        { id: "gap2", description: "Need receipt", responsibleParty: "worker", status: "open", createdAt: Date.now(), caseChangedAfterFulfillment: false },
      ],
    });
    const result = buildCaseRefreshInput(identity, observation);
    expect(result.openEvidenceRequests.length).toBe(2);
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
    const result = buildCaseRefreshInput(identity, observation);
    expect(result.openEvidenceRequests.length).toBe(1);
    expect(result.fulfilledEvidenceRequests.length).toBe(1);
    expect(result.fulfilledEvidenceRequests[0].item).toBe("Need receipt");
  });

  it("sets evidence reference to null when not available", () => {
    const identity = makeCaseIdentity();
    const observation = makeObservation();
    const result = buildCaseRefreshInput(identity, observation);
    expect(result.evidenceReference).toBeNull();
  });

  it("includes escrow chain and contract info", () => {
    const identity = makeCaseIdentity({
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
    const observation = makeObservation();
    const result = buildCaseRefreshInput(identity, observation);

    // These fields are now set as top-level optional fields
    expect(result.escrowChainId).toBe("eip155:42220");
    expect(result.escrowContractAddress).toBe("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });
});
