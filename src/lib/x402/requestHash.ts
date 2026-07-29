import { keccak256, stringToHex } from "viem";
import { z } from "zod";

export const SERVICE_IDENTIFIER = "reclaim-dispute-brief-v1";
export const EVIDENCE_CHECK_SERVICE_IDENTIFIER = "evidence-quality-check";

// ---------------------------------------------------------------------------
// Strict canonical identity — Zod-validated before hashing
// ---------------------------------------------------------------------------

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address");

export const canonicalRequestIdentitySchema = z.object({
  service: z.string().min(1),
  escrowChainId: z.string().optional(),
  escrowContractAddress: addressSchema.optional(),
  escrowPaymentId: z.string().min(1),
  payer: addressSchema,
  paymentNetwork: z.string().min(1),
  asset: z.string().min(1),
  payTo: addressSchema,
  amount: z.string().min(1),
  scheme: z.string().min(1),
  disputeReason: z.string().min(1),
  requestedOutcome: z.string().min(1),
});

export type CanonicalRequestIdentity = z.infer<typeof canonicalRequestIdentitySchema>;

// ---------------------------------------------------------------------------
// Evidence-check canonical identity — separate schema for evidence quality checks
// ---------------------------------------------------------------------------

export const evidenceCheckIdentitySchema = z.object({
  service: z.literal("evidence-quality-check"),
  escrowChainId: z.string().optional(),
  escrowContractAddress: addressSchema.optional(),
  escrowPaymentId: z.string().min(1),
  payer: addressSchema,
  paymentNetwork: z.string().min(1),
  asset: z.string().min(1),
  payTo: addressSchema,
  amount: z.string().min(1),
  scheme: z.string().min(1),
  evidenceInputHash: z.string().min(1),
});

export type EvidenceCheckIdentity = z.infer<typeof evidenceCheckIdentitySchema>;

// ---------------------------------------------------------------------------
// Legacy loose type (kept for backward compatibility in local-mode tests)
// ---------------------------------------------------------------------------

export interface RequestHashParams {
  paymentId: string;
  disputeReason: string;
  requestedOutcome: string;
  buyerAddress: string;
  network: string;
  serviceIdentifier?: string;
  price: string;
  payToAddress: string;
  escrowChainId?: string;
  escrowContractAddress?: string;
}

// ---------------------------------------------------------------------------
// Compute request hash from a validated canonical identity
// ---------------------------------------------------------------------------

export function computeCanonicalRequestHash(identity: CanonicalRequestIdentity): string {
  // Validate before hashing — prevents undefined.toLowerCase etc.
  canonicalRequestIdentitySchema.parse(identity);

  const parts: string[] = [];

  if (identity.escrowChainId && identity.escrowContractAddress) {
    parts.push(
      `escrow:${identity.escrowChainId}:${identity.escrowContractAddress.toLowerCase()}`,
    );
  }

  parts.push(
    identity.service,
    identity.escrowPaymentId,
    identity.disputeReason,
    identity.requestedOutcome,
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
// Compute evidence check request hash from a validated evidence-check identity
// ---------------------------------------------------------------------------

export function computeEvidenceCheckHash(identity: EvidenceCheckIdentity): string {
  // Validate before hashing
  evidenceCheckIdentitySchema.parse(identity);

  const parts: string[] = [];

  if (identity.escrowChainId && identity.escrowContractAddress) {
    parts.push(
      `escrow:${identity.escrowChainId}:${identity.escrowContractAddress.toLowerCase()}`,
    );
  }

  parts.push(
    identity.service,
    identity.escrowPaymentId,
    identity.evidenceInputHash,
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
// Legacy: computeRequestHash (kept for backward compatibility)
// Now delegates to the canonical version after validation.
// ---------------------------------------------------------------------------

export function computeRequestHash(params: RequestHashParams): string {
  const service = params.serviceIdentifier || SERVICE_IDENTIFIER;

  // Validate required fields exist before calling .toLowerCase()
  if (!params.buyerAddress || typeof params.buyerAddress !== "string") {
    throw new Error(
      "computeRequestHash: buyerAddress is required and must be a string. " +
      "Got: " + String(params.buyerAddress),
    );
  }
  if (!params.payToAddress || typeof params.payToAddress !== "string") {
    throw new Error(
      "computeRequestHash: payToAddress is required and must be a string. " +
      "Got: " + String(params.payToAddress),
    );
  }

  const identity: CanonicalRequestIdentity = {
    service,
    escrowChainId: params.escrowChainId,
    escrowContractAddress: params.escrowContractAddress,
    escrowPaymentId: params.paymentId,
    payer: params.buyerAddress,
    paymentNetwork: params.network,
    asset: "unknown", // legacy — asset was not tracked in old hashes
    payTo: params.payToAddress,
    amount: params.price,
    scheme: "exact",
    disputeReason: params.disputeReason,
    requestedOutcome: params.requestedOutcome,
  };

  return computeCanonicalRequestHash(identity);
}
