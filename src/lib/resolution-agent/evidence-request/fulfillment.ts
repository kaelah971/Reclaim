// ---------------------------------------------------------------------------
// Evidence Request Fulfillment Service
//
// Marks an evidence request as fulfilled ONLY when there is durable proof
// that matching evidence was accepted on-chain.  The on-chain evidenceReference
// (a keccak256 hash) is verified against a stored preimage containing the
// request ID, ensuring deterministic reconciliation after process crashes.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { EvidenceRequestRow } from "../store/types";
import type { FulfillmentStore } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREIMAGE_PREFIX = "reclaim-evidence-request:";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FulfillEvidenceRequestParams {
  agentId: string;
  requestId: string;
  fulfilledBy: "client" | "worker";
  caseVersionHash: string;
  evidenceVersionHash: string;
  /** The on-chain bytes32 evidenceReference (0x-prefixed hex). */
  evidenceReference: string;
  /** The preimage used to compute the evidenceReference hash. */
  preimage: string;
  now: number;
  store: FulfillmentStore;
}

/**
 * Mark an evidence request as fulfilled with durable proof.
 *
 * Validates:
 *  1. Request exists and belongs to the given agent
 *  2. Fulfiller matches the request's responsible_party
 *  3. Request is in "open" status (idempotent if already fulfilled)
 *  4. evidenceReference is a valid keccak256 hash (0x + 64 hex)
 *  5. keccak256(preimage) === evidenceReference
 *  6. Preimage contains the request ID (format: "reclaim-evidence-request:ID:...")
 *
 * On success, stores both evidenceReference and preimage durably and
 * appends one `evidence_request_fulfilled` event.
 *
 * Safety invariants:
 *  - No budget change
 *  - No wallet decryption
 *  - No settlement
 *  - No secrets in results or events
 *  - Fulfillment requires cryptographic proof, not mere assertion
 */
export async function fulfillEvidenceRequest(
  params: FulfillEvidenceRequestParams,
): Promise<EvidenceRequestRow> {
  const { agentId, requestId, fulfilledBy, caseVersionHash, evidenceVersionHash, evidenceReference, preimage, now, store } = params;

  // 1. Load and validate the request
  const allRequests = await store.listEvidenceRequests(agentId);
  const request = allRequests.find((r) => r.id === requestId);

  if (!request) {
    throw new Error(`Evidence request "${requestId}" not found for agent "${agentId}".`);
  }

  if (request.agent_id !== agentId) {
    throw new Error(`Evidence request "${requestId}" does not belong to agent "${agentId}".`);
  }

  if (request.responsible_party !== fulfilledBy) {
    throw new Error(
      `Only the responsible party ("${request.responsible_party}") may fulfill this request. Received "${fulfilledBy}".`,
    );
  }

  // 2. Idempotent: already fulfilled
  if (request.status === "fulfilled") {
    return request;
  }

  if (request.status === "cancelled") {
    throw new Error(
      `Evidence request "${requestId}" is cancelled and cannot be fulfilled.`,
    );
  }

  if (request.status !== "open") {
    throw new Error(
      `Evidence request "${requestId}" has status "${request.status}" and cannot be fulfilled.`,
    );
  }

  // 3. Cryptographic proof: evidenceReference MUST be a valid keccak256 hash
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidenceReference)) {
    throw new Error(
      `Invalid evidenceReference: "${evidenceReference}". Must be a 0x-prefixed 64-character hex string (keccak256).`,
    );
  }

  if (evidenceReference === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("evidenceReference must not be the zero hash.");
  }

  // 4. Cryptographic proof: preimage must hash to evidenceReference
  const computedHash = keccak256(stringToHex(preimage));
  if (computedHash.toLowerCase() !== evidenceReference.toLowerCase()) {
    throw new Error(
      `Preimage does not hash to the given evidenceReference. Computed: ${computedHash}, expected: ${evidenceReference}.`,
    );
  }

  // 5. Preimage must contain the request ID to prove this evidence is FOR this request
  if (!preimage.includes(requestId)) {
    throw new Error(
      `Preimage does not reference the request ID "${requestId}". The preimage must include the request ID to prove association.`,
    );
  }

  const fulfilledAt = new Date(now).toISOString();

  // 6. Persist durable fulfillment with proof
  await store.updateEvidenceRequest(agentId, requestId, {
    status: "fulfilled",
    fulfilled_case_version_hash: caseVersionHash,
    fulfilled_at: fulfilledAt,
    fulfillment_evidence_reference: evidenceReference.toLowerCase(),
    evidence_preimage: preimage,
  });

  // 7. Append event
  await store.appendEvent(
    agentId,
    "evidence_request_fulfilled",
    `Evidence request "${request.id}" fulfilled by ${fulfilledBy} with verifiable on-chain proof`,
    null,
    null,
    {
      evidenceRequestId: request.id,
      responsibleParty: request.responsible_party,
      caseVersionHash,
      evidenceVersionHash,
      evidenceReference: evidenceReference.toLowerCase(),
      fulfilledBy,
    },
  );

  return {
    ...request,
    status: "fulfilled",
    fulfilled_case_version_hash: caseVersionHash,
    fulfilled_at: fulfilledAt,
    fulfillment_evidence_reference: evidenceReference.toLowerCase(),
    evidence_preimage: preimage,
  };
}

// ---------------------------------------------------------------------------
// Preimage helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical evidence preimage for a given request and manifest.
 *
 * Format: "reclaim-evidence-request:" + requestId + ":" + manifestContent
 *
 * This format ensures:
 *  - The request ID is verifiably part of the preimage
 *  - Ordinary (non-agent) evidence continues to use a different format
 *    (no prefix, so no collision)
 *  - The manifest content is still part of the hash for content-addressing
 */
export function buildEvidencePreimage(requestId: string, manifest: string): string {
  return `${PREIMAGE_PREFIX}${requestId}:${manifest}`;
}

/**
 * Verify that a preimage references the given request ID.
 */
export function preimageContainsRequestId(preimage: string, requestId: string): boolean {
  return preimage.includes(requestId);
}
