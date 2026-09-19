// ---------------------------------------------------------------------------
// P6.2 — DeliveryEvaluation schema + deterministic helpers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  deliveryEvaluationSchema,
  deadlineStatusFor,
  deriveReleaseMode,
  isEvaluableState,
  recommendationFor,
  recommendationLabel,
} from "../deliveryEvaluation";

describe("P6.2 evaluation schema", () => {
  it("accepts a well-formed advisory evaluation", () => {
    const parsed = deliveryEvaluationSchema.safeParse({
      paymentId: "9",
      chainId: 42220,
      recommendation: "ready_for_review",
      summary: "The delivery matches the agreed requirements.",
      requirements: [
        { requirement: "Logo design", status: "satisfied", evidence: "delivery text present" },
      ],
      deadlineStatus: "on_time",
      concerns: [],
      confidence: "high",
      evaluatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it("never uses authorization names (advisory only)", async () => {
    const { EVALUATION_RECOMMENDATIONS } = await import("../deliveryEvaluation");
    expect([...EVALUATION_RECOMMENDATIONS]).toEqual([
      "ready_for_review",
      "needs_attention",
      "insufficient_evidence",
    ]);
    const parsed = deliveryEvaluationSchema.safeParse({
      paymentId: "9",
      chainId: 42220,
      recommendation: "approved",
      summary: "x",
      requirements: [{ requirement: "r", status: "satisfied", evidence: "e" }],
      deadlineStatus: "on_time",
      concerns: [],
      confidence: "high",
      evaluatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });

  it("derives release mode (manual stays manual, everything else assists)", () => {
    expect(deriveReleaseMode("manual")).toBe("manual");
    expect(deriveReleaseMode("Manual")).toBe("manual");
    expect(deriveReleaseMode("buyer-approval")).toBe("agent_assisted");
    expect(deriveReleaseMode("auto-release")).toBe("agent_assisted");
    expect(deriveReleaseMode(null)).toBe("agent_assisted");
    expect(deriveReleaseMode(undefined)).toBe("agent_assisted");
  });

  it("gates evaluable states", () => {
    expect(isEvaluableState("DeliverySubmitted")).toBe(true);
    expect(isEvaluableState("ReleaseRequested")).toBe(true);
    expect(isEvaluableState("Accepted")).toBe(false);
    expect(isEvaluableState("Released")).toBe(false);
    expect(isEvaluableState("Funded")).toBe(false);
  });

  it("computes deadline facts deterministically", () => {
    expect(deadlineStatusFor(1000n, 2000n)).toBe("on_time");
    expect(deadlineStatusFor(3000n, 2000n)).toBe("late");
    expect(deadlineStatusFor(0n, 2000n)).toBe("unknown");
    expect(deadlineStatusFor(1000n, 0n)).toBe("unknown");
    expect(deadlineStatusFor(undefined, undefined)).toBe("unknown");
  });

  it("recommends from facts (missing → insufficient, unclear/late → attention)", () => {
    const sat = [{ requirement: "Logo", status: "satisfied" as const, evidence: "text" }];
    expect(recommendationFor(sat, "on_time")).toBe("ready_for_review");
    expect(
      recommendationFor(
        [{ requirement: "Logo", status: "unclear" as const, evidence: "?" }],
        "on_time",
      ),
    ).toBe("needs_attention");
    expect(
      recommendationFor(
        [{ requirement: "Logo", status: "missing" as const, evidence: "none" }],
        "on_time",
      ),
    ).toBe("insufficient_evidence");
    expect(recommendationFor(sat, "late")).toBe("needs_attention");
  });

  it("labels recommendations without authorization language", () => {
    expect(recommendationLabel("ready_for_review")).toBe("Ready for review");
    expect(recommendationLabel("needs_attention")).toBe("Needs attention");
    expect(recommendationLabel("insufficient_evidence")).toBe("Insufficient evidence");
  });
});
