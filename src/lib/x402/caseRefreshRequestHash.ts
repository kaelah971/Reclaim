// ---------------------------------------------------------------------------
// Case Refresh Request Hash
//
// Computes a deterministic keccak256 hash for idempotent payment deduplication.
// Uses the same pattern as computeEvidenceCheckHash in requestHash.ts.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import type { CaseRefreshInput } from "./caseRefreshValidation";
import { CASE_REFRESH_SERVICE_IDENTIFIER } from "./caseRefreshValidation";

// ---------------------------------------------------------------------------
// Address regex (shared with requestHash.ts pattern)
// ---------------------------------------------------------------------------

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address");

// ---------------------------------------------------------------------------
// Canonical identity schema for case-refresh
// ---------------------------------------------------------------------------

export const caseRefreshIdentitySchema = z.object({
  service: z.literal("case-refresh"),
  escrowChainId: z.string().optional(),
  escrowContractAddress: addressSchema.optional(),
  escrowPaymentId: z.string().min(1),
  payer: addressSchema,
  paymentNetwork: z.string().min(1),
  asset: z.string().min(1),
  payTo: addressSchema,
  amount: z.string().min(1),
  scheme: z.string().min(1),
  caseRefreshInputHash: z.string().min(1),
});

export type CaseRefreshIdentity = z.infer<typeof caseRefreshIdentitySchema>;

// ---------------------------------------------------------------------------
// Compute the deterministic input hash from case refresh fields
// ---------------------------------------------------------------------------

export function computeCaseRefreshInputHash(input: CaseRefreshInput): string {
  // Build a deterministic pipe-delimited string from the key fields.
  // Field order is fixed to ensure hash stability.
  const escrowPart = input.escrowChainId && input.escrowContractAddress
    ? `${input.escrowChainId}:${input.escrowContractAddress.toLowerCase()}|`
    : "";

  const fields = [
    `${escrowPart}paymentId:${input.escrowPaymentId}`,
    `agreement:${input.agreementLabel}`,
    `deliverable:${input.deliverableSummary}`,
    `deliveryFormat:${input.deliveryFormat}`,
    `releaseRule:${input.releaseRule}`,
    `evidenceExpectation:${input.evidenceExpectation}`,
    `escrowState:${input.escrowState}`,
    `caseVersionHash:${input.caseVersionHash}`,
    `evidenceVersionHash:${input.evidenceVersionHash}`,
    `evidenceAvailability:${input.evidenceAvailability}`,
    `evidenceRef:${input.evidenceReference ?? "none"}`,
    `evidenceCount:${input.evidenceCount}`,
    `openRequests:${input.openEvidenceRequests.length}`,
    `fulfilledRequests:${input.fulfilledEvidenceRequests.length}`,
    `prevQuality:${input.previousQualityCheck?.readiness ?? "none"}`,
    `prevRefreshHash:${input.previousCaseRefresh?.caseVersionHash ?? "none"}`,
  ];
  return keccak256(stringToHex(fields.join("|")));
}

// ---------------------------------------------------------------------------
// Compute request hash from validated identity
// ---------------------------------------------------------------------------

export function computeCaseRefreshHash(identity: CaseRefreshIdentity): string {
  caseRefreshIdentitySchema.parse(identity);

  const parts: string[] = [];

  if (identity.escrowChainId && identity.escrowContractAddress) {
    parts.push(
      `escrow:${identity.escrowChainId}:${identity.escrowContractAddress.toLowerCase()}`,
    );
  }

  parts.push(
    identity.service,
    identity.escrowPaymentId,
    identity.caseRefreshInputHash,
    identity.payer.toLowerCase(),
    identity.paymentNetwork,
    identity.amount,
    identity.payTo.toLowerCase(),
    identity.scheme,
    identity.asset.toLowerCase(),
  );

  return keccak256(stringToHex(parts.join(":")));
}

// ---------------------------------------------------------------------------
// Convenience wrapper: build identity from input → compute hash
// ---------------------------------------------------------------------------

export function computeCaseRefreshHashFromInput(
  input: CaseRefreshInput,
  payer: string,
  network: string,
  asset: string,
  payTo: string,
  amount: string,
): string {
  const inputHash = computeCaseRefreshInputHash(input);
  const identity: CaseRefreshIdentity = {
    service: CASE_REFRESH_SERVICE_IDENTIFIER,
    escrowChainId: input.escrowChainId,
    escrowContractAddress: input.escrowContractAddress as `0x${string}` | undefined,
    escrowPaymentId: input.escrowPaymentId,
    payer: payer.toLowerCase(),
    paymentNetwork: network,
    asset,
    payTo: payTo.toLowerCase(),
    amount,
    scheme: "exact",
    caseRefreshInputHash: inputHash,
  };
  return computeCaseRefreshHash(identity);
}
