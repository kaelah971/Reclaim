import { describe, it, expect } from "vitest";
import { classifyResolutionAgentRecovery } from "../recovery";
import type { ResolutionAgent } from "../../types";
import type { ToolExecutionRow } from "../../store/types";

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
    budget: {
      approvedAtomic: 1_000_000n,
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
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    activatedAt: 1_000_000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeExecution(
  overrides: Partial<ToolExecutionRow> = {},
): ToolExecutionRow {
  return {
    id: "exec_1",
    agent_id: "agt_test_1",
    tool_identifier: "evidence-quality-check",
    request_hash: "req_hash_1",
    case_version_hash: "case_v1",
    evidence_version_hash: "ev_v1",
    state: "pending",
    price_atomic: 10_000,
    network: "eip155:42220",
    asset_address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    pay_to_address: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    payment_reference: null,
    settlement_tx_hash: null,
    result_reference: null,
    result_data: null,
    failure_reason: null,
    created_at: new Date(1_000_000).toISOString(),
    updated_at: new Date(1_000_000).toISOString(),
    ...overrides,
  };
}

describe("classifyResolutionAgentRecovery", () => {
  const now = 1_000_000;

  it("no execution → no_recovery_needed", () => {
    const agent = makeTestAgent();
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: null,
      now,
    });
    expect(result.kind).toBe("no_recovery_needed");
  });

  it("paid_pending_result → recover_paid_result", () => {
    const agent = makeTestAgent();
    const exec = makeExecution({ state: "paid_pending_result" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("recover_paid_result");
  });

  it("settled → reconcile_settled_execution", () => {
    const agent = makeTestAgent();
    const exec = makeExecution({ state: "settled" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("reconcile_settled_execution");
  });

  it("fresh pending → wait_for_in_flight_execution", () => {
    const agent = makeTestAgent();
    const recentTime = new Date(now).toISOString();
    const exec = makeExecution({
      state: "pending",
      created_at: recentTime,
      updated_at: recentTime,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("wait_for_in_flight_execution");
  });

  it("stale pending (>= 5 min) → mark_failed_recoverable", () => {
    const agent = makeTestAgent();
    const staleTime = new Date(now - 5 * 60_000).toISOString();
    const exec = makeExecution({
      state: "pending",
      created_at: staleTime,
      updated_at: staleTime,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("mark_failed_recoverable");
  });

  it("fresh reserved → wait_for_in_flight_execution", () => {
    const agent = makeTestAgent();
    const recentTime = new Date(now).toISOString();
    const exec = makeExecution({
      state: "reserved",
      created_at: recentTime,
      updated_at: recentTime,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("wait_for_in_flight_execution");
  });

  it("stale reserved (>= 5 min) → mark_failed_recoverable", () => {
    const agent = makeTestAgent();
    const staleTime = new Date(now - 5 * 60_000).toISOString();
    const exec = makeExecution({
      state: "reserved",
      created_at: staleTime,
      updated_at: staleTime,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("mark_failed_recoverable");
  });

  it("fresh settling (< 10 min) → wait_for_in_flight_execution", () => {
    const agent = makeTestAgent();
    const time8minAgo = new Date(now - 8 * 60_000).toISOString();
    const exec = makeExecution({
      state: "settling",
      created_at: time8minAgo,
      updated_at: time8minAgo,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("wait_for_in_flight_execution");
  });

  it("stale settling (>= 10 min) → mark_failed_recoverable", () => {
    const agent = makeTestAgent();
    const staleTime = new Date(now - 10 * 60_000).toISOString();
    const exec = makeExecution({
      state: "settling",
      created_at: staleTime,
      updated_at: staleTime,
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("mark_failed_recoverable");
  });

  it("failed_unpaid → no_recovery_needed", () => {
    const agent = makeTestAgent();
    const exec = makeExecution({ state: "failed_unpaid" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("no_recovery_needed");
  });

  it("cancelled → no_recovery_needed", () => {
    const agent = makeTestAgent();
    const exec = makeExecution({ state: "cancelled" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("no_recovery_needed");
  });

  it("failed_recoverable → manual_review_required", () => {
    const agent = makeTestAgent({ status: "failed_recoverable" });
    const exec = makeExecution({ state: "failed_recoverable" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("manual_review_required");
  });

  it("released-unpaid failed_recoverable → no_recovery_needed (RA1R.7O retry)", () => {
    const agent = makeTestAgent({ status: "active" });
    const exec = makeExecution({
      state: "failed_recoverable",
      released_unpaid_at: "2026-08-09T06:31:56.579+00:00",
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("no_recovery_needed");
  });

  it("released-unpaid failed_recoverable WITH settlement proof still requires review", () => {
    const agent = makeTestAgent({ status: "active" });
    const exec = makeExecution({
      state: "failed_recoverable",
      released_unpaid_at: "2026-08-09T06:31:56.579+00:00",
      settlement_tx_hash: "0xsettled",
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    expect(result.kind).toBe("manual_review_required");
  });

  it("currentRunningToolId with no execution → mark_failed_recoverable", () => {
    const agent = makeTestAgent({
      currentRunningToolId: "evidence-quality-check",
    });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: null,
      now,
    });
    expect(result.kind).toBe("mark_failed_recoverable");
  });

  it("recovery classifier never mutates budget", () => {
    const agent = makeTestAgent({
      budget: { approvedAtomic: 1_000_000n, spentAtomic: 500_000n, reservedAtomic: 100_000n },
    });
    const budgetBefore = { ...agent.budget };
    classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: null,
      now,
    });
    // The original budget should be unchanged
    expect(agent.budget.approvedAtomic).toBe(budgetBefore.approvedAtomic);
    expect(agent.budget.spentAtomic).toBe(budgetBefore.spentAtomic);
    expect(agent.budget.reservedAtomic).toBe(budgetBefore.reservedAtomic);
  });

  it("recovery classifier is pure (same input, same output)", () => {
    const agent = makeTestAgent();
    const exec = makeExecution({ state: "paid_pending_result" });

    const result1 = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    const result2 = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });

    expect(result1.kind).toBe(result2.kind);
    expect(result1.reason).toBe(result2.reason);
  });

  it("agent with settled execution but currentRunningToolId still set → reconcile", () => {
    const agent = makeTestAgent({ currentRunningToolId: "evidence-quality-check" });
    const exec = makeExecution({ state: "settled" });
    const result = classifyResolutionAgentRecovery({
      agent,
      latestToolExecution: exec,
      now,
    });
    // The settled state takes priority over currentRunningToolId
    expect(result.kind).toBe("reconcile_settled_execution");
  });
});
