import { describe, it, expect } from "vitest";
import { evaluateToolExecution } from "../policy";
import type { ResolutionAgent, ResolutionAgentToolRequest } from "../types";

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
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: {
      escrowState: "funded",
      evidenceCount: 3,
      evidenceVersionHash: "0xabc123",
      caseVersionHash: "0xdef456",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: 5000000,
    },
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      _brand: "EncryptedWalletSecret",
      ciphertext: "test-ciphertext",
      iv: "test-iv",
      tag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1000000,
    updatedAt: 1000000,
    activatedAt: 5000000,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeValidRequest(
  overrides: Partial<ResolutionAgentToolRequest> = {},
): ResolutionAgentToolRequest {
  return {
    toolId: "evidence-quality-check",
    priceAtomic: 10000n,
    network: "eip155:42220",
    asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    caseVersionHash: "0xdef456",
    evidenceVersionHash: "0xabc123",
    ...overrides,
  };
}

const NOW = 5000000;

describe("Policy Engine", () => {
  it("active and valid request is allowed", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("allowed");
  });

  it("inactive agent rejected", () => {
    const agent = makeTestAgent({ status: "draft" });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("agent_not_active");
  });

  it("expired agent rejected", () => {
    const agent = makeTestAgent({
      status: "active",
      policy: {
        ...makeTestAgent().policy,
        expiresAt: NOW - 1,
      },
    });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("agent_expired");
  });

  it("paused agent rejected", () => {
    const agent = makeTestAgent({ status: "paused" });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("agent_paused");
  });

  it("closing agent rejected", () => {
    const agent = makeTestAgent({ status: "closing" });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("agent_closing");
  });

  it("closed agent rejected", () => {
    const agent = makeTestAgent({ status: "closed" });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("agent_closed");
  });

  it("arbitrary tool identifier rejected", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({
      // Force a non-allowlisted ID
      toolId: "evil_tool" as unknown as ResolutionAgentToolRequest["toolId"],
    });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("tool_not_allowlisted");
  });

  it("altered tool price rejected", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({ priceAtomic: 999999n });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("invalid_price");
    if (result.decision.kind === "invalid_price") {
      expect(result.decision.expected).toBe(10000n);
      expect(result.decision.received).toBe(999999n);
    }
  });

  it("altered payTo rejected", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({
      payTo: "0x0000000000000000000000000000000000000001",
    });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("invalid_recipient");
  });

  it("altered network rejected", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({ network: "eip155:1" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("invalid_network");
  });

  it("altered asset rejected", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({
      asset: "0x0000000000000000000000000000000000000000",
    });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("invalid_asset");
  });

  it("insufficient budget rejected", () => {
    const agent = makeTestAgent({
      budget: {
        approvedAtomic: 5000n,
        spentAtomic: 0n,
        reservedAtomic: 0n,
      },
    });
    const request = makeValidRequest({ priceAtomic: 10000n });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("insufficient_budget");
    if (result.decision.kind === "insufficient_budget") {
      expect(result.decision.remaining).toBe(5000n);
      expect(result.decision.requested).toBe(10000n);
    }
  });

  it("duplicate settled request rejected", () => {
    const agent = makeTestAgent({
      settledToolIds: ["evidence-quality-check"],
    });
    const request = makeValidRequest();
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("already_settled");
  });

  it("concurrent running request rejected", () => {
    const agent = makeTestAgent({
      currentRunningToolId: "evidence-quality-check",
    });
    const request = makeValidRequest({ toolId: "case-refresh" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("already_running");
  });

  it("evidence-required tool rejected without evidence", () => {
    const agent = makeTestAgent({
      observation: {
        escrowState: "funded",
        evidenceCount: 0,
        evidenceVersionHash: "0x000",
        caseVersionHash: "0xdef456",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: NOW,
      },
    });
    const request = makeValidRequest({ toolId: "evidence-quality-check" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("evidence_required");
  });

  it("meaningful-change required tool rejected without change", () => {
    const agent = makeTestAgent({
      observation: {
        ...makeTestAgent().observation!,
        hasMeaningfulChange: false,
      },
    });
    const request = makeValidRequest({ toolId: "case-refresh" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("meaningful_change_required");
  });

  it("case-refresh allowed with meaningful change", () => {
    const agent = makeTestAgent({
      observation: {
        ...makeTestAgent().observation!,
        hasMeaningfulChange: true,
      },
    });
    const request = makeValidRequest({ toolId: "case-refresh" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("allowed");
  });

  it("dispute brief allowed when case is sufficiently complete", () => {
    const agent = makeTestAgent();
    const request = makeValidRequest({ toolId: "reclaim-dispute-brief-v1" });
    const result = evaluateToolExecution(agent, request, NOW);
    expect(result.decision.kind).toBe("allowed");
  });

  it("policy uses canonical server configuration", () => {
    const agent = makeTestAgent();
    // Evidence quality check requires canonical network eip155:42220
    const wrongNetwork = makeValidRequest({ network: "eip155:11142220" });
    const result = evaluateToolExecution(agent, wrongNetwork, NOW);
    expect(result.decision.kind).toBe("invalid_network");
    if (result.decision.kind === "invalid_network") {
      expect(result.decision.expected).toBe("eip155:42220");
    }
  });
});
