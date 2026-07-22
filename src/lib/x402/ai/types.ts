// ---------------------------------------------------------------------------
// I5: AI dispute case brief types
// ---------------------------------------------------------------------------

export type GenerationMode = "ai" | "deterministic_fallback";

export type AIProviderId = "deepseek" | "openai" | "anthropic" | "deterministic";

export interface AIGenerationMetadata {
  generationMode: GenerationMode;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  generationStartedAt: string;
  generationCompletedAt: string;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface AICaseContext {
  paymentId: string;
  disputeReason: string;
  requestedOutcome: string;
  clientAddress: string;
  workerAddress: string;
  protectedAmount: string;
  token: string;
  network: string;
  currentOnChainState: string;
  agreementLabel: string;
  deliverableSummary: string;
  releaseRule: string;
  deliveryDeadline: string;
  evidenceReferences: string[];
  timelineEntries: { date: string; description: string }[];
  additionalContext?: string;
}

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AIProviderError {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
}
