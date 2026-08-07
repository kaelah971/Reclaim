import { describe, it, expect } from "vitest";
import {
  canTransitionAgentStatus,
  getValidTransitions,
  transitionAgentStatus,
} from "../state-machine";
import type { TransitionContext } from "../state-machine";
import type { ResolutionAgent } from "../types";
import { InvalidAgentStateTransitionError } from "../errors";

function makeTestAgent(
  status: ResolutionAgent["status"] = "draft",
  overrides: Partial<ResolutionAgent> = {},
): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review.",
    status,
    identity: {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
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
    observation: null,
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
    createdAt: 1000000,
    updatedAt: 1000000,
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

const defaultCtx: TransitionContext = { now: 5000000, fundingConfirmed: true, activationApproved: true };

describe("canTransitionAgentStatus", () => {
  it("draft to awaiting_funding allowed", () => {
    expect(canTransitionAgentStatus("draft", "awaiting_funding")).toBe(true);
  });

  it("draft to active rejected", () => {
    expect(canTransitionAgentStatus("draft", "active")).toBe(false);
  });

  it("funded to awaiting_activation allowed", () => {
    expect(canTransitionAgentStatus("funded", "awaiting_activation")).toBe(true);
  });

  it("active to running_tool allowed", () => {
    expect(canTransitionAgentStatus("active", "running_tool")).toBe(true);
  });

  it("paused to running_tool rejected", () => {
    expect(canTransitionAgentStatus("paused", "running_tool")).toBe(false);
  });

  it("closing to running_tool rejected", () => {
    expect(canTransitionAgentStatus("closing", "running_tool")).toBe(false);
  });

  it("expired to running_tool rejected", () => {
    expect(canTransitionAgentStatus("expired", "running_tool")).toBe(false);
  });

  it("closed is terminal (no outgoing transitions)", () => {
    expect(getValidTransitions("closed")).toEqual([]);
  });

  it("ready_for_human_review cannot go back to active", () => {
    expect(canTransitionAgentStatus("ready_for_human_review", "active")).toBe(
      false,
    );
  });

  it("budget_exhausted to running_tool blocked", () => {
    expect(canTransitionAgentStatus("budget_exhausted", "running_tool")).toBe(
      false,
    );
  });

  it("failed_recoverable can go to active", () => {
    expect(canTransitionAgentStatus("failed_recoverable", "active")).toBe(true);
  });

  it("failed_recoverable can go to closed", () => {
    expect(canTransitionAgentStatus("failed_recoverable", "closed")).toBe(true);
  });
});

describe("transitionAgentStatus", () => {
  it("draft to awaiting_funding succeeds", () => {
    const agent = makeTestAgent("draft");
    const result = transitionAgentStatus(agent, "awaiting_funding", defaultCtx);
    expect(result.status).toBe("awaiting_funding");
  });

  it("draft to active rejected with error", () => {
    const agent = makeTestAgent("draft");
    expect(() => transitionAgentStatus(agent, "active", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
  });

  it("awaiting_funding to funded requires funding confirmation", () => {
    const agent = makeTestAgent("awaiting_funding");
    const ctx: TransitionContext = { ...defaultCtx, fundingConfirmed: false };
    expect(() => transitionAgentStatus(agent, "funded", ctx)).toThrow(
      InvalidAgentStateTransitionError,
    );
    const ctxOk: TransitionContext = { ...defaultCtx, fundingConfirmed: true };
    const result = transitionAgentStatus(agent, "funded", ctxOk);
    expect(result.status).toBe("funded");
  });

  it("funded to awaiting_activation allowed", () => {
    const agent = makeTestAgent("funded");
    const result = transitionAgentStatus(agent, "awaiting_activation", defaultCtx);
    expect(result.status).toBe("awaiting_activation");
  });

  it("awaiting_activation to active requires explicit activation approval", () => {
    const agent = makeTestAgent("awaiting_activation");
    const ctx: TransitionContext = { ...defaultCtx, activationApproved: false };
    expect(() => transitionAgentStatus(agent, "active", ctx)).toThrow(
      InvalidAgentStateTransitionError,
    );
    const ctxOk: TransitionContext = { ...defaultCtx, activationApproved: true };
    const result = transitionAgentStatus(agent, "active", ctxOk);
    expect(result.status).toBe("active");
    expect(result.activatedAt).toBe(defaultCtx.now);
  });

  it("active to running_tool allowed", () => {
    const agent = makeTestAgent("active");
    const result = transitionAgentStatus(agent, "running_tool", defaultCtx);
    expect(result.status).toBe("running_tool");
  });

  it("active to waiting_for_evidence allowed", () => {
    const agent = makeTestAgent("active");
    const result = transitionAgentStatus(agent, "waiting_for_evidence", defaultCtx);
    expect(result.status).toBe("waiting_for_evidence");
  });

  it("active to ready_for_human_review allowed", () => {
    const agent = makeTestAgent("active");
    const result = transitionAgentStatus(agent, "ready_for_human_review", defaultCtx);
    expect(result.status).toBe("ready_for_human_review");
  });

  it("paused to running_tool rejected", () => {
    const agent = makeTestAgent("paused");
    expect(() => transitionAgentStatus(agent, "running_tool", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
  });

  it("closing to running_tool rejected", () => {
    const agent = makeTestAgent("closing");
    expect(() => transitionAgentStatus(agent, "running_tool", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
  });

  it("expired to active rejected", () => {
    const agent = makeTestAgent("expired", { policy: makeTestAgent().policy });
    expect(() => transitionAgentStatus(agent, "active", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
  });

  it("closed terminal throws on any transition", () => {
    const agent = makeTestAgent("closed");
    expect(() => transitionAgentStatus(agent, "active", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
    expect(() => transitionAgentStatus(agent, "paused", defaultCtx)).toThrow(
      InvalidAgentStateTransitionError,
    );
  });

  it("ready_for_human_review does not imply escrow settlement", () => {
    const agent = makeTestAgent("ready_for_human_review");
    // Agent stops here — human makes the decision
    expect(agent.status).toBe("ready_for_human_review");
    // No transition to escrow_settled exists
    expect(canTransitionAgentStatus("ready_for_human_review", "active")).toBe(
      false,
    );
    // Can pause, but does not settle escrow
    expect(canTransitionAgentStatus("ready_for_human_review", "paused")).toBe(
      true,
    );
  });

  it("budget_exhausted prevents new tool execution", () => {
    const agent = makeTestAgent("budget_exhausted");
    expect(() =>
      transitionAgentStatus(agent, "running_tool", defaultCtx),
    ).toThrow(InvalidAgentStateTransitionError);
  });

  it("expired prevents new tool execution", () => {
    const agent = makeTestAgent("expired");
    expect(() =>
      transitionAgentStatus(agent, "running_tool", defaultCtx),
    ).toThrow(InvalidAgentStateTransitionError);
  });

  it("paused prevents new tool execution", () => {
    const agent = makeTestAgent("paused");
    expect(() =>
      transitionAgentStatus(agent, "running_tool", defaultCtx),
    ).toThrow(InvalidAgentStateTransitionError);
  });

  it("closing prevents new tool execution", () => {
    const agent = makeTestAgent("closing");
    expect(() =>
      transitionAgentStatus(agent, "running_tool", defaultCtx),
    ).toThrow(InvalidAgentStateTransitionError);
  });

  it("failed_recoverable can recover to active without another payment", () => {
    const agent = makeTestAgent("failed_recoverable");
    const result = transitionAgentStatus(agent, "active", defaultCtx);
    expect(result.status).toBe("active");
    // Budget remains unchanged, no new payment forced
    expect(result.budget.spentAtomic).toBe(0n);
  });

  it("sets activatedAt on first activation", () => {
    const agent = makeTestAgent("awaiting_activation");
    const ctxOk: TransitionContext = { ...defaultCtx, activationApproved: true };
    const result = transitionAgentStatus(agent, "active", ctxOk);
    expect(result.activatedAt).toBe(ctxOk.now);
  });

  it("sets closedAt on close", () => {
    const agent = makeTestAgent("closing");
    const result = transitionAgentStatus(agent, "closed", defaultCtx);
    expect(result.status).toBe("closed");
    expect(result.closedAt).toBe(defaultCtx.now);
  });
});
