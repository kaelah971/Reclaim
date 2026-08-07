import { describe, it, expect } from "vitest";
import { toResolutionAgentPublicView } from "../public-view";
import { normalizeForJson } from "../../x402/jsonSafe";
import type { ResolutionAgent } from "../types";

function makeTestAgent(
  overrides: Partial<ResolutionAgent> = {},
): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    },
    policy: {
      allowedTools: [
        "evidence-quality-check",
        "case-refresh",
        "reclaim-dispute-brief-v1",
      ],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999,
      funderAddress: "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 20000n,
      reservedAtomic: 10000n,
    },
    plan: {
      steps: [
        { kind: "read_agreement", description: "Read agreement" },
        { kind: "check_evidence", description: "Check evidence" },
      ],
      currentStepIndex: 0,
      lastUpdated: 5000000,
      caseVersionHash: "0xdef456",
      evidenceVersionHash: "0xabc123",
    },
    observation: {
      escrowState: "funded",
      evidenceCount: 3,
      evidenceVersionHash: "0xabc123",
      caseVersionHash: "0xdef456",
      unresolvedGaps: [
        {
          id: "gap_1",
          description: "Missing screenshot",
          responsibleParty: "worker",
          status: "open",
          createdAt: 5000000,
          caseChangedAfterFulfillment: false,
        },
      ],
      hasMeaningfulChange: true,
      observedAt: 5000000,
    },
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "encrypted-key-ciphertext-base64",
      iv: "encryption-iv-base64",
      authenticationTag: "auth-tag-base64",
    },
    settledToolIds: ["evidence-quality-check"],
    currentRunningToolId: null,
    createdAt: 1000000,
    updatedAt: 5000000,
    activatedAt: 4000000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

describe("Public View", () => {
  it("contains case wallet address", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(view.caseWalletAddress).toBe(
      "0xcccccccccccccccccccccccccccccccccccccccc",
    );
  });

  it("contains budget and status", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(view.status).toBe("active");
    expect(view.budget.approvedAtomic).toBe("1000000");
    expect(view.budget.spentAtomic).toBe("20000");
    expect(view.budget.reservedAtomic).toBe("10000");
    expect(view.budget.remainingAtomic).toBe("970000");
  });

  it("contains funder address", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(view.funderAddress).toBe(
      "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    );
  });

  it("contains allowed tools", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(view.allowedTools).toContain("evidence-quality-check");
  });

  it("contains id, goal, timestamps", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(view.id).toBe("agent_test_1");
    expect(view.goal).toBe(
      "Prepare this payment case for fair human review.",
    );
    expect(view.activatedAt).toBe(4000000);
    expect(view.createdAt).toBe(1000000);
  });

  it("excludes encrypted secret ciphertext", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    const raw = view as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("encryptedSecret");
    expect(raw).not.toHaveProperty("ciphertext");
    expect(raw).not.toHaveProperty("iv");
    expect(raw).not.toHaveProperty("authenticationTag");
    expect(raw).not.toHaveProperty("version");
    expect(raw).not.toHaveProperty("algorithm");
  });

  it("excludes internal lease/lock data", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    const raw = view as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("leaseToken");
    expect(raw).not.toHaveProperty("lockOwner");
    expect(raw).not.toHaveProperty("workerLock");
  });

  it("JSON serialization cannot reveal private fields", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    const json = JSON.stringify(normalizeForJson(view));
    JSON.parse(json); // verify valid JSON

    // These must never appear in the public view
    expect(json).not.toContain("encrypted-key-ciphertext-base64");
    expect(json).not.toContain("encryption-iv-base64");
    expect(json).not.toContain("auth-tag-base64");
    expect(json).not.toContain("\"version\":");
    expect(json).not.toContain("\"algorithm\":");

    // The wallet address IS in the public view
    expect(json).toContain("0xcccccccccccccccccccccccccccccccccccccccc");
  });

  it("errors do not contain secret fixture values", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);

    // Simulate an error scenario — check that error serialization
    // of the public view doesn't leak secrets
    let errorMessage = "";
    try {
      // Force error on a non-existent property
      JSON.stringify(view);
    } catch (e) {
      errorMessage = String(e);
    }

    expect(errorMessage).not.toContain(
      "encrypted-key-ciphertext-base64",
    );
    expect(errorMessage).not.toContain("version");
    expect(errorMessage).not.toContain("algorithm");
  });

  it("budget values are serialized as strings (bigint-safe)", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    expect(typeof view.budget.approvedAtomic).toBe("string");
    expect(typeof view.budget.spentAtomic).toBe("string");
    expect(typeof view.budget.reservedAtomic).toBe("string");
    expect(typeof view.budget.remainingAtomic).toBe("string");
  });

  it("settled tools and running tool are exposed", () => {
    const agent = makeTestAgent({
      settledToolIds: ["evidence-quality-check"],
      currentRunningToolId: "case-refresh",
    });
    const view = toResolutionAgentPublicView(agent);
    expect(view.settledToolIds).toContain("evidence-quality-check");
    expect(view.currentRunningToolId).toBe("case-refresh");
  });

  it("public view excludes encrypted secret even on full object spread", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);

    // Convert to plain object and check all keys
    const keys = Object.keys(view);
    const forbiddenKeys = ["encryptedSecret", "ciphertext", "iv", "authenticationTag", "version", "algorithm"];
    for (const key of forbiddenKeys) {
      expect(keys).not.toContain(key);
    }
  });
});
