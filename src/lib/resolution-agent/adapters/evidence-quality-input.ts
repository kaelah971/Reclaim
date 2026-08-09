// ---------------------------------------------------------------------------
// Evidence Quality Input Builder
//
// Builds a service input (EvidenceCheckRequestInput + extra metadata fields)
// from the agent's current observation.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { ResolutionAgent, AgentCaseIdentity } from "../types";
import type { EvidenceCheckRequestInput } from "../../x402/evidenceCheckValidation";

// ---------------------------------------------------------------------------
// Extended service input — includes extra routing / payment fields that the
// Zod-validated EvidenceCheckRequestInput does not model.
// ---------------------------------------------------------------------------

export interface ServiceInput extends EvidenceCheckRequestInput {
  escrowChainId: string;
  escrowContractAddress: string;
  payer: string;
  paymentNetwork: string;
  asset: string;
  payTo: string;
  amount: string;
  scheme: string;
  evidenceInputHash: string;
}

// ---------------------------------------------------------------------------
// Build ServiceInput from observation
// ---------------------------------------------------------------------------

export interface EvidenceInputFacts {
  title?: string | null;
  description?: string | null;
  evidenceType?: string | null;
  relatedClaim?: string | null;
  pastedText?: string | null;
  evidenceDate?: string | null;
  externalRef?: string | null;
  fileHash?: string | null;
}

/**
 * Build a service input for the evidence-quality-check tool.
 *
 * When durable evidence facts are provided (RA1R.8D), ALL substantive fields
 * that exist are carried through verbatim — title, description, type, claim,
 * pasted text, date, external ref, file hash. Fields that do not exist stay
 * empty; nothing is fabricated. Without facts (legacy observations) the
 * previous counter-based fallback is preserved.
 */
export function buildEvidenceCheckInput(
  caseIdentity: AgentCaseIdentity,
  observation: NonNullable<ResolutionAgent["observation"]>,
  facts?: EvidenceInputFacts,
): ServiceInput {
  const escrowState = observation.escrowState || "";

  const hasFacts = facts && (facts.pastedText || facts.description || facts.relatedClaim);

  const evidenceTitle =
    (hasFacts && facts!.title && facts!.title.trim().length > 0
      ? facts!.title
      : escrowState) || "Case Evidence";
  const evidenceDescription =
    hasFacts && facts!.description
      ? facts!.description
      : `Evidence count: ${observation.evidenceCount}. ` +
        `Has meaningful change: ${observation.hasMeaningfulChange}. ` +
        `Unresolved gaps: ${observation.unresolvedGaps?.length ?? 0}.`;
  const evidenceType =
    hasFacts && facts!.evidenceType && facts!.evidenceType.trim().length > 0
      ? facts!.evidenceType
      : "case_evidence";
  const relatedClaim =
    hasFacts && facts!.relatedClaim && facts!.relatedClaim.trim().length > 0
      ? facts!.relatedClaim
      : "";
  const pastedText =
    hasFacts && facts!.pastedText && facts!.pastedText.trim().length > 0
      ? facts!.pastedText
      : "";
  const evidenceDate =
    hasFacts && facts!.evidenceDate && facts!.evidenceDate.trim().length > 0
      ? facts!.evidenceDate
      : "";
  const externalRef =
    hasFacts && facts!.externalRef && facts!.externalRef.trim().length > 0
      ? facts!.externalRef
      : "";
  const fileHash = hasFacts && facts!.fileHash ? facts!.fileHash : "";

  return {
    // Zod-validated fields
    escrowPaymentId: caseIdentity.escrowPaymentId,
    evidenceTitle,
    evidenceDescription,
    evidenceType,
    relatedClaim,
    evidenceDate,
    externalRef,
    pastedText,
    fileHash,

    // Extended fields (not in Zod schema)
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    payer: "", // set by caller
    paymentNetwork: "", // set by caller
    asset: "", // set by caller
    payTo: "", // set by caller
    amount: "", // set by caller
    scheme: "exact",
    evidenceInputHash: "", // computed separately
  };
}

// ---------------------------------------------------------------------------
// Compute evidence input hash
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic evidence input hash from the evidence-specific
 * fields.  Uses the same fixed-field-order pipe-delimited algorithm as the
 * evidence-check API route.
 */
export function computeEvidenceInputHash(input: EvidenceCheckRequestInput | ServiceInput): string {
  const fields = [
    input.evidenceTitle,
    input.evidenceDescription || "",
    input.evidenceType || "",
    input.relatedClaim || "",
    input.evidenceDate || "",
    input.externalRef || "",
    input.pastedText || "",
    input.fileHash || "",
  ];
  return keccak256(stringToHex(fields.join("|")));
}
