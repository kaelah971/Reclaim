// ---------------------------------------------------------------------------
// POST /api/command/parse — Reclaim Command parser (P6.1, READ-ONLY).
//
// Body: { message: string, draft?: PaymentIntentDraft, messagesText?: string }
// Returns: { ok, draft, missingFields, clarifyingQuestion, ready, rejected,
//   boundaryMessage, errors } — STRICT structured draft only.
//
// READ-ONLY BY DESIGN: no signing, no mutation, no transaction broadcast.
// Model output is schema-parsed + deterministically validated + grounded;
// ungrounded financial fields are dropped. AI unavailable → honest 503.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { parsePaymentCommand } from "@/lib/command/parseCommand";
import { paymentIntentDraftSchema } from "@/lib/command/paymentIntent";
import { COMMAND_AI_UNAVAILABLE_MESSAGE } from "@/lib/command/paymentIntent";
import { enrichCommandWithAI } from "@/lib/command/aiEnricher";

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body.", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const input = body as {
    message?: unknown;
    draft?: unknown;
    messagesText?: unknown;
  };
  if (typeof input.message !== "string" || input.message.trim() === "") {
    return NextResponse.json(
      { error: "A message is required.", code: "MESSAGE_REQUIRED" },
      { status: 400 },
    );
  }
  if (input.message.length > 2000) {
    return NextResponse.json(
      { error: "Message too long.", code: "MESSAGE_TOO_LONG" },
      { status: 400 },
    );
  }

  let priorDraft = {};
  if (input.draft !== undefined) {
    const parsed = paymentIntentDraftSchema.safeParse(input.draft);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid prior draft.", code: "INVALID_DRAFT" },
        { status: 400 },
      );
    }
    priorDraft = parsed.data;
  }
  const priorMessagesText =
    typeof input.messagesText === "string" ? input.messagesText : "";

  const correlationId =
    request.headers.get("x-correlation-id") ?? randomUUID();

  try {
    const result = await parsePaymentCommand({
      message: input.message,
      priorDraft,
      priorMessagesText,
      aiEnrich: (msg, draft) => enrichCommandWithAI(msg, draft, correlationId),
    });

    if (result.aiUnavailable) {
      return NextResponse.json(
        {
          ok: false,
          error: COMMAND_AI_UNAVAILABLE_MESSAGE,
          code: "AI_UNAVAILABLE",
          draft: result.draft,
          missingFields: result.missingFields,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        draft: result.draft,
        missingFields: result.missingFields,
        clarifyingQuestion: result.clarifyingQuestion,
        ready: result.ready,
        rejected: result.rejected,
        boundaryMessage: result.boundaryMessage,
        errors: result.errors,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[command/parse]", err);
    return NextResponse.json(
      { error: "Failed to interpret the command.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
