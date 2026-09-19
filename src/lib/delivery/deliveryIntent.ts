// ---------------------------------------------------------------------------
// Reclaim Delivery — delivery intent + package domain model (P6.3, server).
//
// CHAT UNDERSTANDS. POLICY DECIDES. CONTRACT ENFORCES.
//
// - DeliveryIntentDraft: STRICT structured draft the parser may produce.
//   Ambiguous values stay missing (never guessed). No URLs or deliverables
//   are invented.
// - DeliveryPackage: only validated values Reclaim can map into the existing
//   EvidenceFormData + Add-evidence flow — no second evidence architecture.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { EvidenceFormData } from "@/lib/evidence/manifest";

export const DELIVERY_REFERENCE_TYPES = [
  "url",
  "repository",
  "file_reference",
  "text",
  "other",
] as const;
export type DeliveryReferenceType =
  (typeof DELIVERY_REFERENCE_TYPES)[number];

export const deliveryReferenceSchema = z
  .object({
    type: z.enum(DELIVERY_REFERENCE_TYPES),
    value: z.string().min(1).max(2000),
    label: z.string().max(120).optional(),
  })
  .strict();
export type DeliveryReference = z.infer<typeof deliveryReferenceSchema>;

export const DELIVERY_EVIDENCE_TYPES = [
  "delivery-file",
  "message",
  "revision-record",
  "agreement-reference",
  "payment-reference",
  "other",
] as const;

export const deliveryIntentDraftSchema = z
  .object({
    summary: z.string().max(300).optional(),
    references: z.array(deliveryReferenceSchema).max(8).optional(),
    notes: z.string().max(1000).optional(),
    claimedDeliverables: z.array(z.string().max(120)).max(8).optional(),
    missingFields: z
      .array(z.enum(["title", "evidence", "deliverable", "evidenceType"]))
      .optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    title: z.string().max(160).optional(),
    description: z.string().max(1000).optional(),
    evidenceType: z.string().max(32).optional(),
    relatedDeliverable: z.string().max(160).optional(),
    deliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    pastedText: z.string().max(4000).optional(),
    externalRef: z.string().max(2000).optional(),
  })
  .strict();
export type DeliveryIntentDraft = z.infer<typeof deliveryIntentDraftSchema>;

export const deliveryPackageSchema = z
  .object({
    paymentId: z.string().regex(/^\d+$/),
    chainId: z.union([z.literal(42220), z.literal(11142220)]),
    worker: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    title: z.string().min(1).max(160),
    description: z.string().max(1000),
    references: z.array(deliveryReferenceSchema).min(1).max(8),
    pastedText: z.string().max(4000),
    relatedDeliverable: z.string().max(160),
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evidenceType: z.enum(DELIVERY_EVIDENCE_TYPES),
  })
  .strict();
export type DeliveryPackage = z.infer<typeof deliveryPackageSchema>;

export type DeliveryMissingField =
  | "title"
  | "evidence"
  | "deliverable"
  | "evidenceType";

export const DELIVERY_BOUNDARY_MESSAGE =
  "Reclaim delivery chat handles delivery evidence, job status and payment readiness.";

export const DELIVERY_AI_UNAVAILABLE_MESSAGE =
  "Reclaim could not interpret that delivery right now. Try again in a moment — nothing was submitted.";

// ---------------------------------------------------------------------------
// Missing fields + clarification
// ---------------------------------------------------------------------------

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

/**
 * Critical fields Reclaim needs before a delivery can be submitted.
 * Priority order: [evidence, title, deliverable, evidenceType].
 * Returns ALL missing (clarification builder focuses max 2).
 */
export function buildDeliveryMissingFields(
  draft: DeliveryIntentDraft,
): DeliveryMissingField[] {
  const missing: DeliveryMissingField[] = [];
  const hasEvidence =
    (draft.references && draft.references.length > 0) ||
    !isBlank(draft.pastedText);
  if (!hasEvidence) missing.push("evidence");
  if (isBlank(draft.title)) missing.push("title");
  const hasDeliverable =
    !isBlank(draft.relatedDeliverable) ||
    (draft.claimedDeliverables && draft.claimedDeliverables.length > 0);
  if (!hasDeliverable) missing.push("deliverable");
  if (isBlank(draft.evidenceType)) missing.push("evidenceType");
  // Enforce priority order regardless of check order above.
  const priority: DeliveryMissingField[] = [
    "evidence",
    "title",
    "deliverable",
    "evidenceType",
  ];
  return missing.sort(
    (a, b) => priority.indexOf(a) - priority.indexOf(b),
  );
}

const DELIVERY_FIELD_QUESTIONS: Record<DeliveryMissingField, string> = {
  evidence:
    "Got it — where can the delivery be seen? Paste the live link, repo URL, or a short delivery note.",
  title: "What should this delivery be called?",
  deliverable: "Which agreed deliverable does this cover?",
  evidenceType: "What type of evidence is this?",
};

/**
 * Focused clarification — at most two missing fields per question,
 * evidence-first. Never interrogates for unnecessary fields.
 */
export function buildDeliveryClarifyingQuestion(
  missing: DeliveryMissingField[],
  _draft?: DeliveryIntentDraft,
): string | null {
  void _draft;
  if (missing.length === 0) return null;
  const priority: DeliveryMissingField[] = [
    "evidence",
    "title",
    "deliverable",
    "evidenceType",
  ];
  const ordered = [...missing].sort(
    (a, b) => priority.indexOf(a) - priority.indexOf(b),
  );
  const focus = ordered.slice(0, 2);
  const questions = focus.map((f) => DELIVERY_FIELD_QUESTIONS[f]);
  if (focus.length === 1) return questions[0] ?? null;
  const [first, second] = questions as [string, string];
  const lowerSecond = second.charAt(0).toLowerCase() + second.slice(1);
  const firstTrimmed = first.endsWith("?") ? first.slice(0, -1) : first;
  return `${firstTrimmed}, and ${lowerSecond}`;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Merge a follow-up draft into the base without losing prior fields. */
export function mergeDeliveryDrafts(
  base: DeliveryIntentDraft,
  update: DeliveryIntentDraft,
): DeliveryIntentDraft {
  const merged: DeliveryIntentDraft = { ...base };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  const parsed = deliveryIntentDraftSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

// ---------------------------------------------------------------------------
// Draft → validated package
// ---------------------------------------------------------------------------

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Deterministic validation: only validated values become a package.
 * paymentId/chainId/worker come ONLY from ctx (never from draft).
 */
export function deliveryDraftToPackage(
  draft: DeliveryIntentDraft,
  ctx: { paymentId: string; chainId: 42220 | 11142220; worker: string },
): { pkg: DeliveryPackage | null; errors: string[] } {
  const errors: string[] = [];

  if (!/^\d+$/.test(ctx.paymentId)) {
    errors.push("Invalid payment id.");
  }
  if (ctx.chainId !== 42220 && ctx.chainId !== 11142220) {
    errors.push("Unsupported network.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(ctx.worker)) {
    errors.push("Invalid worker address.");
  }
  if (errors.length > 0) return { pkg: null, errors };

  // Title with deterministic fallbacks.
  let title = (draft.title ?? "").trim();
  if (!title) {
    const firstClaim = draft.claimedDeliverables?.[0]?.trim() ?? "";
    if (firstClaim) {
      title = `${firstClaim.slice(0, 60)} delivery`.trim().slice(0, 160);
    } else {
      const summary = (draft.summary ?? "").trim();
      title = summary ? summary.slice(0, 60) : "Delivery submission";
    }
  }
  title = title.slice(0, 160);
  if (!title) {
    errors.push("A delivery title is required.");
  }

  // Evidence: references or pastedText (synthesize text ref when needed).
  const pastedText = (draft.pastedText ?? "").slice(0, 4000);
  let references: DeliveryReference[] = [...(draft.references ?? [])].slice(
    0,
    8,
  );
  if (references.length === 0 && pastedText.trim()) {
    references = [
      { type: "text", value: pastedText.trim().slice(0, 200) },
    ];
  }
  if (references.length === 0) {
    errors.push("Delivery evidence is required.");
  }

  // Evidence type defaults to "other" but must be in the vocabulary.
  let evidenceType: string = "other";
  if (draft.evidenceType !== undefined && draft.evidenceType.trim() !== "") {
    const candidate = draft.evidenceType.trim();
    if (
      (DELIVERY_EVIDENCE_TYPES as readonly string[]).includes(candidate)
    ) {
      evidenceType = candidate;
    } else {
      errors.push("Invalid evidence type.");
    }
  }

  // Delivery date defaults to today UTC.
  let deliveryDate = todayUTC();
  if (draft.deliveryDate !== undefined && draft.deliveryDate.trim() !== "") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.deliveryDate.trim())) {
      deliveryDate = draft.deliveryDate.trim();
    } else {
      errors.push("Invalid delivery date.");
    }
  }

  // Description defaults to summary or notes.
  const descriptionSource =
    (draft.description ?? "").trim() ||
    (draft.summary ?? "").trim() ||
    (draft.notes ?? "").trim() ||
    "";
  const description = descriptionSource.slice(0, 1000);

  // Related deliverable defaults to first claimed deliverable or "".
  const relatedDeliverable = (
    (draft.relatedDeliverable ?? "").trim() ||
    (draft.claimedDeliverables?.[0] ?? "").trim() ||
    ""
  ).slice(0, 160);

  if (errors.length > 0) return { pkg: null, errors };

  const candidate = {
    paymentId: ctx.paymentId,
    chainId: ctx.chainId,
    worker: ctx.worker,
    title,
    description,
    references,
    pastedText,
    relatedDeliverable,
    deliveryDate,
    evidenceType,
  };
  const parsed = deliveryPackageSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      pkg: null,
      errors: parsed.error.issues.map((i) => i.message),
    };
  }
  return { pkg: parsed.data, errors: [] };
}

/** Ready when every critical field validates into a package. */
export function isDeliveryDraftReady(draft: DeliveryIntentDraft): boolean {
  if (buildDeliveryMissingFields(draft).length !== 0) return false;
  const { pkg } = deliveryDraftToPackage(draft, {
    paymentId: "1",
    chainId: 42220,
    worker: "0x0000000000000000000000000000000000000001",
  });
  return pkg !== null;
}

// ---------------------------------------------------------------------------
// Package → EvidenceFormData (single manifest encoding, type-only import)
// ---------------------------------------------------------------------------

/**
 * Map a validated delivery package into the existing EvidenceFormData
 * vocabulary. Uses the SINGLE manifest encoding in @/lib/evidence/manifest
 * (type-only import — no second encoding here).
 */
export function deliveryPackageToEvidenceFormData(
  pkg: DeliveryPackage,
): EvidenceFormData {
  const refs = pkg.references ?? [];
  const primaryIdx = refs.findIndex(
    (r) => r.type === "url" || r.type === "repository",
  );
  let externalRef = "";
  if (primaryIdx >= 0) {
    externalRef = refs[primaryIdx]?.value ?? "";
  } else if (refs.length > 0) {
    const first = refs[0]?.value ?? "";
    externalRef = /^https?:\/\//i.test(first) ? first : "";
  }
  const extraRefs =
    primaryIdx >= 0 ? refs.filter((_, i) => i !== primaryIdx) : refs;
  const extraLines = extraRefs.map((r) => `${r.label ?? r.type}: ${r.value}`);
  const pastedText = [pkg.pastedText, ...extraLines]
    .filter((s) => s && s.trim().length > 0)
    .join("\n")
    .slice(0, 4000);
  return {
    title: pkg.title,
    description: pkg.description,
    type: pkg.evidenceType,
    relatedClaim: pkg.relatedDeliverable,
    date: pkg.deliveryDate,
    externalRef,
    pastedText,
    fileHash: "",
  };
}
