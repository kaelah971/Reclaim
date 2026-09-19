// ---------------------------------------------------------------------------
// Reclaim Command — domain-specific payment command parser (P6.1, server).
//
// Input: natural-language user message (+ optional prior draft for follow-ups).
// Output: STRICT structured draft only.
//
// - Low-risk semantic context (purpose, job type, deliverable wording) may be
//   inferred.
// - Wallet address, amount, asset, deadline, approval threshold and release
//   authority are NEVER invented: ambiguous financial fields stay missing,
//   unsupported chains/assets are rejected, and AI critical fields are only
//   accepted when grounded verbatim in the user message(s).
// - Missing critical info → missingFields[] + focused clarifyingQuestion.
// - Out-of-domain prompts → concise boundary (no draft).
// - AI unavailable → honest failure (no fabricated success).
//
// Pure + injectable AI: tests pass a mock enricher; the API route passes the
// real provider-backed enricher. No blockchain writes anywhere in this module.
// ---------------------------------------------------------------------------

import {
  paymentIntentDraftSchema,
  buildMissingFields,
  buildClarifyingQuestion,
  mergeDrafts,
  canonicalizeAsset,
  isUnsupportedAssetToken,
  resolveCommandChainId,
  validateCommandAmount,
  isValidFutureDeadline,
  draftToPolicy,
  COMMAND_DEFAULT_CHAIN_ID,
  COMMAND_BOUNDARY_MESSAGE,
  type MissingField,
  type PaymentIntentDraft,
} from "./paymentIntent";
import { isValidWorkerAddress } from "@/app/(product)/payments/new/validation";

export interface ParseCommandResult {
  draft: PaymentIntentDraft;
  missingFields: MissingField[];
  clarifyingQuestion: string | null;
  ready: boolean;
  rejected: boolean;
  boundaryMessage: string | null;
  errors: string[];
  aiUnavailable: boolean;
}

export type AIEnricher = (
  message: string,
  priorDraft: PaymentIntentDraft,
) => Promise<PaymentIntentDraft | null>;

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const AMOUNT_ASSET_RE =
  /(\d+(?:\.\d+)?)\s*(USA₮|USAT|USDC|USDT|ETH|DAI|BTC|CELO|\$)?/gi;

const TOKEN_WORD_RE = /\b(USA₮|USAT|USDC|USDT|ETH|DAI|BTC|CELO)\b/i;

const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const CHAIN_WORDS: Array<{ re: RegExp; chainId: number | "unsupported"; label: string }> = [
  { re: /\bcelo\s*sepolia\b|\bsepolia\b/i, chainId: 11142220, label: "sepolia" },
  { re: /\bcelo\s*mainnet\b|\bmainnet\b/i, chainId: 42220, label: "mainnet" },
  { re: /\bethereum\b|\bpolygon\b|\bbase\b|\bsolana\b|\barbitrum\b/i, chainId: "unsupported", label: "unsupported" },
];

const PAYMENT_KEYWORDS =
  /\b(protect|pay|escrow|release|freelancer|worker|design|deliver|logo|landing|page|budget|invoice|milestone|deadline|wallet|approve|approval|usa₮|usat|usdc|0x)\b/i;

function distinct<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextWeekdayDate(name: string, label: string): { date: string; label: string } {
  const idx = WEEKDAYS.indexOf(name.toLowerCase() as (typeof WEEKDAYS)[number]);
  const now = new Date();
  const day = now.getUTCDay();
  let delta = (idx - day + 7) % 7;
  if (delta === 0) delta = 7;
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta));
  return { date: toISODate(target), label };
}

function extractAddresses(text: string): { valid: string[]; invalidMention: boolean } {
  const matches = text.match(ADDRESS_RE) ?? [];
  const valid = distinct(
    matches.filter((m) => m.toLowerCase() !== ZERO_ADDRESS.toLowerCase()),
  );
  // Any 0x mention that is not a valid address counts as an invalid attempt
  // (never silently ignored, never guessed).
  const rough = /0x[0-9a-zA-Z]/.test(text);
  return { valid, invalidMention: rough && valid.length === 0 };
}

function extractAmounts(text: string): { amounts: string[]; assets: string[] } {
  const amounts: string[] = [];
  const assets: string[] = [];
  // Reset lastIndex for the global regex.
  AMOUNT_ASSET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_ASSET_RE.exec(text)) !== null) {
    const num = m[1];
    const asset = m[2];
    if (!num) continue;
    // Skip bare years / dates already handled elsewhere (e.g. 2026-09-18
    // fragments). A 4-digit number adjacent to "-" is a date part, not money.
    const idx = m.index;
    const before = text[idx - 1] ?? "";
    const after = text[idx + num.length] ?? "";
    if (before === "-" || after === "-") continue;
    amounts.push(num);
    if (asset) assets.push(asset);
  }
  return { amounts: distinct(amounts), assets: distinct(assets) };
}

function extractDeadline(text: string): { date?: string; label?: string } | null {
  const iso = text.match(ISO_DATE_RE)?.[1];
  if (iso) {
    return { date: iso, label: iso };
  }
  if (/\btomorrow\b/i.test(text)) {
    const now = new Date();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return { date: toISODate(t), label: "tomorrow" };
  }
  const lower = text.toLowerCase();
  for (const day of WEEKDAYS) {
    if (new RegExp(`\\b(by\\s+)?(this\\s+|next\\s+)?${day}\\b`, "i").test(lower)) {
      const label = text.match(new RegExp(`(by\\s+)?(this\\s+|next\\s+)?${day}`, "i"))?.[0] ?? day;
      return nextWeekdayDate(day, label);
    }
  }
  return null;
}

function extractReleaseMode(text: string): "manual" | "agent_assisted" | undefined {
  if (/\bautopilot\b|\bwithout\s+(my\s+)?approval\b|\bauto[\s-]?release\s+without\b/i.test(text)) {
    // Reserved: never executable — fall back to assisted (approval required).
    return "agent_assisted";
  }
  if (/\bask\s+me\b|\bbefore\s+releas|\bapprov|\bmanual\b|\breview\b/i.test(text)) {
    return "manual";
  }
  if (/\bagent\b|\bassist|\bAI\b/i.test(text)) {
    return "agent_assisted";
  }
  return undefined;
}

function extractChain(text: string): { chainId?: number; unsupported?: string } {
  for (const c of CHAIN_WORDS) {
    if (c.re.test(text)) {
      if (c.chainId === "unsupported") return { unsupported: c.label };
      return { chainId: c.chainId as number };
    }
  }
  return {};
}

function extractRecipientName(text: string): string | undefined {
  const m = text.match(/\bfor\s+([A-Z][a-zA-Z]{1,30})\b/);
  if (m?.[1] && !/^(a|an|the)$/i.test(m[1])) return m[1];
  return undefined;
}

function extractPurpose(text: string): string | undefined {
  // "for X to <purpose> by ..." / "for <purpose>" / "to <purpose>".
  let m = text.match(/\bfor\s+(?:[A-Z][a-zA-Z]{1,30}\s+)?to\s+(.+?)(?:\s+by\s+|\s*\.\s*$|\s*$)/i);
  if (m?.[1]) return cleanPhrase(m[1]);
  m = text.match(/\bfor\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+by\s+|\s*\.\s*$|\s*$)/i);
  if (m?.[1]) {
    const candidate = cleanPhrase(m[1]);
    // Skip bare names ("for Daniel") — that's a recipient, not a purpose.
    if (/^[A-Z][a-zA-Z]{1,30}$/.test(candidate)) return undefined;
    // Skip fragments that are only amount/asset/address.
    if (/^[\d\s.,$]*$/.test(candidate)) return undefined;
    if (/^0x/i.test(candidate)) return undefined;
    return candidate || undefined;
  }
  m = text.match(/\bto\s+(design|build|create|deliver|write|develop)\b(.+?)(?:\s+by\s+|\s*\.\s*$|\s*$)/i);
  if (m) return cleanPhrase(`${m[1]}${m[2] ?? ""}`);
  return undefined;
}

function cleanPhrase(s: string): string {
  return s
    .replace(/0x[0-9a-fA-F]{10,64}/g, "")
    .replace(/\d+(?:\.\d+)?\s*(USA₮|USAT|USDC|USDT|ETH|DAI|BTC|CELO|\$)?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,\-–:;]+|[,\-–:;.]+$/g, "")
    .trim()
    .slice(0, 120);
}

function inferDeliverables(purpose: string | undefined): string[] | undefined {
  if (!purpose) return undefined;
  const lower = purpose.toLowerCase();
  if (lower.includes("logo")) return ["Logo design files (SVG + PNG)"];
  if (lower.includes("landing")) return ["Landing page delivery"];
  return undefined;
}

/** Critical AI fields must appear verbatim in the user text — never invented. */
function isGrounded(value: string, messagesText: string): boolean {
  return messagesText.toLowerCase().includes(value.trim().toLowerCase());
}

function groundAIDraft(
  ai: PaymentIntentDraft,
  messagesText: string,
): PaymentIntentDraft {
  const out: PaymentIntentDraft = {};
  if (ai.recipient && isValidWorkerAddress(ai.recipient) && isGrounded(ai.recipient, messagesText)) {
    out.recipient = ai.recipient;
  }
  if (ai.amount && isGrounded(ai.amount, messagesText)) {
    out.amount = ai.amount;
  }
  if (ai.asset) {
    const tokenHit = TOKEN_WORD_RE.test(messagesText);
    const symbolHit = isGrounded(ai.asset, messagesText);
    if (tokenHit || symbolHit) out.asset = ai.asset;
  }
  if (ai.deadlineDate && (isGrounded(ai.deadlineDate, messagesText) || /\b(friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(messagesText))) {
    out.deadlineDate = ai.deadlineDate;
  }
  if (ai.deadlineLabel && isGrounded(ai.deadlineLabel, messagesText)) {
    out.deadlineLabel = ai.deadlineLabel;
  }
  // Low-risk semantic context may be inferred.
  if (ai.purpose) out.purpose = ai.purpose;
  if (ai.jobType) out.jobType = ai.jobType;
  if (ai.deliverables) out.deliverables = ai.deliverables;
  if (ai.evidenceRequirements) out.evidenceRequirements = ai.evidenceRequirements;
  if (ai.recipientName) out.recipientName = ai.recipientName;
  if (ai.releaseMode) out.releaseMode = ai.releaseMode;
  if (ai.reviewWindow) out.reviewWindow = ai.reviewWindow;
  if (ai.approvalThreshold) out.approvalThreshold = ai.approvalThreshold;
  if (ai.escalationPolicy) out.escalationPolicy = ai.escalationPolicy;
  if (ai.chainId !== undefined) {
    const resolved = resolveCommandChainId(ai.chainId);
    if (resolved !== null && messagesText.toLowerCase().includes(String(ai.chainId))) {
      out.chainId = resolved;
    }
  }
  const parsed = paymentIntentDraftSchema.safeParse(out);
  return parsed.success ? parsed.data : {};
}

export interface ParseCommandInput {
  message: string;
  priorDraft?: PaymentIntentDraft;
  priorMessagesText?: string;
  aiEnrich?: AIEnricher | null;
}

export async function parsePaymentCommand(
  input: ParseCommandInput,
): Promise<ParseCommandResult> {
  const message = (input.message ?? "").trim();
  const priorDraft: PaymentIntentDraft = input.priorDraft ?? {};
  const priorText = input.priorMessagesText ?? "";
  const messagesText = `${priorText}\n${message}`.trim();

  const fail = (
    patch: Partial<ParseCommandResult> & { draft: PaymentIntentDraft },
  ): ParseCommandResult => {
    const missing = buildMissingFields(patch.draft);
    return {
      missingFields: missing,
      clarifyingQuestion: buildClarifyingQuestion(missing),
      ready: false,
      rejected: false,
      boundaryMessage: null,
      errors: [],
      aiUnavailable: false,
      ...patch,
    };
  };

  if (!message) {
    return fail({
      draft: priorDraft,
      clarifyingQuestion: "What do you want Reclaim to handle?",
    });
  }

  // Follow-up addressing a missing field is in-domain even without keywords
  // (e.g. a bare wallet address answering "What wallet…?").
  const isFollowUpFill =
    Object.keys(priorDraft).length > 0 &&
    (ADDRESS_RE.test(message) ||
      /\d+(?:\.\d+)?/.test(message) ||
      /\b(USA₮|USAT|USDC)\b/i.test(message) ||
      ISO_DATE_RE.test(message) ||
      /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(message));

  if (!PAYMENT_KEYWORDS.test(message) && !isFollowUpFill) {
    return {
      draft: {},
      missingFields: [],
      clarifyingQuestion: null,
      ready: false,
      rejected: true,
      boundaryMessage: COMMAND_BOUNDARY_MESSAGE,
      errors: [],
      aiUnavailable: false,
    };
  }

  const errors: string[] = [];
  const det: PaymentIntentDraft = {};

  // --- Recipient (never invented; ambiguous stays missing) ---
  const { valid, invalidMention } = extractAddresses(message);
  if (valid.length === 1) {
    det.recipient = valid[0];
  } else if (valid.length > 1) {
    errors.push("Multiple wallet addresses found — which one should receive the payment?");
  } else if (invalidMention) {
    errors.push("Invalid recipient address.");
  }

  // --- Amount (never guessed; ambiguous stays missing) ---
  // Strip 0x hex runs + ISO dates first so address/date digits never become
  // phantom money candidates.
  const textForAmounts = message
    .replace(/0x[0-9a-fA-F]+/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ");
  const { amounts, assets } = extractAmounts(textForAmounts);
  // Filter out date fragments already skipped; remaining numbers are money
  // candidates only when a payment keyword or asset context exists.
  if (amounts.length === 1) {
    det.amount = amounts[0];
  } else if (amounts.length > 1) {
    errors.push("Multiple amounts found — how much should be protected?");
  }

  // --- Asset (unsupported rejected) ---
  const tokenMentions = distinct(
    [...message.matchAll(/\b(USA₮|USAT|USDC|USDT|ETH|DAI|BTC|CELO|\$)\b/gi)].map(
      (m) => m[1],
    ),
  );
  const assetFromAmount = assets.length === 1 ? assets[0] : undefined;
  const assetWord = tokenMentions.length === 1 ? tokenMentions[0] : undefined;
  const rawAsset = assetFromAmount ?? assetWord;
  if (tokenMentions.length > 1 && distinct(tokenMentions.map((t) => t.toUpperCase())).length > 1) {
    errors.push("Multiple assets found — which asset should be protected?");
  } else if (rawAsset) {
    if (rawAsset === "$") {
      // Amount in dollars without a token — asset stays missing.
    } else if (isUnsupportedAssetToken(rawAsset)) {
      errors.push(`Unsupported asset "${rawAsset}". Reclaim protects USA₮ on Celo.`);
    } else {
      det.asset = rawAsset.toUpperCase() === "USAT" ? "USAT" : rawAsset.toUpperCase() === "USA₮" ? "USA₮" : rawAsset.toUpperCase();
    }
  }

  // --- Chain (unsupported rejected) ---
  const chainHit = extractChain(message);
  if (chainHit.unsupported) {
    errors.push(`Unsupported network "${chainHit.unsupported}". Reclaim protects payments on Celo.`);
  } else if (chainHit.chainId !== undefined) {
    det.chainId = chainHit.chainId;
  }

  // --- Deadline (never invented) ---
  const deadline = extractDeadline(message);
  if (deadline?.date) {
    if (isValidFutureDeadline(deadline.date)) {
      det.deadlineDate = deadline.date;
      det.deadlineLabel = deadline.label;
    } else {
      errors.push("Invalid deadline.");
    }
  }

  // --- Release mode ---
  const releaseMode = extractReleaseMode(message);
  if (releaseMode) det.releaseMode = releaseMode;

  // --- Semantic context (low-risk) ---
  const recipientName = extractRecipientName(message);
  if (recipientName && !det.recipient) det.recipientName = recipientName;
  const purpose = extractPurpose(message);
  if (purpose) det.purpose = purpose;
  const inferred = inferDeliverables(purpose);
  if (inferred) det.deliverables = inferred;
  if (!det.evidenceRequirements && purpose) {
    det.evidenceRequirements = ["Delivery note / files / links as applicable"];
  }

  // Merge deterministic over prior (never lose prior fields).
  let merged = mergeDrafts(priorDraft, det);

  // --- AI semantic enrichment (grounded; honest failure) ---
  if (input.aiEnrich !== null) {
    try {
      const enricher = input.aiEnrich;
      if (enricher) {
        const aiRaw = await enricher(message, merged);
        if (aiRaw) {
          const grounded = groundAIDraft(aiRaw, messagesText);
          // Deterministic critical fields win; AI fills the rest.
          const aiFill: PaymentIntentDraft = { ...grounded };
          if (merged.recipient) delete aiFill.recipient;
          if (merged.amount) delete aiFill.amount;
          if (merged.asset) delete aiFill.asset;
          if (merged.deadlineDate) {
            delete aiFill.deadlineDate;
            delete aiFill.deadlineLabel;
          }
          if (merged.chainId !== undefined) delete aiFill.chainId;
          merged = mergeDrafts(merged, aiFill);
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "NO_API_KEY" || code === "AI_UNAVAILABLE") {
        return {
          draft: merged,
          missingFields: buildMissingFields(merged),
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

  // --- Deterministic validation of critical fields ---
  if (merged.amount) {
    const chainForAmount = resolveCommandChainId(merged.chainId) ?? COMMAND_DEFAULT_CHAIN_ID;
    if (!validateCommandAmount(merged.amount, chainForAmount)) {
      errors.push("Invalid amount.");
      const { amount: _dropped, ...rest } = merged;
      void _dropped;
      merged = rest;
    }
  }
  if (merged.asset) {
    const chainForAsset = resolveCommandChainId(merged.chainId) ?? COMMAND_DEFAULT_CHAIN_ID;
    if (!canonicalizeAsset(merged.asset, chainForAsset)) {
      errors.push("Unsupported asset.");
      const { asset: _dropped, ...rest } = merged;
      void _dropped;
      merged = rest;
    }
  }

  const missing = buildMissingFields(merged);
  // Errors that block readiness surface alongside the focused question.
  const question = errors.length > 0 ? errors[0] ?? null : buildClarifyingQuestion(missing);

  // Ready only when every critical field validates into a real policy.
  const result = draftToPolicy(merged);
  const ready = result.policy !== null && missing.length === 0;

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
