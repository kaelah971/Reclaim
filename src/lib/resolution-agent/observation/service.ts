// ---------------------------------------------------------------------------
// Observation Service — observe a resolution agent's case state
//
// Reads authoritative on-chain escrow state, evidence metadata, and prior
// tool/evidence context, computes deterministic case-version hashes, compares
// against previously stored hashes, and persists the new observation with
// optimistic concurrency.
//
// Safety guarantees:
//  - Never decrypts the case wallet
//  - Never calls an AI model
//  - Never decides who wins
//  - Never alters agent lifecycle status
//  - Only persists observation data + hashes
//  - Never appends duplicate events when hashes are unchanged
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentStatus, ResolutionAgentToolId } from "../types";
import type { ResolutionAgentStore } from "../api/service";
import type { EscrowCaseAuthorizationReader } from "../api/escrow-reader";
import {
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "../api/escrow-reader";
import type { ToolExecutionRow, EvidenceRequestRow } from "../store/types";
import type {
  CaseObservation,
  CaseObservationReader,
  CaseEvidenceReader,
  CaseObservationResult,
  EscrowObservation,
  EvidenceObservation,
  EvidenceAvailability,
  PriorAgentContext,
  ToolResultObservation,
  EvidenceRequestObservation,
} from "./types";
import {
  OBSERVATION_SCHEMA_VERSION,
  ESCROW_STATE_MAP,
  OBSERVABLE_AGENT_STATUSES,
} from "./types";
import { computeEvidenceVersionHash, computeCaseVersionHash, compareCaseObservation } from "./hash";
import {
  CaseObservationNotAllowedError,
  CaseIdentityMismatchError,
  CaseObservationConcurrencyError,
} from "./errors";

// ---------------------------------------------------------------------------
// Store type — ResolutionAgentStore + the extended methods needed by the
// observation service
// ---------------------------------------------------------------------------

type ObservationStore = ResolutionAgentStore & {
  listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
  listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseEscrowState(stateNumber: number): EscrowObservation["state"] {
  const state = ESCROW_STATE_MAP[stateNumber];
  if (!state) {
    throw new Error(`Unknown escrow state: ${stateNumber}`);
  }
  return state;
}

function isObservableStatus(status: ResolutionAgentStatus): boolean {
  return OBSERVABLE_AGENT_STATUSES.includes(status);
}

function bigintToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`bigint value ${value} exceeds safe integer range`);
  }
  return Number(value);
}

function buildEvidenceObservation(
  metadata: {
    evidenceReference: string | null;
    title: string | null;
    evidenceType: string | null;
    description: string | null;
    relatedDeliverable: string | null;
    externalReference: string | null;
    fileCount: number;
    latestUpdateTimestamp: number | null;
  },
): EvidenceObservation {
  let availability: EvidenceAvailability = "none";

  if (metadata.evidenceReference !== null) {
    if (metadata.fileCount > 0) {
      availability = "package_available";
    } else if (metadata.title !== null || metadata.description !== null) {
      availability = "metadata_available";
    } else {
      availability = "on_chain_reference_only";
    }
  }

  return {
    evidenceReference: metadata.evidenceReference,
    title: metadata.title,
    evidenceType: metadata.evidenceType,
    description: metadata.description,
    relatedDeliverable: metadata.relatedDeliverable,
    externalReference: metadata.externalReference,
    fileCount: metadata.fileCount,
    latestUpdateTimestamp: metadata.latestUpdateTimestamp,
    availability,
  };
}

function buildToolResultObservations(
  toolExecutions: ToolExecutionRow[],
): ToolResultObservation[] {
  return toolExecutions
    .filter((te) => te.state === "settled")
    .map((te) => ({
      toolId: te.tool_identifier,
      settled: true,
      resultSummary: extractResultSummary(te.result_data),
      settledAt: te.updated_at,
    }));
}

function extractResultSummary(
  resultData: Record<string, unknown> | null,
): string | null {
  if (!resultData) return null;
  if (typeof resultData.summary === "string") return resultData.summary;
  if (typeof resultData.result === "string") return resultData.result;
  if (typeof resultData.message === "string") return resultData.message;
  return null;
}

function buildEvidenceRequestObservations(
  rows: EvidenceRequestRow[],
): {
  open: EvidenceRequestObservation[];
  fulfilled: EvidenceRequestObservation[];
} {
  const all = rows.map((r): EvidenceRequestObservation => ({
    id: r.id,
    responsibleParty: r.responsible_party as "client" | "worker",
    evidenceItem: r.evidence_item,
    reason: r.reason,
    status: r.status as "open" | "fulfilled" | "cancelled",
    createdAt: r.created_at,
    fulfilledAt: r.fulfilled_at,
  }));

  return {
    open: all.filter((r) => r.status === "open"),
    fulfilled: all.filter((r) => r.status === "fulfilled"),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function observeResolutionAgentCase(params: {
  agentId: string;
  now: number;
  store: ObservationStore;
  escrowReader: EscrowCaseAuthorizationReader & CaseObservationReader;
  evidenceReader: CaseEvidenceReader;
}): Promise<CaseObservationResult> {
  const { agentId, now, store, escrowReader, evidenceReader } = params;

  // 1. Load the agent from store
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new Error(`Resolution agent not found: ${agentId}`);
  }

  // 2. Validate agent is in an observable state
  if (!isObservableStatus(agent.status)) {
    throw new CaseObservationNotAllowedError(agent.status);
  }

  // 3. Read authoritative escrow state using escrowReader
  const paymentId = agent.identity.escrowPaymentId;
  const payment = await escrowReader.getFullPayment(paymentId);

  if (!payment || "exists" in payment) {
    throw new Error(
      `Escrow payment "${paymentId}" does not exist on-chain.`,
    );
  }

  // 4. Confirm case identity matches stored agent identity
  const storedChain = agent.identity.escrowChainId;
  const storedContract = agent.identity.escrowContractAddress.toLowerCase();
  const storedPaymentId = agent.identity.escrowPaymentId;

  const canonicalContract = CANONICAL_ESCROW_CONTRACT_ADDRESS.toLowerCase();

  // Verify chain ID matches canonical
  if (String(storedChain) !== String(CANONICAL_ESCROW_CHAIN_ID)) {
    throw new CaseIdentityMismatchError(
      agentId,
      `chain=${storedChain}`,
      `chain=${CANONICAL_ESCROW_CHAIN_ID}`,
    );
  }

  // Verify contract address matches canonical
  if (storedContract !== canonicalContract) {
    throw new CaseIdentityMismatchError(
      agentId,
      `contract=${storedContract}`,
      `contract=${canonicalContract}`,
    );
  }

  // Verify payment ID matches what was read on-chain
  if (storedPaymentId !== paymentId) {
    throw new CaseIdentityMismatchError(
      agentId,
      `paymentId=${storedPaymentId}`,
      `paymentId=${paymentId}`,
    );
  }

  // 5. Read evidence metadata via evidenceReader
  const evidenceMetadata = await evidenceReader.getEvidenceMetadata(paymentId);

  // 6. Read evidence requests and settled tool results from store
  const [toolExecutions, evidenceRequests] = await Promise.all([
    store.listToolExecutions(agentId),
    store.listEvidenceRequests(agentId),
  ]);

  // 7. Build the typed CaseObservation
  const escrowObservation: EscrowObservation = {
    paymentId,
    client: payment.client.toLowerCase(),
    worker: payment.worker.toLowerCase(),
    token: payment.token.toLowerCase(),
    amount: payment.amount.toString(),
    agreementLabel: payment.agreementLabel,
    deliverableSummary: payment.deliverableSummary,
    deliveryFormat: payment.deliveryFormat,
    releaseRule: payment.releaseRule,
    evidenceExpectation: payment.evidenceExpectation,
    termsHash: payment.termsHash,
    evidenceReference: payment.evidenceReference,
    disputeReference: payment.disputeReference,
    deliveryDeadline: bigintToNumber(payment.deliveryDeadline),
    autoReleaseSeconds: bigintToNumber(payment.autoReleaseSeconds),
    disputeWindowSeconds: bigintToNumber(payment.disputeWindowSeconds),
    state: parseEscrowState(payment.state),
    createdAt: bigintToNumber(payment.createdAt),
    fundedAt: bigintToNumber(payment.fundedAt),
    acceptedAt: bigintToNumber(payment.acceptedAt),
    deliveryAt: bigintToNumber(payment.deliveryAt),
    releaseRequestedAt: bigintToNumber(payment.releaseRequestedAt),
    releasedAt: bigintToNumber(payment.releasedAt),
  };

  const evidenceObservation = buildEvidenceObservation(evidenceMetadata);
  const toolResults = buildToolResultObservations(toolExecutions);
  const { open: openRequests, fulfilled: fulfilledRequests } =
    buildEvidenceRequestObservations(evidenceRequests);

  const priorContext: PriorAgentContext = {
    agentStatus: agent.status,
    openEvidenceRequests: openRequests,
    fulfilledEvidenceRequests: fulfilledRequests,
    settledToolResults: toolResults,
    previousCaseVersionHash: agent.observation?.caseVersionHash ?? null,
    previousEvidenceVersionHash: agent.observation?.evidenceVersionHash ?? null,
  };

  const caseObservation: CaseObservation = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    caseIdentity: {
      escrowChainId: agent.identity.escrowChainId,
      escrowContractAddress: agent.identity.escrowContractAddress,
      escrowPaymentId: agent.identity.escrowPaymentId,
    },
    escrow: escrowObservation,
    evidence: evidenceObservation,
    priorContext,
    observedAt: now,
  };

  // 8. Compute evidenceVersionHash
  const evidenceVersionHash = computeEvidenceVersionHash(caseObservation);

  // 9. Compute caseVersionHash
  const caseVersionHash = computeCaseVersionHash(caseObservation, evidenceVersionHash);

  // 10. Compare against stored hashes
  const changeSummary = compareCaseObservation({
    previousCaseVersionHash: agent.observation?.caseVersionHash ?? null,
    previousEvidenceVersionHash: agent.observation?.evidenceVersionHash ?? null,
    nextCaseVersionHash: caseVersionHash,
    nextEvidenceVersionHash: evidenceVersionHash,
  });

  // 11. Persist: update agent record with observation data
  const currentVersion = await store.getAgentVersion(agentId);

  const updatedAgent: ResolutionAgent = {
    ...agent,
    observation: {
      escrowState: escrowObservation.state,
      evidenceCount: evidenceObservation.fileCount,
      evidenceVersionHash,
      caseVersionHash,
      unresolvedGaps: agent.observation?.unresolvedGaps ?? [],
      hasMeaningfulChange: changeSummary.caseChanged || changeSummary.evidenceChanged,
      observedAt: now,
    },
    updatedAt: now,
  };

  // Mark settled tool IDs in the agent object
  const settledToolIds = toolResults.map((tr) => tr.toolId) as ResolutionAgentToolId[];
  updatedAgent.settledToolIds = settledToolIds;

  try {
    await store.updateAgent(updatedAgent, currentVersion);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ResolutionAgentConcurrencyError"
    ) {
      const actualVersion =
        (error as Error & { actualVersion?: number }).actualVersion ?? -1;
      throw new CaseObservationConcurrencyError(
        agentId,
        currentVersion,
        actualVersion,
      );
    }
    throw error;
  }

  // 12. Append events
  if (changeSummary.firstObservation) {
    await store.appendEvent(
      agentId,
      "case_observed",
      "First observation completed. Baseline case version established.",
      agent.status,
      agent.status,
      {
        evidenceVersionHash,
        caseVersionHash,
        escrowState: escrowObservation.state,
        observedAt: now,
      },
    );
  } else if (changeSummary.caseChanged || changeSummary.evidenceChanged) {
    await store.appendEvent(
      agentId,
      "case_version_changed",
      `Case version changed: ${changeSummary.reason}`,
      agent.status,
      agent.status,
      {
        previousEvidenceVersionHash:
          agent.observation?.evidenceVersionHash ?? null,
        previousCaseVersionHash: agent.observation?.caseVersionHash ?? null,
        evidenceVersionHash,
        caseVersionHash,
        changeType: changeSummary.changeType,
        observedAt: now,
      },
    );
  }
  // 13. Do NOT append duplicate events when hashes are unchanged (no-op)

  // 14-17. Safety: never alter lifecycle, decrypt wallet, call AI, or decide winner

  // 18. Return the observation result
  return {
    agentId,
    observation: caseObservation,
    evidenceVersionHash,
    caseVersionHash,
    changeSummary,
    persisted: true,
  };
}
