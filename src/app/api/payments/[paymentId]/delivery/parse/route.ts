// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/delivery/parse — delivery parser (P6.3).
//
// Body: { message, draft?, messagesText?, paymentContext: { chainId, worker,
//   deliverables?, evidenceRequirements?, agreementLabel? } }
// Returns: { ok, draft, missingFields, clarifyingQuestion, ready, rejected,
//   boundaryMessage, errors, paymentId, chainId, worker, aiUnavailable }
//
// READ-ONLY BY DESIGN: no signing, no mutation, no transaction broadcast.
// Model output is schema-parsed + deterministically validated + grounded;
// ungrounded URLs are dropped. AI unavailable → 200 with aiUnavailable:true
// (deterministic draft still useful; never 503 here).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { parseDelivery } from "@/lib/delivery/parseDelivery";
import { deliveryIntentDraftSchema } from "@/lib/delivery/deliveryIntent";
import { enrichDeliveryWithAI } from "@/lib/delivery/aiDeliveryEnricher";

const WORKER_RE = /^0x[0-9a-fA-F]{40}$/;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const { paymentId } = await params;

  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return NextResponse.json(
      { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
      { status: 400 },
    );
  }

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
    paymentContext?: unknown;
  };

  if (
    typeof input.message !== "string" ||
    input.message.trim().length === 0
  ) {
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
    const parsed = deliveryIntentDraftSchema.safeParse(input.draft);
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

  if (!input.paymentContext || typeof input.paymentContext !== "object") {
    return NextResponse.json(
      { error: "Payment context is required.", code: "PAYMENT_CONTEXT_REQUIRED" },
      { status: 400 },
    );
  }
  const pc = input.paymentContext as Record<string, unknown>;

  if (pc.chainId !== 42220 && pc.chainId !== 11142220) {
    return NextResponse.json(
      { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
      { status: 400 },
    );
  }
  if (typeof pc.worker !== "string" || !WORKER_RE.test(pc.worker)) {
    return NextResponse.json(
      { error: "Invalid worker address.", code: "INVALID_WORKER" },
      { status: 400 },
    );
  }

  const deliverables: string[] =
    pc.deliverables === undefined ? [] : (pc.deliverables as string[]);
  const evidenceRequirements: string[] =
    pc.evidenceRequirements === undefined
      ? []
      : (pc.evidenceRequirements as string[]);

  if (pc.deliverables !== undefined) {
    if (
      !isStringArray(deliverables) ||
      deliverables.length > 8 ||
      deliverables.some((s) => s.length > 160)
    ) {
      return NextResponse.json(
        { error: "Invalid deliverables.", code: "INVALID_DELIVERABLES" },
        { status: 400 },
      );
    }
  }
  if (pc.evidenceRequirements !== undefined) {
    if (
      !isStringArray(evidenceRequirements) ||
      evidenceRequirements.length > 8 ||
      evidenceRequirements.some((s) => s.length > 160)
    ) {
      return NextResponse.json(
        {
          error: "Invalid evidence requirements.",
          code: "INVALID_EVIDENCE_REQUIREMENTS",
        },
        { status: 400 },
      );
    }
  }

  let agreementLabel: string | undefined;
  if (pc.agreementLabel !== undefined) {
    if (typeof pc.agreementLabel !== "string") {
      return NextResponse.json(
        { error: "Invalid agreement label.", code: "INVALID_AGREEMENT_LABEL" },
        { status: 400 },
      );
    }
    agreementLabel = pc.agreementLabel.slice(0, 200);
  }

  const correlationId =
    request.headers.get("x-correlation-id") ?? randomUUID();

  try {
    const result = await parseDelivery({
      message: input.message,
      priorDraft,
      priorMessagesText,
      paymentContext: {
        paymentId,
        chainId: pc.chainId as number,
        worker: pc.worker as string,
        deliverables,
        evidenceRequirements,
        agreementLabel,
      },
      aiEnrich: (msg, draft, contextLabel) =>
        enrichDeliveryWithAI(msg, draft, contextLabel, correlationId),
    });

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
        paymentId,
        chainId: pc.chainId,
        worker: pc.worker,
        aiUnavailable: result.aiUnavailable,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[delivery/parse]", err);
    return NextResponse.json(
      { error: "Failed to interpret the delivery.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
