// ---------------------------------------------------------------------------
// Reclaim Delivery — domain-specific delivery parser (P6.3, server).
//
// Input: natural-language worker message (+ payment context + prior draft).
// Output: STRICT structured draft only.
//
// - URLs are extracted deterministically and NEVER invented.
// - Claimed-but-unprovided files stay unclear (guidance error, never
//   resolved as satisfied).
// - Claimed deliverables are matched against canonical payment deliverables.
// - Payment/chain/worker NEVER come from the message or AI — only from
//   paymentContext.
// - AI output is grounded verbatim; ungrounded URLs are dropped.
// - AI unavailable → honest flag (deterministic draft still useful).
//
// Pure + injectable AI: tests pass a mock enricher; the API route passes the
// real provider-backed enricher. No blockchain writes anywhere in this module.
// ---------------------------------------------------------------------------

import {
  deliveryIntentDraftSchema,
  buildDeliveryMissingFields,
  buildDeliveryClarifyingQuestion,
  mergeDeliveryDrafts,
  deliveryDraftToPackage,
  isDeliveryDraftReady,
  DELIVERY_BOUNDARY_MESSAGE,
  DELIVERY_EVIDENCE_TYPES,
  type DeliveryIntentDraft,
  type DeliveryMissingField,
  type DeliveryReference,
} from "./deliveryIntent";

export interface DeliveryPaymentContext {
  paymentId: string;
  chainId: number;
  worker: string;
  deliverables: string[];
  evidenceRequirements: string[];
  agreementLabel?: string;
}

export interface ParseDeliveryResult {
  draft: DeliveryIntentDraft;
  missingFields: DeliveryMissingField[];
  clarifyingQuestion: string | null;
  ready: boolean;
  rejected: boolean;
  boundaryMessage: string | null;
  errors: string[];
  aiUnavailable: boolean;
}

export type AIDeliveryEnricher = (
  message: string,
  priorDraft: DeliveryIntentDraft,
  contextLabel: string,
) => Promise<DeliveryIntentDraft | null>;

export interface ParseDeliveryInput {
  message: string;
  priorDraft?: DeliveryIntentDraft;
  priorMessagesText?: string;
  paymentContext: DeliveryPaymentContext;
  aiEnrich?: AIDeliveryEnricher | null;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

const FILE_CLAIM_RE =
  /\b(attach\w*|png|jpe?g|pdf|zip|figma\s*file|export\w*|screenshot|final\s*files?)\b/i;

export const DELIVERY_KEYWORDS =
  /\b(done|finish\w*|deliver\w*|submit\w*|complet\w*|figma|github|repo\w*|deploy\w*|live|site|website|landing|logo|file\w*|link|url|here'?s|attached|export\w*|ready|pull\s*request|\bpr\b)\b|https?:\/\//i;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "into",
  "your",
  "our",
  "their",
]);

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function distinct<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function stripTrailingUrl(u: string): string {
  return u.replace(/[.,;!?)"']+$/g, "");
}

function extractUrls(text: string): string[] {
  URL_RE.lastIndex = 0;
  const raw = text.match(URL_RE) ?? [];
  const cleaned = raw.map(stripTrailingUrl).filter((u) => u.length > 0);
  return distinct(cleaned).slice(0, 8);
}

function classifyUrl(url: string): "url" | "repository" {
  return url.toLowerCase().includes("github.com") ? "repository" : "url";
}

function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function matchClaimedDeliverables(
  message: string,
  canonicals: string[],
): string[] {
  const lower = message.toLowerCase();
  const out: string[] = [];
  for (const c of canonicals) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const cl = trimmed.toLowerCase();
    if (lower.includes(cl)) {
      out.push(trimmed.slice(0, 120));
      continue;
    }
    const sig = significantWords(trimmed).slice(0, 3);
    if (sig.length > 0 && sig.every((w) => lower.includes(w))) {
      out.push(trimmed.slice(0, 120));
    }
  }
  return distinct(out).slice(0, 8);
}

/** Critical AI prose must be length-capped; URLs must be verbatim. */
function isGrounded(value: string, messagesText: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return messagesText.toLowerCase().includes(v);
}

function groundAIDeliveryDraft(
  ai: DeliveryIntentDraft,
  messagesText: string,
): DeliveryIntentDraft {
  const out: DeliveryIntentDraft = {};

  // References: keep ONLY refs whose value appears verbatim; reclassify.
  if (Array.isArray(ai.references)) {
    const kept: DeliveryReference[] = [];
    for (const r of ai.references) {
      if (!r || typeof r.value !== "string") continue;
      const value = r.value.trim().slice(0, 2000);
      if (!value || !isGrounded(value, messagesText)) continue;
      const type =
        value.toLowerCase().includes("github.com")
          ? "repository"
          : (DELIVERY_REFERENCE_TYPES_SAFE.includes(
                (r as { type?: string }).type as never,
              )
              ? ((r as { type?: string }).type as DeliveryReference["type"])
              : "url");
      const label =
        typeof (r as { label?: unknown }).label === "string"
          ? ((r as { label?: string }).label ?? "").slice(0, 120)
          : undefined;
      const candidate: DeliveryReference =
        label && label.trim()
          ? { type, value, label: label.trim() }
          : { type, value };
      // Validate each reference individually; drop invalid ones.
      const { deliveryReferenceSchema } = deliveryRefSchemaHolder;
      if (deliveryReferenceSchema.safeParse(candidate).success) {
        kept.push(candidate);
      }
      if (kept.length >= 8) break;
    }
    if (kept.length > 0) out.references = kept;
  }

  if (typeof ai.summary === "string" && ai.summary.trim()) {
    out.summary = ai.summary.trim().slice(0, 300);
  }
  if (typeof ai.notes === "string" && ai.notes.trim()) {
    out.notes = ai.notes.trim().slice(0, 1000);
  }
  if (typeof ai.pastedText === "string" && ai.pastedText.trim()) {
    out.pastedText = ai.pastedText.trim().slice(0, 4000);
  }
  if (typeof ai.title === "string" && ai.title.trim()) {
    out.title = ai.title.trim().slice(0, 160);
  }
  if (typeof ai.description === "string" && ai.description.trim()) {
    out.description = ai.description.trim().slice(0, 1000);
  }
  if (
    typeof ai.relatedDeliverable === "string" &&
    ai.relatedDeliverable.trim()
  ) {
    out.relatedDeliverable = ai.relatedDeliverable.trim().slice(0, 160);
  }
  if (typeof ai.externalRef === "string" && ai.externalRef.trim()) {
    const v = ai.externalRef.trim().slice(0, 2000);
    if (isGrounded(v, messagesText)) out.externalRef = v;
  }
  if (typeof ai.evidenceType === "string" && ai.evidenceType.trim()) {
    const v = ai.evidenceType.trim();
    if ((DELIVERY_EVIDENCE_TYPES as readonly string[]).includes(v)) {
      out.evidenceType = v;
    }
  }
  if (Array.isArray(ai.claimedDeliverables)) {
    const kept = ai.claimedDeliverables
      .filter((c) => typeof c === "string" && c.trim().length > 0)
      .map((c) => (c as string).trim().slice(0, 120))
      .filter((c) => isGrounded(c, messagesText));
    if (kept.length > 0) out.claimedDeliverables = distinct(kept).slice(0, 8);
  }
  if (
    ai.confidence === "high" ||
    ai.confidence === "medium" ||
    ai.confidence === "low"
  ) {
    out.confidence = ai.confidence;
  }
  // deliveryDate NEVER accepted from AI (parser sets at packaging).
  // missingFields accepted only when valid enum entries.
  if (Array.isArray(ai.missingFields)) {
    const allowed = ["title", "evidence", "deliverable", "evidenceType"];
    const kept = (ai.missingFields as unknown[]).filter((m): m is never =>
      allowed.includes(m as string),
    );
    if (kept.length > 0) {
      out.missingFields =
        kept as DeliveryIntentDraft["missingFields"];
    }
  }

  const parsed = deliveryIntentDraftSchema.safeParse(out);
  return parsed.success ? parsed.data : {};
}

// Lazy holder to avoid circular import edge (same-module import is fine,
// but keeps the grounding helper self-contained for tests).
import { deliveryReferenceSchema as _deliveryReferenceSchema } from "./deliveryIntent";
const deliveryRefSchemaHolder = {
  deliveryReferenceSchema: _deliveryReferenceSchema,
};
const DELIVERY_REFERENCE_TYPES_SAFE = [
  "url",
  "repository",
  "file_reference",
  "text",
  "other",
] as const;

function buildContextLabel(ctx: DeliveryPaymentContext): string {
  const parts: string[] = [];
  if (ctx.agreementLabel) parts.push(`Agreement: ${ctx.agreementLabel}`);
  if (ctx.deliverables.length > 0)
    parts.push(`Deliverables: ${ctx.deliverables.join("; ")}`);
  if (ctx.evidenceRequirements.length > 0)
    parts.push(`Evidence: ${ctx.evidenceRequirements.join("; ")}`);
  parts.push(`Payment: ${ctx.paymentId}`);
  return parts.join(" | ").slice(0, 800);
}

export async function parseDelivery(
  input: ParseDeliveryInput,
): Promise<ParseDeliveryResult> {
  const message = (input.message ?? "").trim();
  const priorDraft: DeliveryIntentDraft = input.priorDraft ?? {};
  const priorText = input.priorMessagesText ?? "";
  const messagesText = `${priorText}\n${message}`.trim();
  const paymentContext = input.paymentContext;

  if (!message) {
    const missing = buildDeliveryMissingFields(priorDraft);
    return {
      draft: priorDraft,
      missingFields: missing,
      clarifyingQuestion:
        Object.keys(priorDraft).length === 0
          ? "What did you deliver?"
          : (buildDeliveryClarifyingQuestion(missing) ?? null),
      ready: false,
      rejected: false,
      boundaryMessage: null,
      errors: [],
      aiUnavailable: false,
    };
  }

  // Follow-up addressing a missing field is in-domain even without keywords
  // (e.g. a bare link answering "where can the delivery be seen?").
  URL_RE.lastIndex = 0;
  const hasUrl = URL_RE.test(message);
  URL_RE.lastIndex = 0;
  const nonSpaceLen = message.replace(/\s/g, "").length;
  const isFollowUpFill =
    Object.keys(priorDraft).length > 0 && (hasUrl || nonSpaceLen >= 12);

  if (!DELIVERY_KEYWORDS.test(message) && !isFollowUpFill) {
    return {
      draft: {},
      missingFields: [],
      clarifyingQuestion: null,
      ready: false,
      rejected: true,
      boundaryMessage: DELIVERY_BOUNDARY_MESSAGE,
      errors: [],
      aiUnavailable: false,
    };
  }

  const errors: string[] = [];
  const det: DeliveryIntentDraft = {};

  // --- URLs (never invented) ---
  const urls = extractUrls(message);
  if (urls.length > 0) {
    det.references = urls.map((u) => ({
      type: classifyUrl(u),
      value: u,
    }));
    det.externalRef = urls[0];
  }

  // --- File-claim detection (claimed-but-unprovided stays unclear) ---
  const hasFileClaim = FILE_CLAIM_RE.test(message) && urls.length === 0;
  if (hasFileClaim) {
    errors.push(
      "You mentioned a file — attach it via Add evidence manually, or paste the link/text here.",
    );
  }

  // --- Claimed deliverables (canonical substring + significant words) ---
  const canonicals = [
    ...(paymentContext.deliverables ?? []),
    ...(paymentContext.evidenceRequirements ?? []),
  ];
  const matched = matchClaimedDeliverables(message, canonicals);
  if (matched.length > 0) {
    det.claimedDeliverables = matched;
    det.relatedDeliverable = matched[0]?.slice(0, 160) ?? "";
  }

  // --- Summary (deterministic fallback) ---
  const collapsed = collapse(message).slice(0, 160);
  if (collapsed) det.summary = collapsed.slice(0, 300);

  // --- Title fallback ---
  if (matched.length > 0) {
    det.title = `${matched[0]?.slice(0, 60)} delivery`.slice(0, 160);
  } else if (collapsed) {
    det.title = collapsed.slice(0, 60) || "Delivery submission";
  } else {
    det.title = "Delivery submission";
  }

  // --- Pasted text candidate (URLs removed, ≥20 chars) ---
  // A claimed-but-unprovided file never counts as text evidence: the note
  // stays unclear until the worker pastes a real link or delivery note.
  URL_RE.lastIndex = 0;
  const withoutUrls = collapse(message.replace(URL_RE, " "));
  URL_RE.lastIndex = 0;
  if (!hasFileClaim && withoutUrls.length >= 20) {
    det.pastedText = withoutUrls.slice(0, 4000);
  }

  // Merge deterministic over prior (never lose prior fields).
  let merged = mergeDeliveryDrafts(priorDraft, det);

  // --- AI semantic enrichment (grounded; honest failure) ---
  if (input.aiEnrich !== null && input.aiEnrich !== undefined) {
    try {
      const enricher = input.aiEnrich;
      if (enricher) {
        const contextLabel = buildContextLabel(paymentContext);
        const aiRaw = await enricher(message, merged, contextLabel);
        if (aiRaw) {
          const grounded = groundAIDeliveryDraft(aiRaw, messagesText);
          // Deterministic wins for references/externalRef when present.
          const aiFill: DeliveryIntentDraft = { ...grounded };
          if (merged.references && merged.references.length > 0) {
            delete aiFill.references;
          }
          if (merged.externalRef && merged.externalRef.trim()) {
            delete aiFill.externalRef;
          }
          merged = mergeDeliveryDrafts(merged, aiFill);
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "NO_API_KEY" || code === "AI_UNAVAILABLE") {
        return {
          draft: merged,
          missingFields: buildDeliveryMissingFields(merged),
          clarifyingQuestion: null,
          ready: false,
          rejected: false,
          boundaryMessage: null,
          errors: [],
          aiUnavailable: true,
        };
      }
      // Other AI failures: continue deterministically, surface nothing fake.
    }
  }

  const missing = buildDeliveryMissingFields(merged);
  const question =
    errors.length > 0
      ? (errors[0] ?? null)
      : buildDeliveryClarifyingQuestion(missing);

  // Ready only when every critical field validates into a real package.
  // Payment/chain/worker come ONLY from paymentContext.
  const { pkg } = deliveryDraftToPackage(merged, {
    paymentId: paymentContext.paymentId,
    chainId: paymentContext.chainId as 42220 | 11142220,
    worker: paymentContext.worker,
  });
  const ready =
    pkg !== null && missing.length === 0 && isDeliveryDraftReady(merged);

  return {
    draft: merged,
    missingFields: missing,
    clarifyingQuestion: ready ? null : (question ?? null),
    ready,
    rejected: false,
    boundaryMessage: null,
    errors,
    aiUnavailable: false,
  };
}
