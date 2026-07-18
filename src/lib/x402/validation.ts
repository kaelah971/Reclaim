// ---------------------------------------------------------------------------
// x402 dispute brief request validation (Zod)
//
// Server-side request body validation for POST /api/x402/dispute-brief.
// Validates the dispute brief input fields before generating the brief.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid hex address")
  .optional();

const paymentStateSchema = z
  .enum([
    "Created",
    "Funded",
    "Accepted",
    "DeliverySubmitted",
    "ReleaseRequested",
    "Released",
    "Disputed",
    "Cancelled",
  ] as const)
  .optional();

const timelineEntrySchema = z.object({
  date: z.string().min(1, "Date is required"),
  description: z.string().min(1, "Description is required"),
});

/** Shape of the dispute brief request body. */
export const disputeBriefRequestSchema = z.object({
  /** Payment ID from the escrow contract (bigint passed as string). */
  paymentId: z
    .string()
    .refine((v) => /^[0-9]+$/.test(v), "paymentId must be a numeric string"),

  /** Optional descriptive title for the agreement. */
  agreementTitle: z.string().optional(),

  /** Address of the client party (0x-prefixed hex). */
  clientAddress: addressSchema,

  /** Address of the worker party (0x-prefixed hex). */
  workerAddress: addressSchema,

  /** Protected amount as a human-readable string (e.g. "100.00"). */
  protectedAmount: z.string().optional(),

  /** Current on-chain payment state (if known by the caller). */
  currentPaymentState: paymentStateSchema,

  /** Summary of what was agreed to be delivered. */
  agreedDeliverables: z.string().optional(),

  /** Deadline for delivery (ISO 8601 or human-readable). */
  deadline: z.string().optional(),

  /** Release terms / conditions. */
  releaseTerms: z.string().optional(),

  /** URLs or labels of evidence the caller references. */
  evidenceReferences: z.array(z.string()).optional(),

  /** The core reason this dispute is being raised. */
  disputeReason: z.string().min(1, "disputeReason is required"),

  /** What the requester expects as the outcome. */
  requestedOutcome: z.string().min(1, "requestedOutcome is required"),

  /** Chronological entries describing key events. */
  relevantTimelineEntries: z
    .array(timelineEntrySchema)
    .optional(),
});

/** Inferred type from the Zod schema. */
export type DisputeBriefRequestInput = z.infer<
  typeof disputeBriefRequestSchema
>;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Result shape returned by parseDisputeBriefRequest. */
export interface ParseResult<T> {
  success: true;
  data: T;
}

export interface ParseError {
  success: false;
  errors: Record<string, string[]>;
}

export type DisputeBriefParseResult =
  | ParseResult<DisputeBriefRequestInput>
  | ParseError;

/**
 * Validate and parse a dispute brief request body.
 *
 * Returns either a success result with the parsed data or a structured
 * error result with field-level validation messages.
 */
export function parseDisputeBriefRequest(
  body: unknown,
): DisputeBriefParseResult {
  const result = disputeBriefRequestSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Map Zod v4 issues into a Record<string, string[]> shape
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return { success: false, errors };
}
