// ---------------------------------------------------------------------------
// Evidence Request Reconciliation
//
// Crash-recovery path: after a process crash between on-chain evidence
// submission and database fulfillment, a fresh worker iteration reads the
// on-chain evidenceReference and deterministically finds which open request
// was satisfied by that evidence.
//
// The reconciliation relies on the evidence_preimage stored with each
// request.  The preimage (format: "reclaim-evidence-request:ID:manifest")
// is hashed and compared against the on-chain evidenceReference.  Only a
// request whose stored preimage produces a matching hash is fulfilled.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { EvidenceRequestRow } from "../store/types";
import type { FulfillmentStore } from "./types";
import { fulfillEvidenceRequest } from "./fulfillment";

// ---------------------------------------------------------------------------
// Reconciliation result
// ---------------------------------------------------------------------------

export type ReconciliationResult =
  | { kind: "reconciled"; requestId: string }
  | { kind: "already_fulfilled"; requestId: string }
  | { kind: "no_match" }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReconcileEvidenceRequestParams {
  agentId: string;
  /** The on-chain evidenceReference (0x-prefixed hex). */
  evidenceReference: string;
  /** Current case version hash from observation. */
  caseVersionHash: string;
  /** Current evidence version hash from observation. */
  evidenceVersionHash: string;
  now: number;
  store: FulfillmentStore;
}

/**
 * Attempt to reconcile an on-chain evidenceReference with an open evidence
 * request for the given agent.
 *
 * Algorithm:
 *  1. Load all evidence requests for the agent
 *  2. Check for already-fulfilled requests with matching evidenceReference
 *     → return already_fulfilled (idempotent)
 *  3. Filter open requests that have a stored evidence_preimage
 *  4. For each, compute keccak256(preimage) and compare to evidenceReference
 *  5. If exactly one match → fulfill it and return reconciled
 *  6. If multiple matches → return ambiguous (shouldn't happen with good data)
 *  7. If no match → return no_match (ordinary evidence or unknown request)
 *
 * Safety invariants:
 *  - No budget change
 *  - No wallet decryption
 *  - Only fulfills with cryptographic proof (preimage hash match)
 *  - Never guesses or uses hash inequality as fulfillment proof
 */
export async function reconcileEvidenceRequestOnChain(
  params: ReconcileEvidenceRequestParams,
): Promise<ReconciliationResult> {
  const { agentId, evidenceReference, caseVersionHash, evidenceVersionHash, now, store } = params;

  if (!evidenceReference || evidenceReference === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return { kind: "no_match" };
  }

  const ref = evidenceReference.toLowerCase();

  // 1. Load all requests
  const allRequests = await store.listEvidenceRequests(agentId);

  // 2. Already-fulfilled check
  const alreadyFulfilled = allRequests.find(
    (r) =>
      r.status === "fulfilled" &&
      r.fulfillment_evidence_reference?.toLowerCase() === ref,
  );
  if (alreadyFulfilled) {
    return { kind: "already_fulfilled", requestId: alreadyFulfilled.id };
  }

  // 3. Filter open requests with preimages
  const openWithPreimage = allRequests.filter(
    (r) => r.status === "open" && r.evidence_preimage !== null && r.evidence_preimage.length > 0,
  );

  if (openWithPreimage.length === 0) {
    return { kind: "no_match" };
  }

  // 4. Hash each preimage and compare
  const matches: EvidenceRequestRow[] = [];
  for (const req of openWithPreimage) {
    const preimage = req.evidence_preimage!;
    const computedHash = keccak256(stringToHex(preimage));
    if (computedHash.toLowerCase() === ref) {
      matches.push(req);
    }
  }

  // 5. Exactly one match → fulfill
  if (matches.length === 1) {
    const matchedRequest = matches[0];
    try {
      await fulfillEvidenceRequest({
        agentId,
        requestId: matchedRequest.id,
        fulfilledBy: matchedRequest.responsible_party as "client" | "worker",
        caseVersionHash,
        evidenceVersionHash,
        evidenceReference,
        preimage: matchedRequest.evidence_preimage!,
        now,
        store,
      });
      return { kind: "reconciled", requestId: matchedRequest.id };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Reconciliation fulfillment failed",
      };
    }
  }

  // 6. Multiple matches (data integrity issue)
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      candidateIds: matches.map((r) => r.id),
    };
  }

  // 7. No match — this evidence was not submitted for any known request
  return { kind: "no_match" };
}
