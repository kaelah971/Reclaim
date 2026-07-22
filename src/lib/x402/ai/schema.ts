// ---------------------------------------------------------------------------
// I5: Structured AI case brief schema (Zod)
//
// Rejects outputs containing winner/verdict/final-decision/fabricated facts.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const aiCaseBriefSchema = z.object({
  briefId: z.string().min(1),
  generatedAt: z.string().min(1),
  paymentId: z.string().min(1),
  serviceVersion: z.string().min(1),
  generationMode: z.enum(["ai", "deterministic_fallback"]),
  provider: z.string().optional(),
  model: z.string().optional(),
  caseTitle: z.string().min(1).max(500),
  parties: z.object({
    client: z.object({ label: z.string(), address: z.string() }),
    worker: z.object({ label: z.string(), address: z.string() }),
  }),
  protectedAmount: z.string(),
  token: z.string(),
  network: z.string(),
  currentOnChainState: z.string(),
  agreementSummary: z.string(),
  clientClaim: z.string(),
  workerPosition: z.string().optional().nullable(),
  requestedOutcome: z.string(),
  evidenceInventory: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  timeline: z.array(z.object({ date: z.string(), description: z.string() })),
  undisputedFacts: z.array(z.string()),
  disputedFacts: z.array(z.string()),
  contradictions: z.array(z.string()).optional().nullable(),
  ambiguities: z.array(z.string()).optional().nullable(),
  proceduralIssues: z.array(z.string()).optional().nullable(),
  questionsForReviewer: z.array(z.string()),
  recommendedNextEvidence: z.array(z.string()).optional().nullable(),
  riskFlags: z.array(z.string()).optional().nullable(),
  confidenceNotes: z.string().optional().nullable(),
  limitations: z.string(),
});

export type AICaseBrief = z.infer<typeof aiCaseBriefSchema>;

// ---------------------------------------------------------------------------
// Forbidden field detection — reject output containing these
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
];

const FORBIDDEN_VALUE_PATTERNS = [
  /I recommend releasing funds to/i,
  /the contract should release to/i,
  /funds should be sent to 0x[a-fA-F0-9]/,
  /I declare the (client|worker) the winner/i,
  /this constitutes legal advice/i,
  /pursuant to \[laws?|statute|regulation\]/i,
];

/** Validate that AI output is a proper case brief without forbidden content. */
export function validateAIBrief(raw: unknown): AICaseBrief | null {
  const result = aiCaseBriefSchema.safeParse(raw);
  if (!result.success) return null;

  const brief = result.data;
  const serialized = JSON.stringify(brief).toLowerCase();

  for (const key of FORBIDDEN_KEYS) {
    if (key.toLowerCase() in brief || serialized.includes(`"${key.toLowerCase()}"`)) {
      return null;
    }
  }

  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialized)) return null;
  }

  return brief;
}

// ---------------------------------------------------------------------------
// Schema version for evolution tracking
// ---------------------------------------------------------------------------

export const AI_BRIEF_SCHEMA_VERSION = "1.0.0";
export const AI_PROMPT_VERSION = "1.0.0";
