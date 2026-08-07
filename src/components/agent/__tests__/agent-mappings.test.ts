import { describe, it, expect } from "vitest";
import {
  getAgentStatusLabel,
  getAgentStatusVariant,
  getActivityDescription,
  getEventDisplayLabel,
  formatAgentBudget,
  computeBudgetPercent,
} from "@/components/agent/agent-mappings";

// ---------------------------------------------------------------------------
// Status Labels
// ---------------------------------------------------------------------------

describe("getAgentStatusLabel", () => {
  it("maps known statuses to friendly labels", () => {
    expect(getAgentStatusLabel("draft")).toBe("Draft");
    expect(getAgentStatusLabel("awaiting_funding")).toBe("Awaiting funding");
    expect(getAgentStatusLabel("funded")).toBe("Ready to start");
    expect(getAgentStatusLabel("awaiting_activation")).toBe("Ready to start");
    expect(getAgentStatusLabel("active")).toBe("Agent active");
    expect(getAgentStatusLabel("running_tool")).toBe("Running tool");
    expect(getAgentStatusLabel("waiting_for_evidence")).toBe("Waiting for evidence");
    expect(getAgentStatusLabel("waiting_for_human_approval")).toBe("Waiting for approval");
    expect(getAgentStatusLabel("ready_for_human_review")).toBe("Ready for human review");
    expect(getAgentStatusLabel("budget_exhausted")).toBe("Budget exhausted");
    expect(getAgentStatusLabel("expired")).toBe("Expired");
    expect(getAgentStatusLabel("paused")).toBe("Paused");
    expect(getAgentStatusLabel("closing")).toBe("Closing");
    expect(getAgentStatusLabel("closed")).toBe("Closed");
    expect(getAgentStatusLabel("failed_recoverable")).toBe("Needs attention");
  });

  it("returns Draft for unknown statuses", () => {
    expect(getAgentStatusLabel("unknown")).toBe("Draft");
  });
});

describe("getAgentStatusVariant", () => {
  it("returns protected for active and running_tool", () => {
    expect(getAgentStatusVariant("active")).toBe("protected");
    expect(getAgentStatusVariant("running_tool")).toBe("protected");
  });

  it("returns pending for waiting states", () => {
    expect(getAgentStatusVariant("waiting_for_evidence")).toBe("pending");
    expect(getAgentStatusVariant("waiting_for_human_approval")).toBe("pending");
  });

  it("returns settled for ready and closed states", () => {
    expect(getAgentStatusVariant("ready_for_human_review")).toBe("settled");
    expect(getAgentStatusVariant("closed")).toBe("settled");
  });

  it("returns disputed for error/expired/budget states", () => {
    expect(getAgentStatusVariant("budget_exhausted")).toBe("disputed");
    expect(getAgentStatusVariant("expired")).toBe("disputed");
    expect(getAgentStatusVariant("failed_recoverable")).toBe("disputed");
  });
});

// ---------------------------------------------------------------------------
// Activity Description
// ---------------------------------------------------------------------------

describe("getActivityDescription", () => {
  it("describes tool-specific activity when running a tool", () => {
    expect(getActivityDescription("running_tool", "evidence-quality-check")).toBe(
      "Checking whether the submitted evidence is strong enough.",
    );
    expect(getActivityDescription("running_tool", "case-refresh")).toBe(
      "Reassessing the case after new evidence arrived.",
    );
    expect(getActivityDescription("running_tool", "reclaim-dispute-brief-v1")).toBe(
      "Preparing the case for human review.",
    );
  });

  it("describes status-based activity", () => {
    expect(getActivityDescription("awaiting_funding", null)).toContain("Waiting for the case wallet");
    expect(getActivityDescription("active", null)).toContain("Assessing the case");
    expect(getActivityDescription("waiting_for_evidence", null)).toContain("Waiting for the requested evidence");
    expect(getActivityDescription("ready_for_human_review", null)).toContain("Case prepared");
  });

  it("returns a non-empty string for all known statuses", () => {
    const statuses = [
      "draft", "awaiting_funding", "funded", "awaiting_activation",
      "active", "running_tool", "waiting_for_evidence",
      "waiting_for_human_approval", "ready_for_human_review",
      "budget_exhausted", "expired", "paused",
      "failed_recoverable", "closed",
    ];
    for (const s of statuses) {
      const desc = getActivityDescription(s, null);
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Budget Formatting
// ---------------------------------------------------------------------------

describe("formatAgentBudget", () => {
  it("formats budget values", () => {
    const result = formatAgentBudget("50000", "10000", "0", "40000");
    expect(result.approved).toBeDefined();
    expect(result.spent).toBeDefined();
    expect(result.reserved).toBeDefined();
    expect(result.remaining).toBeDefined();
  });

  it("handles zero values", () => {
    const result = formatAgentBudget("0", "0", "0", "0");
    expect(result.approved).toBeDefined();
    expect(result.remaining).toBeDefined();
  });

  it("formats atomic values to display values", () => {
    // formatUSDC(50000n) → "0.05" (50000 atomic = 0.05 USDC at 6 decimals)
    const result = formatAgentBudget("50000", "10000", "0", "40000");
    expect(result.approved).toBe("0.05");
    expect(result.spent).toBe("0.01");
    expect(result.remaining).toBe("0.04");
  });
});

describe("computeBudgetPercent", () => {
  it("computes percentage correctly", () => {
    expect(computeBudgetPercent("0", "100")).toBe(0);
    expect(computeBudgetPercent("50", "100")).toBe(50);
    expect(computeBudgetPercent("100", "100")).toBe(100);
  });

  it("handles zero approved budget", () => {
    expect(computeBudgetPercent("50", "0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Event Labels
// ---------------------------------------------------------------------------

describe("getEventDisplayLabel", () => {
  it("maps known event types to readable labels", () => {
    expect(getEventDisplayLabel("created")).toBe("Agent created");
    expect(getEventDisplayLabel("status_change")).toBe("Status updated");
    expect(getEventDisplayLabel("plan_created")).toBe("Plan created");
    expect(getEventDisplayLabel("evidence_request_created")).toBe("Evidence requested");
    expect(getEventDisplayLabel("evidence_request_fulfilled")).toBe("Evidence fulfilled");
    expect(getEventDisplayLabel("agent_resumed_after_evidence")).toBe("Agent resumed");
    expect(getEventDisplayLabel("agent_resumption_failed")).toBe("Resumption check failed");
  });

  it("falls back to event type with underscores replaced for unknown types", () => {
    const label = getEventDisplayLabel("custom_agent_event");
    expect(label).toBe("custom agent event");
  });

  it("handles all agent event types safely", () => {
    const types = [
      "created", "status_change", "case_observed", "case_version_changed",
      "plan_created", "plan_updated", "evidence_request_created",
      "evidence_request_fulfilled", "evidence_request_already_open",
      "agent_resumed_after_evidence", "agent_resumption_deferred",
      "agent_resumption_failed", "tool_execution_recovered",
      "tool_execution_recovery_failed",
    ];
    for (const t of types) {
      const label = getEventDisplayLabel(t);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
