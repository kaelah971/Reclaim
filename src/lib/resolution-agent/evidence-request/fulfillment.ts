// ---------------------------------------------------------------------------
// Evidence Request Fulfillment Service
//
// Marks an evidence request as fulfilled when the responsible party has
// durably supplied the requested evidence.  Enforces responsible-party
// authorization, validates request ownership, and ensures idempotency.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { EvidenceRequestRow } from "../store/types";
import type { FulfillmentStore } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FulfillEvidenceRequestParams {
  agentId: string;
  requestId: string;
  fulfilledBy: "client" | "worker";
  caseVersionHash: string;
  evidenceVersionHash: string;
  now: number;
  store: FulfillmentStore;
}

/**
 * Mark an evidence request as fulfilled.
 *
 * Validates:
 *  - Request exists and belongs to the given agent
 *  - Fulfiller matches the request's responsible_party
 *  - Request is in "open" status (idempotent if already fulfilled)
 *  - Request is not cancelled
 *
 * On success, updates the request row and appends one
 * `evidence_request_fulfilled` event.
 *
 * Safety invariants:
 *  - No budget change
 *  - No wallet decryption
 *  - No settlement
 *  - No secrets in results or events
 */
export async function fulfillEvidenceRequest(
  params: FulfillEvidenceRequestParams,
): Promise<EvidenceRequestRow> {
  const { agentId, requestId, fulfilledBy, caseVersionHash, evidenceVersionHash, now, store } = params;

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

  const fulfilledAt = new Date(now).toISOString();

  await store.updateEvidenceRequest(agentId, requestId, {
    status: "fulfilled",
    fulfilled_case_version_hash: caseVersionHash,
    fulfilled_at: fulfilledAt,
  });

  await store.appendEvent(
    agentId,
    "evidence_request_fulfilled",
    `Evidence request "${request.id}" fulfilled by ${fulfilledBy}`,
    null,
    null,
    {
      evidenceRequestId: request.id,
      responsibleParty: request.responsible_party,
      caseVersionHash,
      evidenceVersionHash,
      fulfilledBy,
    },
  );

  return {
    ...request,
    status: "fulfilled",
    fulfilled_case_version_hash: caseVersionHash,
    fulfilled_at: fulfilledAt,
  };
}
