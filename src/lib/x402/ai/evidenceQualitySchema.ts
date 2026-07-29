// ---------------------------------------------------------------------------
// Evidence quality assessment schema (Zod)
//
// Validates AI-generated evidence quality analysis output.
// Rejects forbidden adjudication content and hallucinated facts.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema version constants
// ---------------------------------------------------------------------------

export const EVIDENCE_QUALITY_SCHEMA_VERSION = "1.0.0";
export const EVIDENCE_QUALITY_PROMPT_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Core assessment schema
// ---------------------------------------------------------------------------

export const evidenceQualityResultSchema = z.object({
  overallAssessment: z.string().min(1, "overallAssessment is required"),
  readiness: z.enum(["ready", "needs-improvement", "insufficient"]),
  completenessScore: z.number().int().min(0).max(100),
  relevanceScore: z.number().int().min(0).max(100),
  specificityScore: z.number().int().min(0).max(100),
  consistencyScore: z.number().int().min(0).max(100),
  strengths: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  ambiguities: z.array(z.string()),
  contradictionsOrRisks: z.array(z.string()),
  claimAlignment: z.array(z.string()),
  recommendedImprovements: z.array(z.string()),
  reviewerQuestions: z.array(z.string()),

  // Disclaimer must contain non-adjudication language
  disclaimer: z.string().refine(
    (val) => /does not determine/i.test(val) || /does not (decide|resolve|adjudicate|constitute)/i.test(val),
    { message: "disclaimer must contain non-adjudication language (e.g. 'does not determine')" },
  ),
});

/** Inferred type from the Zod schema for the core assessment output. */
export type EvidenceQualityAssessment = z.infer<typeof evidenceQualityResultSchema>;

// ---------------------------------------------------------------------------
// Full result type (includes metadata beyond the AI output)
// ---------------------------------------------------------------------------

export interface EvidenceQualityResult {
  // Core assessment fields (from AI or deterministic)
  overallAssessment: string;
  readiness: "ready" | "needs-improvement" | "insufficient";
  completenessScore: number;
  relevanceScore: number;
  specificityScore: number;
  consistencyScore: number;
  strengths: string[];
  missingEvidence: string[];
  ambiguities: string[];
  contradictionsOrRisks: string[];
  claimAlignment: string[];
  recommendedImprovements: string[];
  reviewerQuestions: string[];
  disclaimer: string;

  // Generation metadata
  generationMode: string;
  provider: string;
  model: string;
  serviceVersion: string;
  generatedAt: string;

  // Optional tracking
  correlationId?: string;
  evidenceId?: string;
  attemptCount?: number;
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// Forbidden field detection
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = [
  "winner",
  "verdict",
  "finalDecision",
  "releaseToClient",
  "releaseToWorker",
  "settlementInstruction",
  "legalAdvice",
  "fabricatedFacts",
  "outcomeScore",
  "probability",
  "autoRelease",
  "fraud",
  "workerWins",
  "clientWins",
  "true_or_false",
  "truth_determination",
];

const FORBIDDEN_VALUE_PATTERNS = [
  /I recommend releasing funds to/i,
  /the contract should release to/i,
  /funds should be sent to 0x[a-fA-F0-9]/,
  /I declare the (client|worker) the winner/i,
  /this constitutes legal advice/i,
  /pursuant to \[laws?|statute|regulation\]/i,
  /the evidence proves/i,
  /the claim is (true|false)/i,
  /fraud(ulent)?/i,
];

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

/**
 * Validate that a raw object (typically from AI output) conforms to the
 * evidence quality schema AND contains no forbidden adjudication content.
 *
 * Returns a validated EvidenceQualityResult on success, or null if the
 * object failed schema validation or contains forbidden content.
 */
export function validateEvidenceQualityResult(raw: unknown): EvidenceQualityResult | null {
  // 1) Schema validation
  const result = evidenceQualityResultSchema.safeParse(raw);
  if (!result.success) {
    console.warn("[evidenceQualitySchema] Schema validation failed:", result.error.flatten());
    return null;
  }

  const data = result.data;

  // 2) Forbidden key detection — check top-level keys and serialized form
  const rawObj = raw as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) {
    if (key in rawObj) return null;
  }

  const serialized = JSON.stringify(data).toLowerCase();
  for (const key of FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key.toLowerCase()}"`)) return null;
  }

  // 3) Forbidden value pattern detection
  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialized)) return null;
  }

  return {
    ...data,
    // Placeholder metadata — caller is expected to overwrite these
    generationMode: "ai",
    provider: "",
    model: "",
    serviceVersion: `EQ-${EVIDENCE_QUALITY_SCHEMA_VERSION}`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Check whether a raw object passes the forbidden-content checks alone
 * (useful for pre-validation before schema parsing).
 */
export function hasForbiddenContent(raw: unknown): boolean {
  const serialized = JSON.stringify(raw).toLowerCase();

  const rawObj = raw as Record<string, unknown> | null;
  if (rawObj) {
    for (const key of FORBIDDEN_KEYS) {
      if (key in rawObj) return true;
    }
  }

  for (const key of FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key.toLowerCase()}"`)) return true;
  }

  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialized)) return true;
  }

  return false;
}
