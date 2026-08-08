// ---------------------------------------------------------------------------
// Observation service — comprehensive test suite
// Tests: observeResolutionAgentCase with mock readers and store
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { observeResolutionAgentCase } from "../service";
import type {
  CaseObservationReader,
  CaseEvidenceReader,
} from "../types";
import { OBSERVABLE_AGENT_STATUSES } from "../types";
import type { ResolutionAgent, ResolutionAgentStatus } from "../../types";
import type { ResolutionAgentStore } from "../../api/service";
import type { ToolExecutionRow, EvidenceRequestRow } from "../../store/types";
import type { EscrowCaseAuthorizationReader, CaseParties } from "../../api/escrow-reader";
import {
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "../../api/escrow-reader";
import { CaseObservationNotAllowedError, CaseIdentityMismatchError } from "../errors";

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FIXED_CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FIXED_WORKER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FIXED_TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const FIXED_CASE_WALLET = "0xdddddddddddddddddddddddddddddddddddddddd";
const FIXED_ESCROW_CONTRACT = CANONICAL_ESCROW_CONTRACT_ADDRESS;

// ---------------------------------------------------------------------------
// In-memory MockStore
// ---------------------------------------------------------------------------

class MockObservationStore implements ResolutionAgentStore {
  private agents = new Map<string, ResolutionAgent>();
  private versions = new Map<string, number>();
  private events: Array<{
    agentId: string;
    eventType: string;
    reason: string;
    previousStatus: string | null;
    nextStatus: string | null;
    metadata?: Record<string, unknown>;
  }> = [];
  private toolExecutions = new Map<string, ToolExecutionRow[]>();
  private evidenceRequests = new Map<string, EvidenceRequestRow[]>();

  reset(): void {
    this.agents.clear();
    this.versions.clear();
    this.events = [];
    this.toolExecutions.clear();
    this.evidenceRequests.clear();
  }

  getEvents(): typeof this.events {
    return this.events;
  }

  async createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    this.agents.set(agent.id, agent);
    this.versions.set(agent.id, 1);
    return agent;
  }

  async getAgentById(agentId: string): Promise<ResolutionAgent | null> {
    return this.agents.get(agentId) ?? null;
  }

  async getAgentByCaseIdentity(
    _chainId: string,
    _contractAddress: string,
    _paymentId: string,
  ): Promise<ResolutionAgent | null> {
    return null;
  }

  async updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent> {
    const current = this.versions.get(agent.id);
    if (current !== expectedVersion) {
      const err = new Error("Concurrency conflict");
      (err as Error & { actualVersion: number }).name = "ResolutionAgentConcurrencyError";
      Object.defineProperty(err, "actualVersion", { value: current ?? -1, writable: false });
      throw err;
    }
    this.agents.set(agent.id, agent);
    this.versions.set(agent.id, expectedVersion + 1);
    return agent;
  }

  async appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({
      agentId,
      eventType,
      reason,
      previousStatus,
      nextStatus,
      metadata,
    });
  }

  async getAgentVersion(agentId: string): Promise<number> {
    const version = this.versions.get(agentId);
    if (version === undefined) throw new Error(`Agent not found: ${agentId}`);
    return version;
  }

  // Extended store methods for observation
  async listToolExecutions(agentId: string): Promise<ToolExecutionRow[]> {
    return this.toolExecutions.get(agentId) ?? [];
  }

  setToolExecutions(agentId: string, rows: ToolExecutionRow[]): void {
    this.toolExecutions.set(agentId, rows);
  }

  async listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]> {
    return this.evidenceRequests.get(agentId) ?? [];
  }

  setEvidenceRequests(agentId: string, rows: EvidenceRequestRow[]): void {
    this.evidenceRequests.set(agentId, rows);
  }

  setAgent(agent: ResolutionAgent, version: number): void {
    this.agents.set(agent.id, agent);
    this.versions.set(agent.id, version);
  }
}

// ---------------------------------------------------------------------------
// Mock Case Observation Reader
// ---------------------------------------------------------------------------

class MockCaseObservationReader implements CaseObservationReader, EscrowCaseAuthorizationReader {
  private payments = new Map<
    string,
    {
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
  >();

  reset(): void {
    this.payments.clear();
  }

  setPayment(
    paymentId: string,
    payment: {
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
    },
  ): void {
    this.payments.set(paymentId, payment);
  }

  async getFullPayment(escrowPaymentId: string) {
    const p = this.payments.get(escrowPaymentId);
    if (!p) return { exists: false as const };
    return p;
  }

  async getCaseParties(caseIdentity: {
    escrowPaymentId: string;
  }): Promise<CaseParties> {
    const p = this.payments.get(caseIdentity.escrowPaymentId);
    if (!p) {
      return {
        client: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        worker: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        exists: false,
      };
    }
    return { client: p.client, worker: p.worker, exists: true };
  }
}

// ---------------------------------------------------------------------------
// Mock Case Evidence Reader
// ---------------------------------------------------------------------------

class MockCaseEvidenceReader implements CaseEvidenceReader {
  private evidence = new Map<
    string,
    {
      evidenceReference: string | null;
      title: string | null;
      evidenceType: string | null;
      description: string | null;
      relatedDeliverable: string | null;
      externalReference: string | null;
      fileCount: number;
      latestUpdateTimestamp: number | null;
      substantiveEvidence: boolean;
    }
  >();

  reset(): void {
    this.evidence.clear();
  }

  setEvidence(
    paymentId: string,
    meta: {
      evidenceReference: string | null;
      title: string | null;
      evidenceType: string | null;
      description: string | null;
      relatedDeliverable: string | null;
      externalReference: string | null;
      fileCount: number;
      latestUpdateTimestamp: number | null;
      substantiveEvidence?: boolean;
    },
  ): void {
    this.evidence.set(paymentId, {
      ...meta,
      substantiveEvidence: meta.substantiveEvidence ?? meta.fileCount > 0,
    });
  }

  async getEvidenceMetadata(escrowPaymentId: string) {
    return (
      this.evidence.get(escrowPaymentId) ?? {
        evidenceReference: null,
        title: null,
        evidenceType: null,
        description: null,
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 0,
        latestUpdateTimestamp: null,
        substantiveEvidence: false,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

function makeAgent(
  id: string,
  status: ResolutionAgentStatus,
  paymentId: string,
  overrides?: Partial<ResolutionAgent>,
): ResolutionAgent {
  return {
    id,
    goal: "Prepare this payment case for fair human review." as const,
    status,
    identity: {
      escrowChainId: String(CANONICAL_ESCROW_CHAIN_ID),
      escrowContractAddress: FIXED_ESCROW_CONTRACT,
      escrowPaymentId: paymentId,
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
      approvedBudgetAtomic: 1000000n,
      expiresAt: Date.now() + 86400000,
      funderAddress: FIXED_CLIENT,
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: null,
    caseWalletAddress: FIXED_CASE_WALLET,
    encryptedSecret: {
      version: 1 as const,
      algorithm: "AES-256-GCM" as const,
      ciphertext: "test-ciphertext",
      iv: "test-iv",
      authenticationTag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default escrow payment fixture
// ---------------------------------------------------------------------------

function makeDefaultPayment(paymentId: string) {
  return {
    client: FIXED_CLIENT as `0x${string}`,
    worker: FIXED_WORKER as `0x${string}`,
    token: FIXED_TOKEN as `0x${string}`,
    amount: 1000000n,
    agreementLabel: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    deliverableSummary: "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`,
    deliveryFormat: "0x0000000000000000000000000000000000000000000000000000000000000003" as `0x${string}`,
    releaseRule: "0x0000000000000000000000000000000000000000000000000000000000000004" as `0x${string}`,
    evidenceExpectation: "0x0000000000000000000000000000000000000000000000000000000000000005" as `0x${string}`,
    termsHash: "0x0000000000000000000000000000000000000000000000000000000000000006" as `0x${string}`,
    evidenceReference: "0x0000000000000000000000000000000000000000000000000000000000000007" as `0x${string}`,
    disputeReference: "0x0000000000000000000000000000000000000000000000000000000000000008" as `0x${string}`,
    deliveryDeadline: 1717000000n,
    autoReleaseSeconds: 86400n,
    disputeWindowSeconds: 604800n,
    state: 2, // funded
    createdAt: 1716800000n,
    fundedAt: 1716810000n,
    acceptedAt: 0n,
    deliveryAt: 0n,
    releaseRequestedAt: 0n,
    releasedAt: 0n,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("observeResolutionAgentCase", () => {
  let store: MockObservationStore;
  let escrowReader: MockCaseObservationReader;
  let evidenceReader: MockCaseEvidenceReader;

  beforeEach(() => {
    store = new MockObservationStore();
    escrowReader = new MockCaseObservationReader();
    evidenceReader = new MockCaseEvidenceReader();
    store.reset();
    escrowReader.reset();
    evidenceReader.reset();
  });

  // -----------------------------------------------------------------------
  // Happy path — first observation
  // -----------------------------------------------------------------------

  it("returns CaseObservationResult on first observation", async () => {
    const agent = makeAgent("agt_test_1", "active", "42");
    store.setAgent(agent, 3);
    escrowReader.setPayment("42", makeDefaultPayment("42"));

    const result = await observeResolutionAgentCase({
      agentId: "agt_test_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(result.agentId).toBe("agt_test_1");
    expect(result.persisted).toBe(true);
    expect(result.changeSummary.firstObservation).toBe(true);
    expect(result.changeSummary.changeType).toBe("first_observation");
    expect(result.caseVersionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.evidenceVersionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  // -----------------------------------------------------------------------
  // Second observation — no change
  // -----------------------------------------------------------------------

  it("detects no meaningful change on second identical observation", async () => {
    const agent = makeAgent("agt_test_2", "active", "43");
    store.setAgent(agent, 1);
    escrowReader.setPayment("43", makeDefaultPayment("43"));

    const firstResult = await observeResolutionAgentCase({
      agentId: "agt_test_2",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(firstResult.changeSummary.changeType).toBe("first_observation");

    const secondResult = await observeResolutionAgentCase({
      agentId: "agt_test_2",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(secondResult.changeSummary.changeType).toBe("no_meaningful_change");
    expect(secondResult.changeSummary.caseChanged).toBe(false);
    expect(secondResult.changeSummary.evidenceChanged).toBe(false);
    expect(secondResult.persisted).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Detects escrow state change
  // -----------------------------------------------------------------------

  it("detects escrow state change between observations", async () => {
    const agent = makeAgent("agt_test_3", "active", "44");
    store.setAgent(agent, 1);
    escrowReader.setPayment("44", makeDefaultPayment("44"));

    const firstResult = await observeResolutionAgentCase({
      agentId: "agt_test_3",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const firstCaseHash = firstResult.caseVersionHash;

    // Update escrow state to delivered
    const deliveredPayment = { ...makeDefaultPayment("44"), state: 3 };
    escrowReader.setPayment("44", deliveredPayment);

    const secondResult = await observeResolutionAgentCase({
      agentId: "agt_test_3",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(secondResult.changeSummary.caseChanged).toBe(true);
    expect(secondResult.changeSummary.changeType).toBe("escrow_state_changed");
    expect(secondResult.caseVersionHash).not.toBe(firstCaseHash);
  });

  // -----------------------------------------------------------------------
  // Events — first observation appends case_observed
  // -----------------------------------------------------------------------

  it("appends case_observed event on first observation", async () => {
    const agent = makeAgent("agt_events_1", "active", "45");
    store.setAgent(agent, 1);
    escrowReader.setPayment("45", makeDefaultPayment("45"));

    await observeResolutionAgentCase({
      agentId: "agt_events_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const observedEvents = store.getEvents().filter((e) => e.eventType === "case_observed");
    expect(observedEvents.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Events — meaningful change appends case_version_changed
  // -----------------------------------------------------------------------

  it("appends case_version_changed event when escrow state changes", async () => {
    const agent = makeAgent("agt_events_2", "active", "46");
    store.setAgent(agent, 1);
    escrowReader.setPayment("46", makeDefaultPayment("46"));

    await observeResolutionAgentCase({
      agentId: "agt_events_2",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const deliveredPayment = { ...makeDefaultPayment("46"), state: 3 };
    escrowReader.setPayment("46", deliveredPayment);

    await observeResolutionAgentCase({
      agentId: "agt_events_2",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const changedEvents = store.getEvents().filter((e) => e.eventType === "case_version_changed");
    expect(changedEvents.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Events — no duplicate events when hashes unchanged
  // -----------------------------------------------------------------------

  it("does NOT append duplicate events when hashes are unchanged", async () => {
    const agent = makeAgent("agt_events_3", "active", "47");
    store.setAgent(agent, 1);
    escrowReader.setPayment("47", makeDefaultPayment("47"));

    await observeResolutionAgentCase({
      agentId: "agt_events_3",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const eventCountBefore = store.getEvents().length;

    // Second identical observation
    await observeResolutionAgentCase({
      agentId: "agt_events_3",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const eventCountAfter = store.getEvents().length;
    // Only the first observation generates an event (case_observed)
    // The second should NOT generate case_version_changed
    const changedEvents = store
      .getEvents()
      .filter((e) => e.eventType === "case_version_changed");
    expect(changedEvents.length).toBe(0);
    // But the first case_observed event should still be there
    const observedEvents = store
      .getEvents()
      .filter((e) => e.eventType === "case_observed");
    expect(observedEvents.length).toBe(1);
    // Total events should not have grown from duplicate
    expect(eventCountAfter).toBe(eventCountBefore);
  });

  // -----------------------------------------------------------------------
  // Authorization — rejects closed agent
  // -----------------------------------------------------------------------

  it("throws CaseObservationNotAllowedError for closed agent", async () => {
    const agent = makeAgent("agt_closed", "closed", "48");
    store.setAgent(agent, 1);
    escrowReader.setPayment("48", makeDefaultPayment("48"));

    await expect(
      observeResolutionAgentCase({
        agentId: "agt_closed",
        now: 1716900000,
        store: store as unknown as ResolutionAgentStore & {
          listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
          listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
        },
        escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
        evidenceReader,
      }),
    ).rejects.toThrow(CaseObservationNotAllowedError);
  });

  // -----------------------------------------------------------------------
  // All observable states are allowed
  // -----------------------------------------------------------------------

  it("allows observation for all observable statuses", async () => {
    let paymentIdx = 200;
    for (const status of OBSERVABLE_AGENT_STATUSES) {
      store.reset();
      escrowReader.reset();
      evidenceReader.reset();

      const pid = String(paymentIdx);
      const agent = makeAgent(`agt_${status}`, status as ResolutionAgentStatus, pid);
      store.setAgent(agent, 1);
      escrowReader.setPayment(pid, makeDefaultPayment(pid));
      paymentIdx++;

      const result = await observeResolutionAgentCase({
        agentId: `agt_${status}`,
        now: 1716900000,
        store: store as unknown as ResolutionAgentStore & {
          listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
          listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
        },
        escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
        evidenceReader,
      });

      expect(result.persisted).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Case identity validation
  // -----------------------------------------------------------------------

  it("throws CaseIdentityMismatchError when escrow chain ID differs", async () => {
    const agent = makeAgent("agt_id_1", "active", "49", {
      identity: {
        escrowChainId: "99999999",
        escrowContractAddress: FIXED_ESCROW_CONTRACT,
        escrowPaymentId: "49",
      },
    });
    store.setAgent(agent, 1);
    escrowReader.setPayment("49", makeDefaultPayment("49"));

    await expect(
      observeResolutionAgentCase({
        agentId: "agt_id_1",
        now: 1716900000,
        store: store as unknown as ResolutionAgentStore & {
          listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
          listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
        },
        escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
        evidenceReader,
      }),
    ).rejects.toThrow(CaseIdentityMismatchError);
  });

  it("throws error when escrow payment does not exist on-chain", async () => {
    const agent = makeAgent("agt_id_2", "active", "50");
    store.setAgent(agent, 1);
    // Do NOT set up a payment in the escrow reader — it won't exist

    await expect(
      observeResolutionAgentCase({
        agentId: "agt_id_2",
        now: 1716900000,
        store: store as unknown as ResolutionAgentStore & {
          listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
          listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
        },
        escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
        evidenceReader,
      }),
    ).rejects.toThrow("does not exist on-chain");
  });

  // -----------------------------------------------------------------------
  // Prior context — tool results and evidence requests
  // -----------------------------------------------------------------------

  it("includes settled tool results in prior context", async () => {
    const agent = makeAgent("agt_ctx_1", "active", "51");
    store.setAgent(agent, 1);
    escrowReader.setPayment("51", makeDefaultPayment("51"));

    store.setToolExecutions("agt_ctx_1", [
      {
        id: "te_1",
        agent_id: "agt_ctx_1",
        tool_identifier: "evidence-quality-check",
        request_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        case_version_hash: null,
        evidence_version_hash: null,
        state: "settled",
        price_atomic: 10000,
        network: "eip155:42220",
        asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
        pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
        payment_reference: null,
        settlement_tx_hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        result_reference: null,
        result_data: { summary: "Evidence is complete and consistent." },
        failure_reason: null,
        created_at: "2024-05-28T00:00:00.000Z",
        updated_at: "2024-05-28T00:00:00.000Z",
      },
    ]);

    const result = await observeResolutionAgentCase({
      agentId: "agt_ctx_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(result.observation.priorContext.settledToolResults.length).toBe(1);
    expect(result.observation.priorContext.settledToolResults[0].toolId).toBe(
      "evidence-quality-check",
    );
    expect(result.observation.priorContext.settledToolResults[0].settled).toBe(true);
  });

  it("includes evidence requests in prior context", async () => {
    const agent = makeAgent("agt_ctx_2", "active", "52");
    store.setAgent(agent, 1);
    escrowReader.setPayment("52", makeDefaultPayment("52"));

    store.setEvidenceRequests("agt_ctx_2", [
      {
        id: "er_1",
        agent_id: "agt_ctx_2",
        responsible_party: "client",
        evidence_item: "signed_agreement.pdf",
        reason: "Missing signed agreement",
        status: "open",
        created_case_version_hash: null,
        evidence_version_hash: null,
        fulfilled_case_version_hash: null,
        created_at: "2024-05-27T00:00:00.000Z",
        fulfilled_at: null,
        cancelled_at: null,
        fulfillment_evidence_reference: null,
        evidence_preimage: null,
      },
      {
        id: "er_2",
        agent_id: "agt_ctx_2",
        responsible_party: "worker",
        evidence_item: "delivery_screenshots.zip",
        reason: "Requested delivery proof",
        status: "fulfilled",
        created_case_version_hash: null,
        evidence_version_hash: null,
        fulfilled_case_version_hash: null,
        created_at: "2024-05-27T00:00:00.000Z",
        fulfilled_at: "2024-05-28T00:00:00.000Z",
        cancelled_at: null,
        fulfillment_evidence_reference: null,
        evidence_preimage: null,
      },
    ]);

    const result = await observeResolutionAgentCase({
      agentId: "agt_ctx_2",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(result.observation.priorContext.openEvidenceRequests.length).toBe(1);
    expect(result.observation.priorContext.fulfilledEvidenceRequests.length).toBe(1);
    expect(result.observation.priorContext.openEvidenceRequests[0].id).toBe("er_1");
    expect(result.observation.priorContext.fulfilledEvidenceRequests[0].id).toBe("er_2");
  });

  // -----------------------------------------------------------------------
  // Does NOT alter agent lifecycle status
  // -----------------------------------------------------------------------

  it("does NOT change agent status after observation", async () => {
    const agent = makeAgent("agt_status_1", "waiting_for_evidence", "53");
    store.setAgent(agent, 1);
    escrowReader.setPayment("53", makeDefaultPayment("53"));

    await observeResolutionAgentCase({
      agentId: "agt_status_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const storedAgent = await store.getAgentById("agt_status_1");
    expect(storedAgent!.status).toBe("waiting_for_evidence");
  });

  // -----------------------------------------------------------------------
  // Persists observation data to agent record
  // -----------------------------------------------------------------------

  it("persists observation with correct hashes to agent record", async () => {
    const agent = makeAgent("agt_persist_1", "active", "54");
    store.setAgent(agent, 1);
    escrowReader.setPayment("54", makeDefaultPayment("54"));

    const result = await observeResolutionAgentCase({
      agentId: "agt_persist_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    const storedAgent = await store.getAgentById("agt_persist_1");
    expect(storedAgent!.observation).not.toBeNull();
    expect(storedAgent!.observation!.caseVersionHash).toBe(result.caseVersionHash);
    expect(storedAgent!.observation!.evidenceVersionHash).toBe(result.evidenceVersionHash);
    expect(storedAgent!.observation!.observedAt).toBe(1716900000);
  });

  // -----------------------------------------------------------------------
  // Observes evidence metadata
  // -----------------------------------------------------------------------

  it("reads and includes evidence metadata in observation", async () => {
    const agent = makeAgent("agt_ev_1", "active", "55");
    store.setAgent(agent, 1);
    escrowReader.setPayment("55", makeDefaultPayment("55"));

    evidenceReader.setEvidence("55", {
      evidenceReference: "0xabc0000000000000000000000000000000000000000000000000000000000001",
      title: "Test Evidence",
      evidenceType: "application/pdf",
      description: "A test evidence package",
      relatedDeliverable: "QmTest123",
      externalReference: "https://example.com/evidence/55",
      fileCount: 2,
      latestUpdateTimestamp: 1716900000000,
    });

    const result = await observeResolutionAgentCase({
      agentId: "agt_ev_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    expect(result.observation.evidence.title).toBe("Test Evidence");
    expect(result.observation.evidence.fileCount).toBe(2);
    expect(result.observation.evidence.availability).toBe("package_available");
  });

  // -----------------------------------------------------------------------
  // Does NOT decrypt case wallet
  // -----------------------------------------------------------------------

  it("does NOT alter encryptedSecret in observation result", async () => {
    const agent = makeAgent("agt_sec_1", "active", "56");
    store.setAgent(agent, 1);
    escrowReader.setPayment("56", makeDefaultPayment("56"));

    const result = await observeResolutionAgentCase({
      agentId: "agt_sec_1",
      now: 1716900000,
      store: store as unknown as ResolutionAgentStore & {
        listToolExecutions(agentId: string): Promise<ToolExecutionRow[]>;
        listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]>;
      },
      escrowReader: escrowReader as EscrowCaseAuthorizationReader & CaseObservationReader,
      evidenceReader,
    });

    // The observation result itself should NOT contain encryptedSecret
    const obs = result.observation as unknown as Record<string, unknown>;
    expect(obs).not.toHaveProperty("encryptedSecret");
    expect(obs).not.toHaveProperty("caseWalletPrivateKey");
    expect(obs).not.toHaveProperty("secretKey");

    const storedAgent = await store.getAgentById("agt_sec_1");
    expect(storedAgent!.encryptedSecret.ciphertext).toBe("test-ciphertext");
  });
});
