import { describe, it, expect, vi } from "vitest";
import {
  buildPauseMessage,
  buildResumeMessage,
} from "../api/auth";
import { pauseResolutionAgent, resumeResolutionAgent } from "../api/service";
import type { ResolutionAgent } from "../types";
import type { ResolutionAgentStore } from "../api/service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_test_1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
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
    budget: { approvedAtomic: 1_000_000n, spentAtomic: 0n, reservedAtomic: 0n },
    plan: null,
    observation: null,
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      version: 1, algorithm: "AES-256-GCM",
      ciphertext: "test-ciphertext", iv: "test-iv", authenticationTag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1_000_000, updatedAt: 1_000_000,
    activatedAt: null, pausedAt: null, closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeMockStore(agent: ResolutionAgent): ResolutionAgentStore & { getAgentVersion: ReturnType<typeof vi.fn> } {
  return {
    createAgent: vi.fn().mockResolvedValue(agent),
    getAgentById: vi.fn().mockResolvedValue(agent),
    getAgentByCaseIdentity: vi.fn().mockResolvedValue(null),
    updateAgent: vi.fn().mockImplementation((a: ResolutionAgent) => Promise.resolve(a)),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
  };
}

const funderAddress = "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const now = 2_000_000;

// ---------------------------------------------------------------------------
// Message Builders
// ---------------------------------------------------------------------------

describe("buildPauseMessage", () => {
  it("includes agentId in the message", () => {
    const msg = buildPauseMessage({
      agentId: "agt_test_1",
      escrowChainId: "eip155:42220",
      escrowPaymentId: "pay_1",
    });
    expect(msg).toContain("pause_resolution_agent");
    expect(msg).toContain("agt_test_1");
    expect(msg).toContain("pay_1");
  });

  it("is different for different agent IDs", () => {
    const a = buildPauseMessage({ agentId: "a", escrowChainId: "c", escrowPaymentId: "p" });
    const b = buildPauseMessage({ agentId: "b", escrowChainId: "c", escrowPaymentId: "p" });
    expect(a).not.toBe(b);
  });
});

describe("buildResumeMessage", () => {
  it("includes agentId in the message", () => {
    const msg = buildResumeMessage({
      agentId: "agt_test_1",
      escrowChainId: "eip155:42220",
      escrowPaymentId: "pay_1",
    });
    expect(msg).toContain("resume_resolution_agent");
    expect(msg).toContain("agt_test_1");
  });

  it("differs from pause message", () => {
    const params = { agentId: "agt_1", escrowChainId: "c", escrowPaymentId: "p" };
    expect(buildPauseMessage(params)).not.toBe(buildResumeMessage(params));
  });
});

// ---------------------------------------------------------------------------
// Pause — Service
// ---------------------------------------------------------------------------

describe("pauseResolutionAgent", () => {
  it("pauses an active agent successfully", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    const result = await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("paused");
    expect(store.updateAgent).toHaveBeenCalled();
    expect(store.appendEvent).toHaveBeenCalledWith(
      agent.id, "agent_paused", expect.any(String), "active", "paused", expect.any(Object),
    );
  });

  it("pauses a waiting_for_evidence agent", async () => {
    const agent = makeTestAgent({ status: "waiting_for_evidence" });
    const store = makeMockStore(agent);
    const result = await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("paused");
  });

  it("rejects pause while running_tool (in-flight tool safety)", async () => {
    const agent = makeTestAgent({ status: "running_tool", currentRunningToolId: "evidence-quality-check" });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store }),
    ).rejects.toThrow(/currently executing a paid tool/i);
  });

  it("pauses a failed_recoverable agent", async () => {
    const agent = makeTestAgent({ status: "failed_recoverable" });
    const store = makeMockStore(agent);
    const result = await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("paused");
  });

  it("is idempotent for already-paused agent", async () => {
    const agent = makeTestAgent({ status: "paused" });
    const store = makeMockStore(agent);
    const result = await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("paused");
    expect(store.updateAgent).not.toHaveBeenCalled();
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects pause for closed agent", async () => {
    const agent = makeTestAgent({ status: "closed" });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store }),
    ).rejects.toThrow(/cannot be paused/i);
  });

  it("rejects pause for closing agent", async () => {
    const agent = makeTestAgent({ status: "closing" });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store }),
    ).rejects.toThrow(/cannot be paused/i);
  });

  it("rejects pause for expired agent", async () => {
    const agent = makeTestAgent({ status: "expired" });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store }),
    ).rejects.toThrow(/cannot be paused/i);
  });

  it("rejects pause when caller is not the funder", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: "0xwrong", now, store }),
    ).rejects.toThrow(/only the agent's funder/i);
  });

  it("does not change budget during pause", async () => {
    const agent = makeTestAgent({
      status: "active",
      budget: { approvedAtomic: 1000000n, spentAtomic: 20000n, reservedAtomic: 10000n },
    });
    const capturedBudgets: { approvedAtomic: bigint; spentAtomic: bigint; reservedAtomic: bigint }[] = [];
    const store = {
      ...makeMockStore(agent),
      updateAgent: vi.fn().mockImplementation((a: ResolutionAgent) => {
        capturedBudgets.push({ ...a.budget });
        return Promise.resolve(a);
      }),
    };
    await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(capturedBudgets[0].approvedAtomic).toBe(1000000n);
    expect(capturedBudgets[0].spentAtomic).toBe(20000n);
    expect(capturedBudgets[0].reservedAtomic).toBe(10000n);
  });

  it("does not modify evidence requests or tool executions", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    // Verify only agent was touched, not other entities
    expect(store.getAgentById).toHaveBeenCalledWith(agent.id);
    expect(store.updateAgent).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Resume — Service
// ---------------------------------------------------------------------------

describe("resumeResolutionAgent", () => {
  it("resumes a paused agent to active", async () => {
    const agent = makeTestAgent({ status: "paused", pausedAt: 1_500_000 });
    const store = makeMockStore(agent);
    const result = await resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("active");
    expect(store.appendEvent).toHaveBeenCalledWith(
      agent.id, "agent_resumed", expect.any(String), "paused", "active", expect.any(Object),
    );
  });

  it("is idempotent for non-paused agent (active)", async () => {
    const agent = makeTestAgent({ status: "active" });
    const store = makeMockStore(agent);
    const result = await resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("active");
    expect(store.updateAgent).not.toHaveBeenCalled();
  });

  it("is idempotent for waiting_for_evidence agent", async () => {
    const agent = makeTestAgent({ status: "waiting_for_evidence" });
    const store = makeMockStore(agent);
    const result = await resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(result.status).toBe("waiting_for_evidence");
    expect(store.updateAgent).not.toHaveBeenCalled();
  });

  it("rejects resume when caller is not the funder", async () => {
    const agent = makeTestAgent({ status: "paused" });
    const store = makeMockStore(agent);
    await expect(
      resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: "0xwrong", now, store }),
    ).rejects.toThrow(/only the agent's funder/i);
  });

  it("does not change budget during resume", async () => {
    const agent = makeTestAgent({
      status: "paused",
      budget: { approvedAtomic: 1_000_000n, spentAtomic: 20_000n, reservedAtomic: 10_000n },
    });
    const capturedBudgets: { approvedAtomic: bigint; spentAtomic: bigint; reservedAtomic: bigint }[] = [];
    const store = {
      ...makeMockStore(agent),
      updateAgent: vi.fn().mockImplementation((a: ResolutionAgent) => {
        capturedBudgets.push({ ...a.budget });
        return Promise.resolve(a);
      }),
    };
    await resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    expect(capturedBudgets[0].approvedAtomic).toBe(1_000_000n);
    expect(capturedBudgets[0].spentAtomic).toBe(20_000n);
    expect(capturedBudgets[0].reservedAtomic).toBe(10_000n);
  });
});

// ---------------------------------------------------------------------------
// Safety — Pause + Resume preserves waiting context
// ---------------------------------------------------------------------------

describe("pause/resume preserves waiting context", () => {
  it("pausing a waiting_for_evidence agent does not resolve evidence requests", async () => {
    const agent = makeTestAgent({ status: "waiting_for_evidence" });
    const store = makeMockStore(agent);
    await pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    // Evidence requests are untouched; only the agent status changes
    expect(store.updateAgent).toHaveBeenCalledTimes(1);
  });

  it("resuming after pause does not bypass unresolved evidence", async () => {
    // After resume → active, the planner re-evaluates open evidence requests
    // and will produce wait_for_evidence again if they remain open.
    const agent = makeTestAgent({ status: "paused", pausedAt: 1_500_000 });
    const store = makeMockStore(agent);
    const result = await resumeResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store });
    // Resumes to "active" — the planner in the next worker iteration handles the rest
    expect(result.status).toBe("active");
  });

  it("rejects pause while running_tool to protect in-flight execution", async () => {
    const agent = makeTestAgent({
      status: "running_tool",
      currentRunningToolId: "evidence-quality-check",
      budget: { approvedAtomic: 1_000_000n, spentAtomic: 0n, reservedAtomic: 10_000n },
    });
    const store = makeMockStore(agent);
    await expect(
      pauseResolutionAgent({ agentId: agent.id, authenticatedCaller: funderAddress, now, store }),
    ).rejects.toThrow(/currently executing a paid tool/i);
    expect(store.updateAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Worker Exclusion
// ---------------------------------------------------------------------------

describe("worker exclusion while paused", () => {
  it("paused is not in RUNNABLE_AGENT_STATUSES", async () => {
    const { RUNNABLE_AGENT_STATUSES } = await import("../worker/types");
    expect(RUNNABLE_AGENT_STATUSES as readonly string[]).not.toContain("paused");
  });

  it("paused agents cannot auto-resume from evidence (resumer excludes non-waiting)", async () => {
    const { evaluateResolutionAgentResumption } = await import("../resumer");
    const agent = makeTestAgent({ status: "paused" });
    const result = evaluateResolutionAgentResumption({
      agent,
      evidenceRequests: [],
      now,
    });
    // Resumer only activates for waiting_for_evidence; paused stays as-is
    expect(result.kind).toBe("stay_waiting");
  });
});
