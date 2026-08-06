// ---------------------------------------------------------------------------
// Case Refresh Input Zod Schema + Types
//
// Validates the request body for POST /api/x402/case-refresh.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Service identifier
// ---------------------------------------------------------------------------

export const CASE_REFRESH_SERVICE_IDENTIFIER = "case-refresh";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const evidenceRequestItemSchema = z.object({
  party: z.string().min(1),
  item: z.string().min(1),
  status: z.string().min(1),
});

const fulfilledEvidenceRequestItemSchema = z.object({
  party: z.string().min(1),
  item: z.string().min(1),
});

const previousQualityCheckSchema = z.object({
  readiness: z.string().min(1),
  missingEvidence: z.array(z.string()),
  reviewerQuestions: z.array(z.string()),
});

const previousCaseRefreshSchema = z.object({
  caseVersionHash: z.string().min(1),
  readiness: z.string().min(1),
  unresolvedGaps: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Main input schema
// ---------------------------------------------------------------------------

export const caseRefreshInputSchema = z.object({
  escrowChainId: z.string().optional(),
  escrowContractAddress: z.string().optional(),
  escrowPaymentId: z.string().min(1),
  agreementLabel: z.string().min(1),
  deliverableSummary: z.string().min(1),
  deliveryFormat: z.string().min(1),
  releaseRule: z.string().min(1),
  evidenceExpectation: z.string().min(1),
  escrowState: z.string().min(1),
  caseVersionHash: z.string().min(1),
  evidenceVersionHash: z.string().min(1),
  evidenceAvailability: z.string().min(1),
  evidenceReference: z.string().nullable().optional(),
  evidenceCount: z.number().int().nonnegative(),
  openEvidenceRequests: z.array(evidenceRequestItemSchema),
  fulfilledEvidenceRequests: z.array(fulfilledEvidenceRequestItemSchema),
  previousQualityCheck: previousQualityCheckSchema.nullable().optional(),
  previousCaseRefresh: previousCaseRefreshSchema.nullable().optional(),
  // Recovery / preflight fields
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid wallet address")
    .optional(),
  recoveryTxHash: z.string().optional(),
});

export type CaseRefreshInput = z.infer<typeof caseRefreshInputSchema>;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export interface CaseRefreshParseResult {
  success: true;
  data: CaseRefreshInput;
}

export interface CaseRefreshParseError {
  success: false;
  errors: Record<string, string[]>;
}

export type CaseRefreshBodyResult = CaseRefreshParseResult | CaseRefreshParseError;

export function parseCaseRefreshRequest(body: unknown): CaseRefreshBodyResult {
  const result = caseRefreshInputSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { success: false, errors };
}
