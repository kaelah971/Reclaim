// ---------------------------------------------------------------------------
// x402 evidence quality check request validation (Zod)
//
// Server-side request body validation for POST /api/x402/evidence-check.
// Validates the evidence check input fields before running the quality
// assessment.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const evidenceCheckRequestSchema = z.object({
  escrowPaymentId: z.string().min(1, "Escrow payment ID is required"),
  evidenceTitle: z.string().min(1, "Evidence title is required"),
  evidenceDescription: z.string().optional().default(""),
  evidenceType: z.string().optional().default(""),
  relatedClaim: z.string().optional().default(""),
  evidenceDate: z.string().optional().default(""),
  externalRef: z.string().optional().default(""),
  pastedText: z.string().optional().default(""),
  fileHash: z.string().optional().default(""),
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid wallet address")
    .optional(),
  recoveryTxHash: z.string().optional(),
});

export type EvidenceCheckRequestInput = z.infer<typeof evidenceCheckRequestSchema>;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export interface EvidenceCheckParseResult {
  success: true;
  data: EvidenceCheckRequestInput;
}

export interface EvidenceCheckParseError {
  success: false;
  errors: Record<string, string[]>;
}

export type EvidenceCheckBodyResult = EvidenceCheckParseResult | EvidenceCheckParseError;

/**
 * Validate and parse an evidence check request body.
 *
 * Returns either a success result with the parsed data or a structured
 * error result with field-level validation messages.
 */
export function parseEvidenceCheckRequest(
  body: unknown,
): EvidenceCheckBodyResult {
  const result = evidenceCheckRequestSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Convert Zod issues to a keyed errors object
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { success: false, errors };
}
