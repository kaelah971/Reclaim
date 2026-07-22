// ---------------------------------------------------------------------------
// I5: AI case brief generation orchestrator
//
// Coordinates AI provider, schema validation, fallback, and error handling.
// ---------------------------------------------------------------------------

import { getAIProvider, isAIConfigured, DeterministicFallbackProvider } from "./providers";
import { validateAIBrief, AI_BRIEF_SCHEMA_VERSION, AI_PROMPT_VERSION } from "./schema";
import { buildAICaseContext } from "./context";
import type { BuildContextInput } from "./context";
import type { AICaseContext, GenerationMode, AIGenerationMetadata } from "./types";
import type { AICaseBrief } from "./schema";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface AIGenerationResult {
  brief: AICaseBrief;
  metadata: AIGenerationMetadata;
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateAICaseBrief(
  input: BuildContextInput,
  correlationId: string,
  preferAI = true,
): Promise<AIGenerationResult> {
  const startedAt = new Date().toISOString();

  // Build verified context from on-chain data
  const context = await buildAICaseContext(input);
  if (!context) {
    // On-chain read failed — fall back to deterministic
    console.log(`[ai/generate][${correlationId}] On-chain context build failed — using deterministic fallback`);
    const fallback = new DeterministicFallbackProvider();
    const result = await fallback.generateCaseBrief({ ...input as unknown as AICaseContext }, correlationId);
    return wrapResult(result, startedAt);
  }

  const provider = getAIProvider();

  // If AI is not configured or not preferred, use fallback directly
  if (!preferAI || !isAIConfigured()) {
    console.log(`[ai/generate][${correlationId}] AI not configured — using deterministic fallback`);
    const result = await provider.generateCaseBrief(context, correlationId);
    return wrapResult(result, startedAt);
  }

  try {
    console.log(`[ai/generate][${correlationId}] Starting AI generation (${provider.id}/${provider.label})`);
    const result = await provider.generateCaseBrief(context, correlationId);

    // Ensure proper metadata on the brief
    const enrichedBrief: AICaseBrief = {
      ...result.brief,
      generationMode: "ai",
      provider: result.provider,
      model: result.model,
    };

    const valid = validateAIBrief(enrichedBrief);
    if (!valid) {
      throw { code: "SCHEMA_VALIDATION_FAILED", message: "Enriched brief failed validation", retryable: false };
    }

    return {
      brief: enrichedBrief,
      metadata: {
        generationMode: "ai",
        provider: result.provider,
        model: result.model,
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_BRIEF_SCHEMA_VERSION,
        generationStartedAt: startedAt,
        generationCompletedAt: new Date().toISOString(),
        attemptCount: result.attemptCount,
      },
      usedFallback: false,
    };
  } catch (err) {
    const error = err as { code?: string; message?: string };
    const errorCode = error.code || "AI_GENERATION_FAILED";
    const errorMessage = error.message || "Unknown error";
    console.error(`[ai/generate][${correlationId}] AI generation failed (${errorCode}): ${errorMessage}`);

    // Fall back to deterministic
    try {
      console.log(`[ai/generate][${correlationId}] Falling back to deterministic generator`);
      const fallback = new DeterministicFallbackProvider();
      const result = await fallback.generateCaseBrief(context, correlationId);
      const fallbackBrief: AICaseBrief = {
        ...result.brief,
        generationMode: "deterministic_fallback",
        provider: "deterministic",
        model: "none",
      };

      return {
        brief: fallbackBrief,
        metadata: {
          generationMode: "deterministic_fallback",
          provider: "deterministic",
          model: "none",
          promptVersion: AI_PROMPT_VERSION,
          schemaVersion: AI_BRIEF_SCHEMA_VERSION,
          generationStartedAt: startedAt,
          generationCompletedAt: new Date().toISOString(),
          attemptCount: 1,
          errorCode,
          errorMessage: errorMessage.slice(0, 500),
        },
        usedFallback: true,
      };
    } catch (fallbackErr) {
      const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown fallback error";
      throw new Error(`Both AI and deterministic fallback failed. AI error: ${errorMessage}. Fallback error: ${fbMsg}`);
    }
  }
}

function wrapResult(
  result: { brief: AICaseBrief; generationMode: GenerationMode; provider: string; model: string; attemptCount: number; errorCode?: string },
  startedAt: string,
): AIGenerationResult {
  return {
    brief: {
      ...result.brief,
      generationMode: result.generationMode,
      provider: result.provider,
      model: result.model,
    },
    metadata: {
      generationMode: result.generationMode,
      provider: result.provider,
      model: result.model,
      promptVersion: AI_PROMPT_VERSION,
      schemaVersion: AI_BRIEF_SCHEMA_VERSION,
      generationStartedAt: startedAt,
      generationCompletedAt: new Date().toISOString(),
      attemptCount: result.attemptCount,
      errorCode: result.errorCode,
    },
    usedFallback: result.generationMode === "deterministic_fallback",
  };
}
