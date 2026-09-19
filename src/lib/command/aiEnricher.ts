// ---------------------------------------------------------------------------
// Reclaim Command — AI semantic enricher (server only, P6.1).
//
// Wraps the existing structured-JSON provider (DeepSeek/OpenAI/Anthropic via
// src/lib/x402/ai/providers.ts) with a command-specific system prompt. Output
// is ALWAYS re-validated via the draft Zod schema and grounded verbatim in
// parseCommand.ts — model text can never become trusted financial state.
//
// Unavailable provider → throws (route fails honestly, never fabricates).
// ---------------------------------------------------------------------------

import { generateStructuredJSON } from "@/lib/x402/ai/providers";
import {
  paymentIntentDraftSchema,
  type PaymentIntentDraft,
} from "./paymentIntent";

const COMMAND_SYSTEM_PROMPT = [
  "You interpret Reclaim protected-payment commands into a STRICT JSON draft.",
  "Reclaim protects freelance work payments on Celo (USA₮) with client-approved release.",
  "",
  "Rules:",
  "- NEVER invent: wallet address (0x...), amount, asset, deadline date, approval threshold, release authority.",
  "- Only include recipient/amount/asset/deadlineDate when stated verbatim in the user message.",
  "- You MAY infer low-risk context only: purpose, jobType, recipientName. NEVER invent file formats (SVG, PNG, JPG, Figma, PSD, source files, etc.), evidenceRequirements, reviewWindow, approvalThreshold, escalationPolicy, or other specifics — deliverables and evidence must use only explicit user wording; omit any specifics the user did not state.",
  "- releaseMode is 'manual' when the user wants approval ('ask me before releasing'), else 'agent_assisted' when they mention agent/AI help. NEVER output 'autopilot'.",
  "- chainId: 42220 default. Only 11142220 when the user explicitly says Sepolia/test.",
  "- deadlineDate must be YYYY-MM-DD or omitted. deadlineLabel keeps the user's words (e.g. 'Friday').",
  "- If the message is not about a protected work payment, return {}.",
  "",
  "Return ONLY this JSON shape (all fields optional, no extra keys):",
  '{"recipient":"0x...","recipientName":"...","amount":"50","asset":"USA₮","purpose":"...","jobType":"...","deliverables":["..."],"deadlineDate":"YYYY-MM-DD","deadlineLabel":"...","evidenceRequirements":["..."],"releaseMode":"manual|agent_assisted","reviewWindow":"...","approvalThreshold":"...","escalationPolicy":"...","chainId":42220}',
].join("\n");

export async function enrichCommandWithAI(
  message: string,
  priorDraft: PaymentIntentDraft,
  correlationId: string,
): Promise<PaymentIntentDraft | null> {
  const user = [
    `Prior draft (preserve, fill gaps): ${JSON.stringify(priorDraft)}`,
    `User message: ${message}`,
  ].join("\n");
  const raw = await generateStructuredJSON(
    COMMAND_SYSTEM_PROMPT,
    user,
    correlationId,
  );
  const parsed = paymentIntentDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
