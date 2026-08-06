// ---------------------------------------------------------------------------
// Case Refresh Input Builder
//
// Builds the CaseRefreshInput for the x402 service from the agent's current
// observation.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, AgentCaseIdentity } from "../types";
import type { CaseRefreshInput } from "../../x402/caseRefreshValidation";

// ---------------------------------------------------------------------------
// Build CaseRefreshInput from observation
// ---------------------------------------------------------------------------

export function buildCaseRefreshInput(
  caseIdentity: AgentCaseIdentity,
  observation: NonNullable<ResolutionAgent["observation"]>,
): Omit<CaseRefreshInput, "escrowChainId" | "escrowContractAddress"> &
  Partial<Pick<CaseRefreshInput, "escrowChainId" | "escrowContractAddress">> {
  const escrowState = observation.escrowState || "unknown";

  // Evidence availability heuristic
  const evidenceAvailability =
    observation.evidenceCount > 0
      ? "metadata_available"
      : "none";

  // Separate open from fulfilled gaps
  const openEvidenceRequests = (observation.unresolvedGaps ?? [])
    .filter((g) => g.status === "open")
    .map((g) => ({
      party: g.responsibleParty,
      item: g.description,
      status: g.status,
    }));

  const fulfilledEvidenceRequests = (observation.unresolvedGaps ?? [])
    .filter((g) => g.status === "fulfilled")
    .map((g) => ({
      party: g.responsibleParty,
      item: g.description,
    }));

  return {
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    escrowPaymentId: caseIdentity.escrowPaymentId,
    agreementLabel: "Case observation",
    deliverableSummary: `Escrow payment ${caseIdentity.escrowPaymentId} — ${escrowState}`,
    deliveryFormat: "digital",
    releaseRule: "standard",
    evidenceExpectation: "Relevant evidence for dispute resolution",
    escrowState,
    caseVersionHash: observation.caseVersionHash,
    evidenceVersionHash: observation.evidenceVersionHash,
    evidenceAvailability,
    evidenceReference: null,
    evidenceCount: observation.evidenceCount,
    openEvidenceRequests,
    fulfilledEvidenceRequests,
    previousQualityCheck: null,
    previousCaseRefresh: null,
  };
}
