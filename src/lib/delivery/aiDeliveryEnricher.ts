// ---------------------------------------------------------------------------
// Reclaim Delivery — AI semantic enricher (server only, P6.3).
//
// Wraps the existing structured-JSON provider (DeepSeek/OpenAI/Anthropic via
// src/lib/x402/ai/providers.ts) with a delivery-specific system prompt.
// Output is ALWAYS re-validated via the draft Zod schema and grounded
// verbatim in parseDelivery.ts — model text can never become trusted state.
//
// Unavailable provider → throws (parser fails honestly, never fabricates).
// ---------------------------------------------------------------------------

import { generateStructuredJSON } from "@/lib/x402/ai/providers";
import {
  deliveryIntentDraftSchema,
  type DeliveryIntentDraft,
} from "./deliveryIntent";

const DELIVERY_SYSTEM_PROMPT = [
  "You interpret Reclaim delivery messages into a STRICT JSON draft.",
  "Reclaim delivery chat handles delivery evidence, job status and payment readiness.",
  "",
  "Rules:",
  "- NEVER invent URLs: only include URLs that appear verbatim in the user message.",
  "- Classify an actual github.com URL as repository, otherwise url.",
  "- Summarize what the worker says they delivered (max 200 chars) in summary.",
  "- Map explicit worker statements to claimedDeliverables using verbatim phrases.",
  "- NEVER claim verification: do not say URLs were opened, files checked, policy satisfied, or dates confirmed.",
  "- evidenceType must be one of: delivery-file, message, revision-record, agreement-reference, payment-reference, other.",
  "- NEVER invent deliveryDate: omit it (the parser sets it at packaging).",
  "- If the message is not about a delivery, return {}.",
  "",
  "Return ONLY this JSON shape (all fields optional, no extra keys):",
  '{"summary":"...","references":[{"type":"url|repository|file_reference|text|other","value":"...","label":"..."}],"notes":"...","claimedDeliverables":["..."],"confidence":"high|medium|low","title":"...","description":"...","evidenceType":"delivery-file|message|revision-record|agreement-reference|payment-reference|other","relatedDeliverable":"...","pastedText":"...","externalRef":"..."}',
].join("\n");

export async function enrichDeliveryWithAI(
  message: string,
  priorDraft: DeliveryIntentDraft,
  contextLabel: string,
  correlationId: string,
): Promise<DeliveryIntentDraft | null> {
  const user = [
    `Payment context: ${contextLabel}`,
    `Prior draft (preserve, fill gaps): ${JSON.stringify(priorDraft)}`,
    `User message: ${message}`,
  ].join("\n");
  const raw = await generateStructuredJSON(
    DELIVERY_SYSTEM_PROMPT,
    user,
    correlationId,
  );
  const parsed = deliveryIntentDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
