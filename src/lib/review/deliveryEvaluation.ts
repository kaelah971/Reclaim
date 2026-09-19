// ---------------------------------------------------------------------------
// Agent-assisted delivery review — DeliveryEvaluation domain model (P6.2).
//
// CHAT UNDERSTANDS. POLICY DECIDES. AGENT EVALUATES. HUMAN AUTHORIZES.
// CONTRACT ENFORCES.
//
// The agent may recommend. The agent MUST NOT release funds. Recommendation
// names are advisory only — never "approved" / "rejected" /
// "release_authorized". The recommendation is computed DETERMINISTICALLY from
// requirement statuses + deadline facts; the model only grades individual
// requirements and writes prose. It cannot override deterministic failures.
//
// Durable sources (no new tables — computed on demand):
// - canonical on-chain payment (deliverableSummary, deliveryFormat,
//   releaseRule, evidenceExpectation, deliveryDeadline, deliveryAt,
//   evidenceReference, state)
// - verified evidence_metadata via SupabaseEvidenceReader (party-authorized)
// ---------------------------------------------------------------------------

import { z } from "zod";

/** Advisory recommendation. Never an authorization decision. */
export const EVALUATION_RECOMMENDATIONS = [
  "ready_for_review",
  "needs_attention",
  "insufficient_evidence",
] as const;
export type EvaluationRecommendation =
  (typeof EVALUATION_RECOMMENDATIONS)[number];

export const REQUIREMENT_STATUSES = ["satisfied", "unclear", "missing"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const DEADLINE_STATUSES = ["on_time", "late", "unknown"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const EVALUATION_CONFIDENCES = ["high", "medium", "low"] as const;
export type EvaluationConfidence = (typeof EVALUATION_CONFIDENCES)[number];

export const evaluationRequirementSchema = z
  .object({
    requirement: z.string().min(1).max(160),
    status: z.enum(REQUIREMENT_STATUSES),
    /** Non-plaintext descriptor only (e.g. "delivery text present"). */
    evidence: z.string().max(160),
  })
  .strict();

export type EvaluationRequirement = z.infer<typeof evaluationRequirementSchema>;

export const deliveryEvaluationSchema = z
  .object({
    paymentId: z.string().regex(/^\d+$/),
    chainId: z.number().int().positive(),
    recommendation: z.enum(EVALUATION_RECOMMENDATIONS),
    summary: z.string().min(1).max(600),
    requirements: z.array(evaluationRequirementSchema).min(1).max(8),
    deadlineStatus: z.enum(DEADLINE_STATUSES),
    concerns: z.array(z.string().max(240)).max(6),
    confidence: z.enum(EVALUATION_CONFIDENCES),
    evaluatedAt: z.string().datetime(),
  })
  .strict();

export type DeliveryEvaluation = z.infer<typeof deliveryEvaluationSchema>;

/** Release mode derived from the on-chain releaseRule (P6.1 mapping). */
export type DerivedReleaseMode = "manual" | "agent_assisted";

/**
 * Derive the review mode from the canonical on-chain releaseRule.
 * P6.1 maps manual → "manual" and agent_assisted → "buyer-approval"; every
 * other rule keeps agent assistance (approval-gated, never autopilot).
 */
export function deriveReleaseMode(releaseRule: string | null | undefined): DerivedReleaseMode {
  const normalized = (releaseRule ?? "").trim().toLowerCase();
  return normalized === "manual" ? "manual" : "agent_assisted";
}

/** States in which a delivery evaluation is meaningful. */
export function isEvaluableState(state: string | null | undefined): boolean {
  return state === "DeliverySubmitted" || state === "ReleaseRequested";
}

/** Deterministic deadline fact: deliveryAt vs deliveryDeadline (unix sec). */
export function deadlineStatusFor(
  deliveryAt: bigint | number | null | undefined,
  deliveryDeadline: bigint | number | null | undefined,
): DeadlineStatus {
  const at = deliveryAt === null || deliveryAt === undefined ? 0n : BigInt(deliveryAt);
  const deadline =
    deliveryDeadline === null || deliveryDeadline === undefined
      ? 0n
      : BigInt(deliveryDeadline);
  if (at <= 0n || deadline <= 0n) return "unknown";
  return at <= deadline ? "on_time" : "late";
}

/** Advisory recommendation from graded requirements + deadline fact. */
export function recommendationFor(
  requirements: EvaluationRequirement[],
  deadlineStatus: DeadlineStatus,
): EvaluationRecommendation {
  if (requirements.some((r) => r.status === "missing")) {
    return "insufficient_evidence";
  }
  if (requirements.some((r) => r.status === "unclear")) {
    return "needs_attention";
  }
  if (deadlineStatus === "late") return "needs_attention";
  return "ready_for_review";
}

/** Human-readable recommendation label for UI (advisory wording only). */
export function recommendationLabel(
  recommendation: EvaluationRecommendation,
): string {
  switch (recommendation) {
    case "ready_for_review":
      return "Ready for review";
    case "needs_attention":
      return "Needs attention";
    case "insufficient_evidence":
      return "Insufficient evidence";
  }
}

export const EVALUATION_UNAVAILABLE_MESSAGE =
  "Reclaim could not review this delivery right now. Please inspect the delivery evidence directly — nothing was decided.";
