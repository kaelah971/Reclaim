// ---------------------------------------------------------------------------
// Observation Types — canonical representation of case state for deterministic
// version hashing. All types are pure data with no methods.
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Observation schema version — included in hash input
// ---------------------------------------------------------------------------

export const OBSERVATION_SCHEMA_VERSION = "reclaim-case-observation-v1";

// ---------------------------------------------------------------------------
// Escrow lifecycle states (from contract State enum)
// ---------------------------------------------------------------------------

export type EscrowState =
  | "created"
  | "funded"
  | "accepted"
  | "delivered"
  | "release_requested"
  | "released"
  | "disputed"
  | "cancelled"
  | "refunded";

export const ESCROW_STATE_MAP: Record<number, EscrowState> = {
  0: "created",
  1: "funded",
  2: "accepted",
  3: "delivered",
  4: "release_requested",
  5: "released",
  6: "disputed",
  7: "cancelled",
  8: "refunded",
};

// ---------------------------------------------------------------------------
// Observable agent statuses — the service will observe only these
// ---------------------------------------------------------------------------

export const OBSERVABLE_AGENT_STATUSES: readonly string[] = [
  "awaiting_funding",
  "awaiting_activation",
  "active",
  "waiting_for_evidence",
  "waiting_for_human_approval",
  "ready_for_human_review",
  "paused",
  "failed_recoverable",
];

export const NON_OBSERVABLE_AGENT_STATUSES: readonly string[] = [
  "closed",
  "closing",
];

// ---------------------------------------------------------------------------
// Authoritative escrow state observed from the canonical contract
// ---------------------------------------------------------------------------

export interface EscrowObservation {
  paymentId: string;
  client: string;
  worker: string;
  token: string;
  amount: string;
  agreementLabel: string;
  deliverableSummary: string;
  deliveryFormat: string;
  releaseRule: string;
  evidenceExpectation: string;
  termsHash: string;
  evidenceReference: string;
  disputeReference: string;
  deliveryDeadline: number;
  autoReleaseSeconds: number;
  disputeWindowSeconds: number;
  state: EscrowState;
  createdAt: number;
  fundedAt: number;
  acceptedAt: number;
  deliveryAt: number;
  releaseRequestedAt: number;
  releasedAt: number;
}

// ---------------------------------------------------------------------------
// Evidence availability states
// ---------------------------------------------------------------------------

export type EvidenceAvailability =
  | "none"
  | "on_chain_reference_only"
  | "metadata_available"
  | "package_available";

// ---------------------------------------------------------------------------
// Safe evidence observation (never includes private file contents)
// ---------------------------------------------------------------------------

export interface EvidenceObservation {
  evidenceReference: string | null;
  title: string | null;
  evidenceType: string | null;
  description: string | null;
  relatedDeliverable: string | null;
  externalReference: string | null;
  fileCount: number;
  latestUpdateTimestamp: number | null;
  availability: EvidenceAvailability;
  /** True when the verified manifest contains substantive agent-readable
   *  evidence (non-empty description, pasted text, external reference, etc.)
   *  that the Evidence Quality Check tool can actually consume. */
  substantiveEvidence: boolean;
}

// ---------------------------------------------------------------------------
// Prior tool result summary (safe summary, not raw output)
// ---------------------------------------------------------------------------

export interface ToolResultObservation {
  toolId: string;
  settled: boolean;
  resultSummary: string | null;
  settledAt: string | null;
}

// ---------------------------------------------------------------------------
// Evidence request observation
// ---------------------------------------------------------------------------

export interface EvidenceRequestObservation {
  id: string;
  responsibleParty: "client" | "worker";
  evidenceItem: string;
  reason: string;
  status: "open" | "fulfilled" | "cancelled";
  createdAt: string;
  fulfilledAt: string | null;
}

// ---------------------------------------------------------------------------
// Prior agent context (safe summaries only)
// ---------------------------------------------------------------------------

export interface PriorAgentContext {
  agentStatus: string;
  openEvidenceRequests: EvidenceRequestObservation[];
  fulfilledEvidenceRequests: EvidenceRequestObservation[];
  settledToolResults: ToolResultObservation[];
  previousCaseVersionHash: string | null;
  previousEvidenceVersionHash: string | null;
}

// ---------------------------------------------------------------------------
// The complete case observation
// ---------------------------------------------------------------------------

export interface CaseObservation {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  caseIdentity: {
    escrowChainId: string;
    escrowContractAddress: string;
    escrowPaymentId: string;
  };
  escrow: EscrowObservation;
  evidence: EvidenceObservation;
  priorContext: PriorAgentContext;
  observedAt: number;
}

// ---------------------------------------------------------------------------
// Change reason codes
// ---------------------------------------------------------------------------

export type ChangeReasonCode =
  | "first_observation"
  | "escrow_state_changed"
  | "evidence_added"
  | "evidence_changed"
  | "evidence_request_fulfilled"
  | "dispute_state_changed"
  | "tool_result_added"
  | "no_meaningful_change";

// ---------------------------------------------------------------------------
// Case change summary
// ---------------------------------------------------------------------------

export interface CaseChangeSummary {
  caseChanged: boolean;
  evidenceChanged: boolean;
  firstObservation: boolean;
  changeType: ChangeReasonCode;
  reason: string;
}

// ---------------------------------------------------------------------------
// Full observation result returned by the service
// ---------------------------------------------------------------------------

export interface CaseObservationResult {
  agentId: string;
  observation: CaseObservation;
  evidenceVersionHash: string;
  caseVersionHash: string;
  changeSummary: CaseChangeSummary;
  persisted: boolean;
}

// ---------------------------------------------------------------------------
// Reader interfaces for dependency injection
// ---------------------------------------------------------------------------

export interface CaseObservationReader {
  getFullPayment(escrowPaymentId: string): Promise<
    | {
        client: `0x${string}`;
        worker: `0x${string}`;
        token: `0x${string}`;
        amount: bigint;
        agreementLabel: `0x${string}`;
        deliverableSummary: `0x${string}`;
        deliveryFormat: `0x${string}`;
        releaseRule: `0x${string}`;
        evidenceExpectation: `0x${string}`;
        termsHash: `0x${string}`;
        evidenceReference: `0x${string}`;
        disputeReference: `0x${string}`;
        deliveryDeadline: bigint;
        autoReleaseSeconds: bigint;
        disputeWindowSeconds: bigint;
        state: number;
        createdAt: bigint;
        fundedAt: bigint;
        acceptedAt: bigint;
        deliveryAt: bigint;
        releaseRequestedAt: bigint;
        releasedAt: bigint;
      }
    | { exists: false }
  >;
}

export interface CaseEvidenceReader {
  getEvidenceMetadata(escrowPaymentId: string): Promise<{
    evidenceReference: string | null;
    title: string | null;
    evidenceType: string | null;
    description: string | null;
    relatedDeliverable: string | null;
    externalReference: string | null;
    fileCount: number;
    latestUpdateTimestamp: number | null;
    substantiveEvidence: boolean;
    /** Manifest-derived substantive facts (RA1R.8D). */
    relatedClaim?: string | null;
    pastedText?: string | null;
    evidenceDate?: string | null;
    externalRef?: string | null;
    fileHash?: string | null;
  }>;
}
