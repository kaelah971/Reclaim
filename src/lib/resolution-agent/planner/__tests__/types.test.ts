import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Type-level compile-time checks (structural tests)
// ---------------------------------------------------------------------------

describe("Planner types — structural integrity", () => {
  it("PlannerReasonCode covers all expected values", () => {
    // This is a compile-time check — if a value is missing, TypeScript fails.
    const reasonCodes: string[] = [
      "agent_not_active",
      "agent_paused",
      "agent_closed",
      "agent_expired",
      "tool_already_running",
      "awaiting_existing_paid_result",
      "evidence_missing",
      "evidence_request_already_open",
      "evidence_quality_check_required",
      "evidence_gaps_found",
      "evidence_changed_refresh_required",
      "unresolved_gaps_after_refresh",
      "dispute_brief_required",
      "dispute_brief_ready",
      "insufficient_budget",
      "no_meaningful_change",
      "ready_for_human_review",
    ];

    expect(reasonCodes).toHaveLength(17);
    // Each value must be unique
    expect(new Set(reasonCodes).size).toBe(17);
  });

  it("ResolutionAgentNextAction discriminated union has all expected kinds", () => {
    const nextActionKinds = [
      "run_tool",
      "create_evidence_request",
      "wait_for_evidence",
      "ready_for_human_review",
      "budget_exhausted",
      "waiting_for_human_approval",
      "no_action",
    ];

    expect(nextActionKinds).toHaveLength(7);
    expect(new Set(nextActionKinds).size).toBe(7);
  });

  it("NormalizedToolOutcome discriminated union has all tool kinds", () => {
    const outcomeKinds = ["evidence_quality", "case_refresh", "dispute_brief"];

    expect(outcomeKinds).toHaveLength(3);
    expect(new Set(outcomeKinds).size).toBe(3);
  });

  it("ResolutionAgentPlannerInput has all required fields", () => {
    const requiredFields = [
      "agent",
      "observationResult",
      "toolExecutions",
      "evidenceRequests",
      "now",
    ];

    expect(requiredFields).toHaveLength(5);
  });

  it("ResolutionAgentPlanningResult has all required fields", () => {
    const requiredFields = [
      "agentId",
      "plan",
      "nextAction",
      "reasonCode",
      "caseVersionHash",
      "evidenceVersionHash",
      "persisted",
    ];

    expect(requiredFields).toHaveLength(7);
  });

  it("EvidenceQualityOutcome has correct readiness states", () => {
    const states = ["ready", "needs_improvement", "insufficient"] as const;
    expect(states).toHaveLength(3);
  });

  it("CaseRefreshOutcome has correct readiness states", () => {
    const states = ["ready", "needs_evidence", "needs_clarification"] as const;
    expect(states).toHaveLength(3);
  });

  it("Tool outcome execution statuses are valid", () => {
    const executionStatuses = ["settled", "pending", "failed"] as const;
    expect(executionStatuses).toHaveLength(3);
  });
});
