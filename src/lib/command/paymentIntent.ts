// ---------------------------------------------------------------------------
// Reclaim Command — PaymentIntent + PaymentPolicy domain model (P6.1).
//
// CHAT UNDERSTANDS. POLICY DECIDES. CONTRACT ENFORCES.
//
// - PaymentIntentDraft: STRICT structured draft the parser may produce. All
//   financial fields are optional; ambiguous values stay missing (never
//   guessed). No wallet addresses or amounts are invented.
// - PaymentPolicy: only validated values Reclaim can actually support
//   (canonical Mainnet default, canonical USA₮, validated recipient, real
//   amount/decimals, future deadline). Maps safely into the existing
//   CreatePaymentParams + wizard fields — no second transaction architecture.
//
// ReleaseMode: "manual" | "agent_assisted" are the only executable modes.
// "autopilot" is reserved internally (never presented as executable, never
// emitted by the parser).
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  isSupportedChain,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import {
  isValidWorkerAddress,
  parseAmountToRaw,
  dateToUnixTimestamp,
} from "@/app/(product)/payments/new/validation";
import { utf8ByteLength } from "@/lib/contracts/types";

/** Canonical command chain: Celo Mainnet. Sepolia only via explicit request. */
export const COMMAND_DEFAULT_CHAIN_ID = CELO_MAINNET_CHAIN_ID;

/** Chains the command interface accepts (canonical mapping, no fallback). */
export const COMMAND_SUPPORTED_CHAIN_IDS = [
  CELO_MAINNET_CHAIN_ID,
  CELO_CHAIN_ID,
] as const;

/** Assets the parser accepts (case-insensitive input, canonicalized). */
export const COMMAND_SUPPORTED_ASSETS = ["USA₮", "USAT", "USDC"] as const;

/** Executable release modes. "autopilot" is reserved, never executable. */
export const RELEASE_MODES = ["manual", "agent_assisted"] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

/** Reserved internally only — never presented as executable, never emitted. */
export const RESERVED_RELEASE_MODES = ["autopilot"] as const;

export const COMMAND_BOUNDARY_MESSAGE =
  "Reclaim handles protected work payments and their release conditions.";

export const COMMAND_AI_UNAVAILABLE_MESSAGE =
  "Reclaim could not interpret that command right now. Try again in a moment — nothing was created.";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const addressSchema = z
  .string()
  .refine((v) => isValidWorkerAddress(v), {
    message: "Invalid recipient address.",
  });

export const paymentIntentDraftSchema = z
  .object({
    recipient: addressSchema.optional(),
    recipientName: z.string().max(64).optional(),
    amount: z.string().max(32).optional(),
    asset: z.string().max(16).optional(),
    purpose: z.string().max(160).optional(),
    jobType: z.string().max(64).optional(),
    deliverables: z.array(z.string().max(120)).max(8).optional(),
    deadlineDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "deadlineDate must be YYYY-MM-DD.")
      .optional(),
    deadlineLabel: z.string().max(64).optional(),
    evidenceRequirements: z.array(z.string().max(120)).max(8).optional(),
    releaseMode: z.enum(RELEASE_MODES).optional(),
    reviewWindow: z.string().max(64).optional(),
    approvalThreshold: z.string().max(64).optional(),
    escalationPolicy: z.string().max(120).optional(),
    chainId: z.number().int().optional(),
  })
  .strict();

export type PaymentIntentDraft = z.infer<typeof paymentIntentDraftSchema>;

export const paymentPolicySchema = z
  .object({
    worker: addressSchema,
    amountHuman: z.string().min(1).max(32),
    amountRaw: z.string().regex(/^\d+$/),
    asset: z.enum(["USA₮", "USDC"]),
    chainId: z.union([z.literal(42220), z.literal(11142220)]),
    title: z.string().min(1).max(160),
    deliverableSummary: z.string().min(1).max(160),
    deliveryFormat: z.string().max(160),
    deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deadlineUnix: z.number().int().positive(),
    evidenceExpectation: z.string().max(160),
    releaseMode: z.enum(RELEASE_MODES),
    /** Contract-level release rule derived from releaseMode. */
    releaseRule: z.string().min(1).max(64),
    deliverables: z.array(z.string()).default([]),
    evidenceRequirements: z.array(z.string()).default([]),
  })
  .strict();

export type PaymentPolicy = z.infer<typeof paymentPolicySchema>;

// ---------------------------------------------------------------------------
// Canonicalization + validation helpers
// ---------------------------------------------------------------------------

/** Canonicalize a raw asset token into USA₮/USDC, or null when unsupported. */
export function canonicalizeAsset(
  raw: string | null | undefined,
  chainId: number = COMMAND_DEFAULT_CHAIN_ID,
): "USA₮" | "USDC" | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  if (t === "USA₮" || t === "USAT") {
    return chainId === CELO_MAINNET_CHAIN_ID ? "USA₮" : "USDC";
  }
  if (t === "USDC") {
    return chainId === CELO_MAINNET_CHAIN_ID ? "USA₮" : "USDC";
  }
  return null;
}

/**
 * Raw asset is explicitly unsupported (ETH/DAI/BTC/USDT/…).
 * Used to reject rather than silently map.
 */
export function isUnsupportedAssetToken(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const t = raw.trim().toUpperCase();
  if (t === "USA₮" || t === "USAT" || t === "USDC") return false;
  return ["ETH", "DAI", "BTC", "USDT", "CELO", "WETH", "WBTC"].includes(
    t.replace(/₮/g, "T"),
  );
}

/** Resolve a chain for the draft: explicit supported wins, else Mainnet. */
export function resolveCommandChainId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") {
    return COMMAND_DEFAULT_CHAIN_ID;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || !isSupportedChain(n)) return null;
  if (
    n !== CELO_MAINNET_CHAIN_ID &&
    n !== (CELO_CHAIN_ID as number)
  ) {
    return null;
  }
  return n;
}

/** Validate a human amount against the chain token decimals (6). */
export function validateCommandAmount(
  amountHuman: string | null | undefined,
  chainId: number = COMMAND_DEFAULT_CHAIN_ID,
): { raw: bigint; normalized: string } | null {
  if (!amountHuman) return null;
  const token = getPaymentTokenConfig(chainId);
  const raw = parseAmountToRaw(amountHuman.trim(), token.decimals);
  if (raw === null) return null;
  return { raw, normalized: amountHuman.trim() };
}

/** True when the YYYY-MM-DD deadline is a real future date. */
export function isValidFutureDeadline(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return dateToUnixTimestamp(dateStr) > Math.floor(Date.now() / 1000);
}

/** Map an executable release mode to the contract releaseRule label. */
export function releaseModeToRule(mode: ReleaseMode): string {
  return mode === "agent_assisted" ? "buyer-approval" : "manual";
}

// ---------------------------------------------------------------------------
// Missing fields + clarification
// ---------------------------------------------------------------------------

export type MissingField =
  | "recipient"
  | "amount"
  | "asset"
  | "deadline"
  | "deliverable";

/** Critical fields Reclaim needs before a confirmation card is shown. */
export function buildMissingFields(draft: PaymentIntentDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (!draft.recipient) missing.push("recipient");
  if (!draft.amount) missing.push("amount");
  if (!draft.asset) missing.push("asset");
  if (!draft.deadlineDate) missing.push("deadline");
  const hasDeliverable =
    (draft.deliverables && draft.deliverables.length > 0) ||
    (draft.purpose && draft.purpose.trim().length > 0);
  if (!hasDeliverable) missing.push("deliverable");
  return missing;
}

const FIELD_QUESTIONS: Record<MissingField, string> = {
  recipient: "What wallet should receive the payment?",
  amount: "How much should be protected?",
  asset: "Which asset should be protected (USA₮ on Celo)?",
  deadline: "When should the work be delivered?",
  deliverable: "What should the worker deliver?",
};

/**
 * Focused clarification — at most two missing fields per question, financial
 * fields first. Never interrogates for unnecessary fields.
 */
export function buildClarifyingQuestion(missing: MissingField[]): string | null {
  if (missing.length === 0) return null;
  const priority: MissingField[] = [
    "recipient",
    "amount",
    "deadline",
    "deliverable",
    "asset",
  ];
  const ordered = [...missing].sort(
    (a, b) => priority.indexOf(a) - priority.indexOf(b),
  );
  const focus = ordered.slice(0, 2);
  const questions = focus.map((f) => FIELD_QUESTIONS[f]);
  if (focus.length === 1) return questions[0] ?? null;
  // Join two questions naturally.
  const [first, second] = questions as [string, string];
  const lowerSecond = second.charAt(0).toLowerCase() + second.slice(1);
  const firstTrimmed = first.endsWith("?") ? first.slice(0, -1) : first;
  return `${firstTrimmed}, and ${lowerSecond}`;
}

// ---------------------------------------------------------------------------
// Draft → validated policy → wizard/contract inputs
// ---------------------------------------------------------------------------

export interface DraftToPolicyResult {
  policy: PaymentPolicy | null;
  missing: MissingField[];
  errors: string[];
}

/** Truncate to max chars without cutting mid-word (falls back to hard slice). */
export function truncateAtWordBoundary(s: string, max = 32): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) return slice.slice(0, lastSpace).trim();
  return slice;
}

/** Deterministic validation: only validated values become a policy. */
export function draftToPolicy(draft: PaymentIntentDraft): DraftToPolicyResult {
  const errors: string[] = [];
  const missing = buildMissingFields(draft);

  const chainId = resolveCommandChainId(draft.chainId);
  if (chainId === null) {
    errors.push("Unsupported network.");
  }
  const effectiveChain = chainId ?? COMMAND_DEFAULT_CHAIN_ID;

  let worker: string | null = null;
  if (draft.recipient) {
    if (isValidWorkerAddress(draft.recipient)) {
      worker = draft.recipient.trim();
    } else {
      errors.push("Invalid recipient address.");
    }
  }

  let amountRaw: bigint | null = null;
  let amountHuman: string | null = null;
  if (draft.amount) {
    const parsed = validateCommandAmount(draft.amount, effectiveChain);
    if (parsed) {
      amountRaw = parsed.raw;
      amountHuman = parsed.normalized;
    } else {
      errors.push("Invalid amount.");
    }
  }

  let asset: "USA₮" | "USDC" | null = null;
  if (draft.asset) {
    const canonical = canonicalizeAsset(draft.asset, effectiveChain);
    if (canonical) {
      asset = canonical;
    } else {
      errors.push("Unsupported asset.");
    }
  }

  let deadlineUnix = 0;
  if (draft.deadlineDate) {
    if (isValidFutureDeadline(draft.deadlineDate)) {
      deadlineUnix = dateToUnixTimestamp(draft.deadlineDate);
    } else {
      errors.push("Invalid deadline.");
    }
  }

  const title = truncateAtWordBoundary((draft.purpose ?? draft.jobType ?? "").trim(), 32);
  const deliverableSummary = truncateAtWordBoundary(
    (draft.deliverables?.[0] ?? draft.purpose ?? "").trim(),
    32,
  );
  if (title && utf8ByteLength(title) > 32) {
    errors.push("Title too long.");
  }

  if (errors.length > 0 || !worker || !amountRaw || !amountHuman || !asset) {
    return { policy: null, missing, errors };
  }

  const releaseMode: ReleaseMode = draft.releaseMode ?? "manual";
  const policy: PaymentPolicy = {
    worker: worker as `0x${string}`,
    amountHuman,
    amountRaw: amountRaw.toString(),
    asset,
    chainId: effectiveChain as 42220 | 11142220,
    title: title || "Protected payment",
    deliverableSummary: deliverableSummary || title || "Delivery",
    deliveryFormat: "",
    deadlineDate: draft.deadlineDate ?? "",
    deadlineUnix,
    evidenceExpectation: (draft.evidenceRequirements?.[0] ?? "").slice(0, 160),
    releaseMode,
    releaseRule: releaseModeToRule(releaseMode),
    deliverables: draft.deliverables ?? [],
    evidenceRequirements: draft.evidenceRequirements ?? [],
  };

  const parsed = paymentPolicySchema.safeParse(policy);
  if (!parsed.success) {
    return {
      policy: null,
      missing,
      errors: parsed.error.issues.map((i) => i.message),
    };
  }
  // Deadline is required for a ready policy; without it the draft stays in
  // clarification even if every other field validates.
  if (!draft.deadlineDate || deadlineUnix === 0) {
    return { policy: null, missing, errors };
  }
  return { policy: parsed.data, missing, errors: [] };
}

/** Ready when every critical field validates into a policy. */
export function isDraftReady(draft: PaymentIntentDraft): boolean {
  const { policy } = draftToPolicy(draft);
  return policy !== null;
}

/** Merge a follow-up draft into the base without losing prior fields. */
export function mergeDrafts(
  base: PaymentIntentDraft,
  update: PaymentIntentDraft,
): PaymentIntentDraft {
  const merged: PaymentIntentDraft = { ...base };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  // Chain stays canonical unless the update explicitly sets a supported one.
  if (update.chainId === undefined) {
    merged.chainId = base.chainId;
  }
  const parsed = paymentIntentDraftSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}
