// ---------------------------------------------------------------------------
// Agent-assisted delivery review — AI grading layer (server only, P6.2).
//
// The model grades individual requirements against the submitted delivery
// manifest and writes prose. It does NOT choose the recommendation, the
// deadline status, or any transaction data — those are deterministic. Output
// is schema-validated and grounded; ungrounded grades are dropped.
//
// Rules enforced on the model:
// - missing evidence stays missing (only satisfied|unclear may be returned)
// - uncertainty must be explicit (unclear, never guessed satisfied)
// - no claims of inspecting URLs/files (only the provided manifest fields)
// - no completion inferred merely because evidence exists
// - no transaction data, wallet actions, or on-chain writes
// ---------------------------------------------------------------------------

import { z } from "zod";
import { generateStructuredJSON } from "@/lib/x402/ai/providers";

export const aiRequirementGradeSchema = z
  .object({
    requirement: z.string().min(1).max(160),
    status: z.enum(["satisfied", "unclear"]),
    /** Short descriptor of which manifest signal supports the grade. */
    evidence: z.string().max(160),
  })
  .strict();

export const aiEvaluationOutputSchema = z
  .object({
    requirements: z.array(aiRequirementGradeSchema).min(1).max(8),
    summary: z.string().min(1).max(600),
    concerns: z.array(z.string().max(240)).max(6).default([]),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type AIEvaluationOutput = z.infer<typeof aiEvaluationOutputSchema>;

/** Deterministic facts handed to the model (manifest signals, no prose). */
export interface AIEvaluationContext {
  purpose: string;
  deliverables: string[];
  evidenceRequirements: string[];
  deadlineLabel: string;
  /** Agreed requirement labels the model must grade (1:1, no extras). */
  requirementLabels: string[];
  /** Manifest-derived signals the model may cite (never raw content). */
  manifestSignals: string[];
  deadlineStatus: string;
}

const EVALUATION_SYSTEM_PROMPT = [
  "You review a worker's delivery against agreed payment terms. You are ADVISORY ONLY: you never approve, reject, or authorize release.",
  "",
  "You receive agreed requirement labels, a deadline fact, and manifest signals describing what the delivery contains (text present, file hash present, external reference present, claim present). You do NOT receive file contents or URLs.",
  "",
  "Rules:",
  "- Grade EACH requirement in requirementLabels exactly once: 'satisfied' when a manifest signal clearly supports it, otherwise 'unclear'. Never invent a requirement. Never return 'missing' (the system handles that).",
  "- Uncertainty must be explicit: when in doubt, grade 'unclear'. Do not infer completion merely because evidence exists.",
  "- Never claim to have opened URLs, read files, or inspected content beyond the provided signals.",
  "- summary (1-3 sentences): how many requirements the delivery appears to meet. concerns: concrete gaps a human should check. Never quote delivery content.",
  "- confidence: 'high' only when every requirement is clearly supported; 'low' when key requirements are unclear.",
  "- No transaction data, wallet addresses, approvals, or release instructions.",
  "",
  "Return ONLY this JSON shape (no extra keys):",
  '{"requirements":[{"requirement":"...","status":"satisfied|unclear","evidence":"..."}],"summary":"...","concerns":["..."],"confidence":"high|medium|low"}',
].join("\n");

/** Real provider-backed grading. Throws when AI is unavailable. */
export async function completeEvaluationWithAI(
  context: AIEvaluationContext,
  correlationId: string,
): Promise<AIEvaluationOutput | null> {
  const user = [
    `Purpose: ${context.purpose || "—"}`,
    `Deliverables: ${context.deliverables.join("; ") || "—"}`,
    `Evidence requirements: ${context.evidenceRequirements.join("; ") || "—"}`,
    `Deadline: ${context.deadlineLabel} (fact: ${context.deadlineStatus})`,
    `Requirements to grade: ${JSON.stringify(context.requirementLabels)}`,
    `Manifest signals: ${context.manifestSignals.join("; ") || "none"}`,
  ].join("\n");
  const raw = await generateStructuredJSON(
    EVALUATION_SYSTEM_PROMPT,
    user,
    correlationId,
  );
  const parsed = aiEvaluationOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
