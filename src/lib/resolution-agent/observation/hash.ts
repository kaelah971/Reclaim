// ---------------------------------------------------------------------------
// Deterministic Case-Version Hashing
//
// evidenceVersionHash — derived from evidence metadata only
// caseVersionHash — derived from full case state + evidenceVersionHash
//
// Uses keccak256 from viem for consistency with the x402 module.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import { canonicalize } from "./canonicalize";
import type {
  CaseObservation,
  CaseChangeSummary,
  ChangeReasonCode,
} from "./types";
import { CaseObservationHashError } from "./errors";

// ---------------------------------------------------------------------------
// computeEvidenceVersionHash
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic evidence-version hash from the evidence portion
 * of a case observation.
 *
 * Hash inputs:
 *  - evidenceReference, title, evidenceType, description, relatedDeliverable,
 *    fileCount, latestUpdateTimestamp, availability
 *
 * Output: 0x-prefixed 64-hex-char keccak256 hash.
 */
export function computeEvidenceVersionHash(
  observation: CaseObservation,
): string {
  try {
    const evidenceInput = {
      evidenceReference: observation.evidence.evidenceReference,
      title: observation.evidence.title,
      evidenceType: observation.evidence.evidenceType,
      description: observation.evidence.description,
      relatedDeliverable: observation.evidence.relatedDeliverable,
      fileCount: observation.evidence.fileCount,
      latestUpdateTimestamp: observation.evidence.latestUpdateTimestamp,
      availability: observation.evidence.availability,
    };

    const canonicalJson = canonicalize(evidenceInput);
    return keccak256(stringToHex(canonicalJson));
  } catch (error) {
    throw new CaseObservationHashError(
      `Failed to compute evidence version hash: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// computeCaseVersionHash
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic case-version hash from the complete case
 * observation and the evidence-version hash.
 *
 * Hash inputs:
 *  - schemaVersion, full caseIdentity, full escrow state, evidenceVersionHash
 *  - Prior tool results (toolId, settled, settledAt)
 *  - Open evidence requests (id, responsibleParty, status)
 *  - Fulfilled evidence requests (fulfilledAt)
 *
 * Excluded from hash:
 *  - observedAt, updatedAt, event IDs, correlation IDs, budget amounts,
 *    encrypted secret, worker lease, store version
 *
 * Output: 0x-prefixed 64-hex-char keccak256 hash.
 */
export function computeCaseVersionHash(
  observation: CaseObservation,
  evidenceVersionHash: string,
): string {
  try {
    // Build a structured input that contains only hash-relevant fields.
    // All addresses are normalised by canonicalize.
    const caseInput = {
      schemaVersion: observation.schemaVersion,
      caseIdentity: {
        escrowChainId: observation.caseIdentity.escrowChainId,
        escrowContractAddress: observation.caseIdentity.escrowContractAddress,
        escrowPaymentId: observation.caseIdentity.escrowPaymentId,
      },
      escrow: {
        paymentId: observation.escrow.paymentId,
        client: observation.escrow.client,
        worker: observation.escrow.worker,
        token: observation.escrow.token,
        amount: observation.escrow.amount,
        agreementLabel: observation.escrow.agreementLabel,
        deliverableSummary: observation.escrow.deliverableSummary,
        deliveryFormat: observation.escrow.deliveryFormat,
        releaseRule: observation.escrow.releaseRule,
        evidenceExpectation: observation.escrow.evidenceExpectation,
        termsHash: observation.escrow.termsHash,
        evidenceReference: observation.escrow.evidenceReference,
        disputeReference: observation.escrow.disputeReference,
        deliveryDeadline: observation.escrow.deliveryDeadline,
        autoReleaseSeconds: observation.escrow.autoReleaseSeconds,
        disputeWindowSeconds: observation.escrow.disputeWindowSeconds,
        state: observation.escrow.state,
        createdAt: observation.escrow.createdAt,
        fundedAt: observation.escrow.fundedAt,
        acceptedAt: observation.escrow.acceptedAt,
        deliveryAt: observation.escrow.deliveryAt,
        releaseRequestedAt: observation.escrow.releaseRequestedAt,
        releasedAt: observation.escrow.releasedAt,
      },
      evidenceVersionHash,
      priorToolResults: observation.priorContext.settledToolResults.map((tr) => ({
        toolId: tr.toolId,
        settled: tr.settled,
        settledAt: tr.settledAt,
      })),
      openEvidenceRequests: observation.priorContext.openEvidenceRequests.map(
        (er) => ({
          id: er.id,
          responsibleParty: er.responsibleParty,
          status: er.status,
        }),
      ),
      fulfilledEvidenceRequests: observation.priorContext.fulfilledEvidenceRequests.map(
        (er) => ({
          fulfilledAt: er.fulfilledAt,
        }),
      ),
    };

    const canonicalJson = canonicalize(caseInput);
    return keccak256(stringToHex(canonicalJson));
  } catch (error) {
    throw new CaseObservationHashError(
      `Failed to compute case version hash: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// compareCaseObservation
// ---------------------------------------------------------------------------

/**
 * Compare previous and next hashes to determine what changed.
 *
 * Returns a {@link CaseChangeSummary} with a deterministic reason code and
 * human-readable reason string.
 */
export function compareCaseObservation(params: {
  previousCaseVersionHash: string | null;
  previousEvidenceVersionHash: string | null;
  nextCaseVersionHash: string;
  nextEvidenceVersionHash: string;
}): CaseChangeSummary {
  const {
    previousCaseVersionHash: prevCase,
    previousEvidenceVersionHash: prevEv,
    nextCaseVersionHash: nextCase,
    nextEvidenceVersionHash: nextEv,
  } = params;

  const isFirstObservation = prevCase === null && prevEv === null;

  if (isFirstObservation) {
    return {
      caseChanged: true,
      evidenceChanged: true,
      firstObservation: true,
      changeType: "first_observation",
      reason: "This is the first observation of this case. A baseline case version has been established.",
    };
  }

  const caseChanged = prevCase !== nextCase;
  const evidenceChanged = prevEv !== nextEv;

  if (!caseChanged && !evidenceChanged) {
    return {
      caseChanged: false,
      evidenceChanged: false,
      firstObservation: false,
      changeType: "no_meaningful_change",
      reason: "No meaningful change detected — both case and evidence hashes are unchanged.",
    };
  }

  // Determine change type based on what changed
  let changeType: ChangeReasonCode;
  const reasons: string[] = [];

  if (evidenceChanged) {
    if (prevEv === null) {
      changeType = "evidence_added";
      reasons.push("Evidence was added (previously absent).");
    } else {
      changeType = "evidence_changed";
      reasons.push("Evidence content or metadata changed.");
    }
  } else if (caseChanged) {
    changeType = "escrow_state_changed";
    reasons.push("Escrow state changed without evidence change.");
  } else {
    // Should not reach here given the outer checks, but be defensive
    changeType = "escrow_state_changed";
    reasons.push("Case version changed.");
  }

  return {
    caseChanged,
    evidenceChanged,
    firstObservation: false,
    changeType,
    reason: reasons.join(" "),
  };
}
