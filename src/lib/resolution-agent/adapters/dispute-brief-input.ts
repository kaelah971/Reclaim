// ---------------------------------------------------------------------------
// Dispute Brief Input Builder
//
// Builds a DisputeBriefAgentInput from the agent's current observation.
// This is the service input that feeds into the dispute brief generator.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { ResolutionAgent, AgentCaseIdentity } from "../types";
import type { NormalizedToolOutcome } from "../planner/types";

// ---------------------------------------------------------------------------
// Dispute Brief Agent Input — the canonical input shape for the generator
// ---------------------------------------------------------------------------

export interface DisputeBriefAgentInput {
  /** Escrow payment identifier */
  escrowPaymentId: string;
  /** Blockchain chain ID for the escrow contract */
  escrowChainId: string;
  /** Escrow contract address */
  escrowContractAddress: string;
  /** Client address from the escrow observation */
  clientAddress: string;
  /** Worker address from the escrow observation */
  workerAddress: string;
  /** Agreement label from the escrow */
  agreementLabel: string;
  /** Deliverable summary from the escrow */
  deliverableSummary: string;
  /** Delivery format from the escrow */
  deliveryFormat: string;
  /** Release rule from the escrow */
  releaseRule: string;
  /** Evidence expectation from the escrow */
  evidenceExpectation: string;
  /** Current escrow state (e.g. "disputed") */
  escrowState: string;
  /** Dispute reference from the escrow (if any) */
  disputeReference: string;
  /** Current case version hash */
  caseVersionHash: string;
  /** Current evidence version hash */
  evidenceVersionHash: string;
  /** Evidence availability heuristic */
  evidenceAvailability: string;
  /** Total evidence count */
  evidenceCount: number;
  /** Evidence reference / metadata existence flag */
  hasEvidenceMetadata: boolean;
  /** Latest Evidence Quality Check outcome (if settled) */
  latestQualityCheck: NormalizedToolOutcome | null;
  /** Latest Case Refresh outcome (if settled) */
  latestCaseRefresh: NormalizedToolOutcome | null;
  /** Open evidence requests (unfulfilled) */
  openEvidenceRequests: Array<{
    party: string;
    item: string;
    status: string;
  }>;
  /** Fulfilled evidence requests */
  fulfilledEvidenceRequests: Array<{
    party: string;
    item: string;
  }>;
  /** Whether the observation indicates a meaningful change */
  hasMeaningfulChange: boolean;
  /** Unresolved evidence gaps count */
  unresolvedGapsCount: number;
}

// ---------------------------------------------------------------------------
// Build DisputeBriefAgentInput from observation
// ---------------------------------------------------------------------------

export function buildDisputeBriefInput(
  caseIdentity: AgentCaseIdentity,
  observation: NonNullable<ResolutionAgent["observation"]>,
  latestQualityCheck: NormalizedToolOutcome | null,
  latestCaseRefresh: NormalizedToolOutcome | null,
): DisputeBriefAgentInput {
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
    escrowPaymentId: caseIdentity.escrowPaymentId,
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    // Client and worker addresses are derived from case identity context;
    // the agent observation captures escrowState but not parties directly.
    // These fields provide space for when party data is available.
    clientAddress: "",
    workerAddress: "",
    agreementLabel: `Escrow payment ${caseIdentity.escrowPaymentId} — ${escrowState}`,
    deliverableSummary: `Case ${caseIdentity.escrowPaymentId} in state "${escrowState}" with ${observation.evidenceCount} evidence items`,
    deliveryFormat: "digital",
    releaseRule: "standard",
    evidenceExpectation: "Relevant evidence for dispute resolution",
    escrowState,
    disputeReference: `case-${caseIdentity.escrowPaymentId}`,
    caseVersionHash: observation.caseVersionHash,
    evidenceVersionHash: observation.evidenceVersionHash,
    evidenceAvailability,
    evidenceCount: observation.evidenceCount,
    hasEvidenceMetadata: observation.evidenceCount > 0,
    latestQualityCheck,
    latestCaseRefresh,
    openEvidenceRequests,
    fulfilledEvidenceRequests,
    hasMeaningfulChange: observation.hasMeaningfulChange,
    unresolvedGapsCount: observation.unresolvedGaps?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Compute dispute brief input hash
//
// Deterministic pipe-delimited hash of the input fields, following the same
// pattern as computeEvidenceInputHash / computeCaseRefreshInputHash.
// ---------------------------------------------------------------------------

export function computeDisputeBriefInputHash(input: DisputeBriefAgentInput): string {
  const fields = [
    input.escrowPaymentId,
    input.escrowChainId,
    input.escrowContractAddress,
    input.agreementLabel,
    input.deliverableSummary,
    input.deliveryFormat,
    input.releaseRule,
    input.evidenceExpectation,
    input.escrowState,
    input.disputeReference,
    input.caseVersionHash,
    input.evidenceVersionHash,
    input.evidenceAvailability,
    String(input.evidenceCount),
    String(input.hasEvidenceMetadata),
    input.latestQualityCheck?.kind ?? "none",
    input.latestCaseRefresh?.kind ?? "none",
    String(input.hasMeaningfulChange),
    String(input.unresolvedGapsCount),
  ];
  return keccak256(stringToHex(fields.join("|")));
}
