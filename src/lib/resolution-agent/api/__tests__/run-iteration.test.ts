// @vitest-environment node
// ---------------------------------------------------------------------------
// runResolutionAgentIteration — service gate for the manual "run one worker
// iteration" endpoint.
//
// The WORKER and the PRODUCTION ADAPTERS are fully mocked — no live worker
// iteration, x402 execution, settlement, or DB write ever happens here.
//
// Coverage:
//   1. authorized funder + non-terminal case → worker called once with
//      targetAgentId = agentId; returns { result, agent }
//   2. unauthorized caller                    → throws, worker NOT called
//   3. terminal escrow state 5 (released)     → throws, worker NOT called
//   4. terminal escrow state 7 (cancelled)    → throws, worker NOT called
//   5. case missing on-chain                  → throws, worker NOT called
//   6. agent not found                        → ResolutionAgentNotFoundError
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { MockEscrowCaseReader } from "../escrow-reader";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "../escrow-reader";
import { ResolutionAgentNotFoundError } from "../../store/errors";
import { FIXED_AGENT_GOAL, type ResolutionAgent } from "../../types";
import type { ResolutionAgentStore } from "../service";
import type { CaseObservationReader } from "../../observation/types";

const FUNDER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FUNDER = privateKeyToAccount(FUNDER_KEY).address;
const WORKER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const UNAUTHORIZED = "0x1111111111111111111111111111111111111111";

const AGENT_ID = "agt_test-0001";
const PAYMENT_ID = "1";
const NOW = 1_750_000_000_000;

// Hoisted worker + adapter mocks (worker never executes for real).
const workerMock = vi.hoisted(() => ({
  runResolutionAgentWorkerIteration: vi.fn(),
}));

const productionMock = vi.hoisted(() => ({
  createResolutionAgentWorkerDependencies: vi.fn(),
}));

vi.mock("@/lib/resolution-agent/worker/service", () => ({
  runResolutionAgentWorkerIteration: workerMock.runResolutionAgentWorkerIteration,
}));

vi.mock("@/lib/resolution-agent/adapters/production", () => ({
  createResolutionAgentWorkerDependencies:
    productionMock.createResolutionAgentWorkerDependencies,
}));

// Import AFTER mocks are registered.
import { runResolutionAgentIteration } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full on-chain payment struct with the given escrow state number. */
function makeFullPayment(state: number): Awaited<
  ReturnType<CaseObservationReader["getFullPayment"]>
> {
  const struct = {
    client: FUNDER as `0x${string}`,
    worker: WORKER as `0x${string}`,
    token: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    amount: 1_000_000n,
    agreementLabel: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    deliverableSummary: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    deliveryFormat: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    releaseRule: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    evidenceExpectation: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    termsHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    evidenceReference: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    disputeReference: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    deliveryDeadline: 0n,
    autoReleaseSeconds: 0n,
    disputeWindowSeconds: 0n,
    state,
    createdAt: 1n,
    fundedAt: 0n,
    acceptedAt: 0n,
    deliveryAt: 0n,
    releaseRequestedAt: 0n,
    releasedAt: 0n,
  };
  return struct;
}

/** Test escrow reader: case parties (from MockEscrowCaseReader) + configurable
 *  getFullPayment behaviour. */
class StatefulEscrowReader extends MockEscrowCaseReader {
  private paymentState: number | null = null;

  /** `null` → the case does not exist on-chain. */
  setFullPayment(state: number | null): void {
    this.paymentState = state;
  }

  async getFullPayment(): Promise<
    Awaited<ReturnType<CaseObservationReader["getFullPayment"]>>
  > {
    if (this.paymentState === null) return { exists: false };
    return makeFullPayment(this.paymentState) as NonNullable<
      Awaited<ReturnType<CaseObservationReader["getFullPayment"]>>
    >;
  }
}

function makeAgent(): ResolutionAgent {
  return {
    id: AGENT_ID,
    goal: FIXED_AGENT_GOAL,
    status: "active",
    identity: {
      escrowPaymentId: PAYMENT_ID,
      escrowChainId: "eip155:11142220",
      escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
    },
    policy: {
      funderAddress: FUNDER,
      allowedTools: [],
      approvedBudgetAtomic: 50_000n,
      expiresAt: Date.now() + 1_000_000,
    },
    budget: {
      approvedAtomic: 50_000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: null,
    caseWalletAddress: "0x0000000000000000000000000000000000000002",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "cipher",
      iv: "iv",
      authenticationTag: "tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: NOW,
    updatedAt: NOW,
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
  };
}

/** Minimal in-memory store implementing the ResolutionAgentStore shape. */
class InMemoryStore implements ResolutionAgentStore {
  private readonly agent: ResolutionAgent | null;
  constructor(agent: ResolutionAgent | null) {
    this.agent = agent;
  }
  async getAgentById(): Promise<ResolutionAgent | null> {
    return this.agent;
  }
  async getAgentVersion(): Promise<number> {
    return 1;
  }
  async appendEvent(): Promise<void> {
    // no-op
  }
  async createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    return agent;
  }
  async getAgentByCaseIdentity(): Promise<ResolutionAgent | null> {
    return this.agent;
  }
  async updateAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    return agent;
  }
}

function makeStore(agent: ResolutionAgent | null): ResolutionAgentStore {
  return new InMemoryStore(agent);
}

function makeReader(paymentState: number | null): StatefulEscrowReader {
  const reader = new StatefulEscrowReader();
  reader.setCaseParties(PAYMENT_ID, {
    client: FUNDER as `0x${string}`,
    worker: WORKER as `0x${string}`,
    exists: true,
  });
  reader.setFullPayment(paymentState);
  return reader;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runResolutionAgentIteration", () => {
  beforeEach(() => {
    workerMock.runResolutionAgentWorkerIteration.mockReset();
    productionMock.createResolutionAgentWorkerDependencies.mockReset();
    workerMock.runResolutionAgentWorkerIteration.mockResolvedValue({
      workerIterationId: "iter_1",
      agentId: AGENT_ID,
      outcome: "processed",
      actionDispatched: { kind: "executed" },
    });
    productionMock.createResolutionAgentWorkerDependencies.mockReturnValue({});
  });

  it("1) authorized funder + non-terminal case → worker called once with targetAgentId, returns { result, agent }", async () => {
    const store = makeStore(makeAgent());
    const escrowReader = makeReader(6 /* disputed — non-terminal */);

    const { result, agent } = await runResolutionAgentIteration({
      agentId: AGENT_ID,
      authenticatedCaller: FUNDER,
      store,
      escrowReader,
      now: NOW,
    });

    expect(result.outcome).toBe("processed");
    expect(agent.id).toBe(AGENT_ID);
    expect(workerMock.runResolutionAgentWorkerIteration).toHaveBeenCalledTimes(1);
    const call = workerMock.runResolutionAgentWorkerIteration.mock.calls[0][0];
    expect(call.targetAgentId).toBe(AGENT_ID);
    expect(call.workerId.startsWith("manual_")).toBe(true);
    expect(call.now).toBe(NOW);
    expect(call.dependencies).toEqual({});
    expect(productionMock.createResolutionAgentWorkerDependencies).toHaveBeenCalledTimes(1);
  });

  it("2) unauthorized caller → throws, worker NOT called", async () => {
    const store = makeStore(makeAgent());
    const escrowReader = makeReader(6);

    await expect(
      runResolutionAgentIteration({
        agentId: AGENT_ID,
        authenticatedCaller: UNAUTHORIZED,
        store,
        escrowReader,
        now: NOW,
      }),
    ).rejects.toThrow("Access denied");
    expect(workerMock.runResolutionAgentWorkerIteration).not.toHaveBeenCalled();
  });

  it("3) terminal escrow state 5 (released) → throws, worker NOT called", async () => {
    const store = makeStore(makeAgent());
    const escrowReader = makeReader(5);

    await expect(
      runResolutionAgentIteration({
        agentId: AGENT_ID,
        authenticatedCaller: FUNDER,
        store,
        escrowReader,
        now: NOW,
      }),
    ).rejects.toThrow("terminal state");
    expect(workerMock.runResolutionAgentWorkerIteration).not.toHaveBeenCalled();
  });

  it("4) terminal escrow state 7 (cancelled) → throws, worker NOT called", async () => {
    const store = makeStore(makeAgent());
    const escrowReader = makeReader(7);

    await expect(
      runResolutionAgentIteration({
        agentId: AGENT_ID,
        authenticatedCaller: FUNDER,
        store,
        escrowReader,
        now: NOW,
      }),
    ).rejects.toThrow("terminal state");
    expect(workerMock.runResolutionAgentWorkerIteration).not.toHaveBeenCalled();
  });

  it("5) case missing on-chain ({ exists: false }) → throws, worker NOT called", async () => {
    const store = makeStore(makeAgent());
    const escrowReader = makeReader(null);

    await expect(
      runResolutionAgentIteration({
        agentId: AGENT_ID,
        authenticatedCaller: FUNDER,
        store,
        escrowReader,
        now: NOW,
      }),
    ).rejects.toThrow("does not exist on-chain");
    expect(workerMock.runResolutionAgentWorkerIteration).not.toHaveBeenCalled();
  });

  it("6) agent not found → throws ResolutionAgentNotFoundError", async () => {
    const store = makeStore(null);
    const escrowReader = makeReader(6);

    await expect(
      runResolutionAgentIteration({
        agentId: AGENT_ID,
        authenticatedCaller: FUNDER,
        store,
        escrowReader,
        now: NOW,
      }),
    ).rejects.toThrow(ResolutionAgentNotFoundError);
    expect(workerMock.runResolutionAgentWorkerIteration).not.toHaveBeenCalled();
  });
});
