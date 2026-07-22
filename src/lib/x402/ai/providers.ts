// ---------------------------------------------------------------------------
// I5: AI Provider Abstraction
//
// Server-only. Supports: DeepSeek, OpenAI, Anthropic, deterministic fallback.
// Never exposes API keys.
// ---------------------------------------------------------------------------

import type { AICaseContext, AIProviderConfig, AIProviderError, GenerationMode } from "./types";
import type { AICaseBrief } from "./schema";
import { validateAIBrief } from "./schema";
import { buildPrompt } from "./prompt";
import { generateDisputeBrief } from "../disputeBrief";
import type { DisputeBriefRequestInput } from "../validation";
import type { PaymentData } from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface DisputeBriefAIProvider {
  readonly id: string;
  readonly label: string;
  generateCaseBrief(context: AICaseContext, correlationId: string): Promise<AIBriefResult>;
}

export interface AIBriefResult {
  brief: AICaseBrief;
  generationMode: GenerationMode;
  provider: string;
  model: string;
  attemptCount: number;
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// Deterministic fallback provider (always available)
// ---------------------------------------------------------------------------

export class DeterministicFallbackProvider implements DisputeBriefAIProvider {
  readonly id = "deterministic";
  readonly label = "Deterministic (no AI)";

  async generateCaseBrief(context: AICaseContext, _correlationId: string): Promise<AIBriefResult> {
    const request: DisputeBriefRequestInput = {
      paymentId: context.paymentId,
      disputeReason: context.disputeReason,
      requestedOutcome: context.requestedOutcome,
      clientAddress: context.clientAddress,
      workerAddress: context.workerAddress,
      protectedAmount: context.protectedAmount,
      evidenceReferences: context.evidenceReferences,
      relevantTimelineEntries: context.timelineEntries,
      agreementTitle: context.agreementLabel,
      releaseTerms: context.releaseRule,
      agreedDeliverables: context.deliverableSummary,
    };

    const paymentData: PaymentData = {
      id: BigInt(context.paymentId),
      client: context.clientAddress,
      worker: context.workerAddress,
      token: context.token as `0x${string}`,
      amount: BigInt(0),
      agreementLabel: context.agreementLabel,
      deliverableSummary: context.deliverableSummary,
      deliveryFormat: "",
      releaseRule: context.releaseRule,
      evidenceExpectation: "",
      termsHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      evidenceReference: "",
      disputeReference: "",
      deliveryDeadline: BigInt(0),
      autoReleaseSeconds: BigInt(0),
      disputeWindowSeconds: BigInt(0),
      state: context.currentOnChainState as PaymentData["state"],
      createdAt: BigInt(0),
      fundedAt: BigInt(0),
      acceptedAt: BigInt(0),
      deliveryAt: BigInt(0),
      releaseRequestedAt: BigInt(0),
      releasedAt: BigInt(0),
    };

    const deterministicBrief = generateDisputeBrief(request, paymentData);

    const brief: AICaseBrief = {
      briefId: deterministicBrief.briefId,
      generatedAt: deterministicBrief.generatedTimestamp,
      paymentId: context.paymentId,
      serviceVersion: "I5-fallback",
      generationMode: "deterministic_fallback",
      caseTitle: deterministicBrief.neutralCaseTitle,
      parties: {
        client: deterministicBrief.parties.client,
        worker: deterministicBrief.parties.worker,
      },
      protectedAmount: deterministicBrief.protectedAmount,
      token: context.token,
      network: context.network,
      currentOnChainState: deterministicBrief.currentOnChainState,
      agreementSummary: deterministicBrief.agreementSummary,
      clientClaim: deterministicBrief.claimedIssue,
      workerPosition: null,
      requestedOutcome: deterministicBrief.requestedOutcome,
      evidenceInventory: deterministicBrief.evidenceInventory,
      missingEvidence: deterministicBrief.missingEvidence,
      timeline: deterministicBrief.timeline,
      undisputedFacts: deterministicBrief.undisputedFacts,
      disputedFacts: deterministicBrief.disputedFacts,
      contradictions: null,
      ambiguities: null,
      proceduralIssues: null,
      questionsForReviewer: deterministicBrief.questionsRequiringHumanReview,
      recommendedNextEvidence: null,
      riskFlags: null,
      confidenceNotes: null,
      limitations: deterministicBrief.limitationsStatement,
    };

    return { brief, generationMode: "deterministic_fallback", provider: "deterministic", model: "none", attemptCount: 1 };
  }
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

class OpenAIProvider implements DisputeBriefAIProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async generateCaseBrief(context: AICaseContext, correlationId: string): Promise<AIBriefResult> {
    const { systemPrompt, userMessage } = buildPrompt(context);
    let lastError: AIProviderError | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 4000,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const status = response.status;
          const body = await response.text().catch(() => "");
          lastError = {
            code: `OPENAI_HTTP_${status}`,
            message: body.slice(0, 200),
            retryable: status === 429 || status >= 500,
            statusCode: status,
          };
          if (!lastError.retryable) break;
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const data = await response.json() as Record<string, unknown>;
        const content = (data as { choices?: Array<{ message?: { content?: string } }> })
          .choices?.[0]?.message?.content;

        if (!content) {
          lastError = { code: "OPENAI_EMPTY_RESPONSE", message: "No content in response", retryable: false };
          break;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          lastError = { code: "OPENAI_INVALID_JSON", message: "Response is not valid JSON", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const brief = validateAIBrief(parsed);
        if (!brief) {
          lastError = { code: "SCHEMA_VALIDATION_FAILED", message: "Output failed schema validation", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        return {
          brief: { ...brief, generationMode: "ai", provider: "openai", model: this.config.model, serviceVersion: "I5-openai" },
          generationMode: "ai",
          provider: "openai",
          model: this.config.model,
          attemptCount: attempt,
        };

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if ((err as { name?: string }).name === "AbortError") {
          lastError = { code: "OPENAI_TIMEOUT", message: `Timed out after ${this.config.timeoutMs}ms`, retryable: true };
        } else {
          lastError = { code: "OPENAI_NETWORK_ERROR", message, retryable: true };
        }
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw lastError ?? { code: "OPENAI_UNKNOWN", message: "Unknown error", retryable: false };
  }
}

// ---------------------------------------------------------------------------
// Anthropic provider
// ---------------------------------------------------------------------------

class AnthropicProvider implements DisputeBriefAIProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async generateCaseBrief(context: AICaseContext, correlationId: string): Promise<AIBriefResult> {
    const { systemPrompt, userMessage } = buildPrompt(context);
    let lastError: AIProviderError | undefined;

    const schemaInstruction =
      "\n\nIMPORTANT: Return ONLY a valid JSON object. No markdown, no explanation, no code fences.";

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.config.model,
            system: systemPrompt,
            max_tokens: 4000,
            messages: [
              { role: "user", content: userMessage + schemaInstruction },
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const status = response.status;
          const body = await response.text().catch(() => "");
          lastError = {
            code: `ANTHROPIC_HTTP_${status}`,
            message: body.slice(0, 200),
            retryable: status === 429 || status >= 500,
            statusCode: status,
          };
          if (!lastError.retryable) break;
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const data = await response.json() as Record<string, unknown>;
        const content = (data as { content?: Array<{ type: string; text: string }> })
          .content?.find((c) => c.type === "text")?.text;

        if (!content) {
          lastError = { code: "ANTHROPIC_EMPTY_RESPONSE", message: "No content in response", retryable: false };
          break;
        }

        // Strip markdown code fences if present
        let jsonContent = content.trim();
        if (jsonContent.startsWith("```")) {
          jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonContent);
        } catch {
          lastError = { code: "ANTHROPIC_INVALID_JSON", message: "Response is not valid JSON", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const brief = validateAIBrief(parsed);
        if (!brief) {
          lastError = { code: "SCHEMA_VALIDATION_FAILED", message: "Output failed schema validation", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        return {
          brief: { ...brief, generationMode: "ai", provider: "anthropic", model: this.config.model, serviceVersion: "I5-anthropic" },
          generationMode: "ai",
          provider: "anthropic",
          model: this.config.model,
          attemptCount: attempt,
        };

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if ((err as { name?: string }).name === "AbortError") {
          lastError = { code: "ANTHROPIC_TIMEOUT", message: `Timed out after ${this.config.timeoutMs}ms`, retryable: true };
        } else {
          lastError = { code: "ANTHROPIC_NETWORK_ERROR", message, retryable: true };
        }
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw lastError ?? { code: "ANTHROPIC_UNKNOWN", message: "Unknown error", retryable: false };
  }
}

// ---------------------------------------------------------------------------
// DeepSeek provider — Reclaim's recommended AI provider
// ---------------------------------------------------------------------------

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export class DeepSeekProvider implements DisputeBriefAIProvider {
  readonly id = "deepseek";
  readonly label = "DeepSeek";
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async generateCaseBrief(context: AICaseContext, correlationId: string): Promise<AIBriefResult> {
    const { systemPrompt, userMessage } = buildPrompt(context);
    let lastError: AIProviderError | undefined;

    const jsonInstruction =
      "\n\nReturn ONLY a valid JSON object matching the schema. No markdown, no code fences, no explanation.";

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage + jsonInstruction },
            ],
            temperature: 0.3,
            max_tokens: 4000,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const status = response.status;
          const body = await response.text().catch(() => "");

          // Sanitize error body — strip any potential API key leaks
          const safeBody = body
            .replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]")
            .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
            .slice(0, 200);

          const retryable =
            status === 429 ||     // rate limit
            status === 503 ||     // service unavailable
            status >= 500;        // server errors

          lastError = {
            code: `DEEPSEEK_HTTP_${status}`,
            message: safeBody,
            retryable,
            statusCode: status,
          };

          // 401, 402, 422 are non-retryable
          if (!retryable) break;
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const data = await response.json() as Record<string, unknown>;
        const content = (data as { choices?: Array<{ message?: { content?: string } }> })
          .choices?.[0]?.message?.content;

        if (!content) {
          lastError = { code: "DEEPSEEK_EMPTY_RESPONSE", message: "No content in response", retryable: false };
          break;
        }

        // Strip markdown code fences if present
        let jsonContent = content.trim();
        if (jsonContent.startsWith("```")) {
          jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonContent);
        } catch {
          lastError = { code: "DEEPSEEK_INVALID_JSON", message: "Response is not valid JSON", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        const brief = validateAIBrief(parsed);
        if (!brief) {
          lastError = { code: "SCHEMA_VALIDATION_FAILED", message: "Output failed schema validation", retryable: true };
          if (attempt < this.config.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          continue;
        }

        return {
          brief: {
            ...brief,
            generationMode: "ai",
            provider: "deepseek",
            model: this.config.model,
            serviceVersion: "I5-deepseek",
          },
          generationMode: "ai",
          provider: "deepseek",
          model: this.config.model,
          attemptCount: attempt,
        };

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if ((err as { name?: string }).name === "AbortError") {
          lastError = { code: "DEEPSEEK_TIMEOUT", message: `Timed out after ${this.config.timeoutMs}ms`, retryable: true };
        } else {
          lastError = { code: "DEEPSEEK_NETWORK_ERROR", message, retryable: true };
        }
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw lastError ?? { code: "DEEPSEEK_UNKNOWN", message: "Unknown error", retryable: false };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cachedProvider: DisputeBriefAIProvider | undefined;

export function getAIProvider(): DisputeBriefAIProvider {
  if (cachedProvider) return cachedProvider;

  const providerId = (process.env.AI_PROVIDER || "").toLowerCase();
  const apiKey = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL || "";

  const defaultConfig: AIProviderConfig = {
    apiKey,
    model: model || "deepseek-v4-pro",
    timeoutMs: 60000,
    maxRetries: 2,
  };

  if (providerId === "deepseek" && apiKey) {
    console.log("[ai/provider] Using DeepSeek provider");
    cachedProvider = new DeepSeekProvider({ ...defaultConfig, model: model || "deepseek-v4-pro" });
  } else if (providerId === "openai" && apiKey) {
    console.log("[ai/provider] Using OpenAI provider");
    cachedProvider = new OpenAIProvider({ ...defaultConfig, model: model || "gpt-4o" });
  } else if (providerId === "anthropic" && apiKey) {
    console.log("[ai/provider] Using Anthropic provider");
    cachedProvider = new AnthropicProvider({ ...defaultConfig, model: model || "claude-3-5-sonnet-20241022" });
  } else {
    console.log("[ai/provider] AI provider not configured — using deterministic fallback");
    cachedProvider = new DeterministicFallbackProvider();
  }

  return cachedProvider;
}

export function isAIConfigured(): boolean {
  const providerId = (process.env.AI_PROVIDER || "").toLowerCase();
  const apiKey = process.env.AI_API_KEY || "";
  return (providerId === "deepseek" || providerId === "openai" || providerId === "anthropic") && apiKey.length > 0;
}
