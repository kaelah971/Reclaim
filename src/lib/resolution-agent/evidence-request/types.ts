// ---------------------------------------------------------------------------
// Evidence Request Types — deduplication identity, creation params, and
// service result.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent } from "../types";
import type { EvidenceRequestRow } from "../store/types";

// ---------------------------------------------------------------------------
// Deduplication Identity
// ---------------------------------------------------------------------------

/**
 * Uniquely identifies an evidence request for deduplication purposes.
 * Two create_evidence_request actions with the same dedup identity MUST
 * result in the same evidence request row (idempotent creation).
 *
 * The identity includes the case and evidence version hashes at the time
 * the request was created, ensuring that when the case or evidence changes,
 * the planner can issue a new request targeting the updated context.
 */
export interface EvidenceRequestDedupIdentity {
  /** The agent that owns this evidence request. */
  agentId: string;
  /** Which party is responsible for providing this evidence. */
  responsibleParty: "client" | "worker";
  /** Normalized description of the evidence item needed. */
  evidenceItem: string;
  /** The case version hash at the time the request was created. */
  caseVersionHash: string;
  /** The evidence version hash at the time the request was created. */
  evidenceVersionHash: string;
}

// ---------------------------------------------------------------------------
// Service Parameters
// ---------------------------------------------------------------------------

/**
 * Normalized parameters for creating a new evidence request.
 * Used internally by the service after validation and normalization.
 */
export interface EvidenceRequestCreationParams {
  agentId: string;
  responsibleParty: "client" | "worker";
  evidenceItem: string;
  reason: string;
  caseVersionHash: string | null;
  evidenceVersionHash: string | null;
}

// ---------------------------------------------------------------------------
// Service Result
// ---------------------------------------------------------------------------

/**
 * Result of executing a create_evidence_request action.
 */
export interface CreateEvidenceRequestResult {
  /** The evidence request row (either newly created or existing). */
  request: EvidenceRequestRow;
  /** The agent in its current state after the operation. */
  agent: ResolutionAgent;
  /** Whether the request already existed (idempotent call). */
  isDuplicate: boolean;
}

// ---------------------------------------------------------------------------
// Service Dependencies
// ---------------------------------------------------------------------------

/**
 * Extended store shape required by the evidence-request service.
 * Structural typing — any store implementing these methods works.
 */
export interface EvidenceRequestStore {
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
  createEvidenceRequest(
    agentId: string,
    responsibleParty: "client" | "worker",
    evidenceItem: string,
    reason: string,
    caseVersionHash?: string,
    evidenceVersionHash?: string,
  ): Promise<EvidenceRequestRow>;
  updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent>;
  getAgentVersion(agentId: string): Promise<number>;
  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fulfillment Store
// ---------------------------------------------------------------------------

/**
 * Extended store shape required by the evidence-request fulfillment service.
 * Structural typing — any store implementing these methods works.
 */
export interface FulfillmentStore {
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
  updateEvidenceRequest(
    agentId: string,
    requestId: string,
    updates: Partial<
      Pick<
        EvidenceRequestRow,
        | "status"
        | "fulfilled_case_version_hash"
        | "fulfilled_at"
        | "cancelled_at"
        | "fulfillment_evidence_reference"
        | "evidence_preimage"
      >
    >,
  ): Promise<void>;
  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}
