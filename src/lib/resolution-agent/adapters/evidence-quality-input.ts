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

export function buildEvidenceCheckInput(
  caseIdentity: AgentCaseIdentity,
  observation: NonNullable<ResolutionAgent["observation"]>,
): ServiceInput {
  const escrowState = observation.escrowState || "";

  return {
    // Zod-validated fields
    escrowPaymentId: caseIdentity.escrowPaymentId,
    evidenceTitle: escrowState || "Case Evidence",
    evidenceDescription:
      `Evidence count: ${observation.evidenceCount}. ` +
      `Has meaningful change: ${observation.hasMeaningfulChange}. ` +
      `Unresolved gaps: ${observation.unresolvedGaps?.length ?? 0}.`,
    evidenceType: "case_evidence",
    relatedClaim: "",
    evidenceDate: "",
    externalRef: "",
    pastedText: "",
    fileHash: "",

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
