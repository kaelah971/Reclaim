// ---------------------------------------------------------------------------
// Production execution path — real run_tool wiring tests
//
// Covers the RA1R.7B requirements:
//   1. expired policy blocks execution
//   2. renewed/in-policy agent permits the planned tool
//   3. insufficient budget blocks
//   4. run_tool no longer returns unsupported_action (dispatcher delegates)
//   5. correct facilitator/network/asset/payTo/amount
//   6. agent case wallet used (EIP-3009 `from` = case wallet)
//   7. failed facilitator/payment does not increment spent
//   8. successful verified settlement increments spent exactly 10000
//   9. duplicate retry cannot spend twice
//   10. no secret material emitted
//   11. non-run_tool control actions remain unchanged
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type {
  ResolutionAgent,
  ResolutionAgentPlan,
} from "../../types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { LeaseContext } from "../../worker/types";
import type { ToolExecutionRow } from "../../store/types";
import type {
  EvidenceQualityCheckDependencies,
  ResolutionAgentX402SettlementClient,
  EvidenceQualityCheckGenerator,
  ResolutionAgentWalletDecryptor,
  ResolutionAgentPaymentStore,
} from "../types";
import { createProductionActionExecutor } from "../executor-registry";
import { dispatchControlAction } from "../../worker/dispatcher";

const CASE_WALLET = "0xDeaDbeef00000000000000000000000000000000" as const;

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review." as const,
    status: "active",
    identity: {
      escrowPaymentId: "1",
      escrowChainId: "eip155:11142220",
      escrowContractAddress: "0x1a1ca38d6ac538d491a5c0db2ed7fddc3aec709f",
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh", "reclaim-dispute-brief-v1"],
      approvedBudgetAtomic: 40000n,
      expiresAt: Date.now() + 86400000,
      funderAddress: "0xF000000000000000000000000000000000000000",
    },
    budget: { approvedAtomic: 40000n, spentAtomic: 0n, reservedAtomic: 0n },
    plan: {
      steps: [{ kind: "purchase_evidence_check", description: "Run evidence check", toolId: "evidence-quality-check" }],
      currentStepIndex: 0,
      lastUpdated: Date.now(),
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
    observation: {
      escrowState: "delivered",
      evidenceCount: 1,
      evidenceVersionHash: "ev_hash_v1",
      caseVersionHash: "case_hash_v1",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: Date.now(),
    },
    caseWalletAddress: CASE_WALLET,
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "test_ciphertext",
      iv: "test_iv_data_12",
      authenticationTag: "test_auth_tag_data16b",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    activatedAt: Date.now() - 5000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeToolAction(): ResolutionAgentNextAction & { kind: "run_tool" } {
  return {
    kind: "run_tool",
    toolId: "evidence-quality-check",
    reason: "evidence_quality_check_required",
    toolRequest: {
      toolId: "evidence-quality-check",
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      caseVersionHash: "case_hash_v1",
      evidenceVersionHash: "ev_hash_v1",
    },
  };
}

function makeLeaseContext(): LeaseContext {
  return {
    agentId: "agent_test_1",
    ownerToken: "token_abc",
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 60000,
  };
}

function makeSettledSuccess(): ResolutionAgentX402SettlementClient {
  return {
    settleEvidenceQualityCheck: vi.fn().mockResolvedValue({
      success: true,
      txHash: "0xs-tx-hash",
      ambiguous: false,
      receipt: {
        facilitatorUrl: "https://api.x402.celo.org",
        x402Version: 2,
        scheme: "exact",
        network: "eip155:42220",
        payer: CASE_WALLET.toLowerCase(),
        payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
        token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        amount: "10000",
        paymentIdentifier: "pay_abc",
        settlementTxHash: "0xs-tx-hash",
        settlementSuccess: true,
        settledAt: new Date().toISOString(),
      },
    }),
  } as unknown as ResolutionAgentX402SettlementClient;
}

function makeGenerator(): EvidenceQualityCheckGenerator {
  return {
    generate: vi.fn().mockResolvedValue({
      assessment: {
        assessmentId: "assess_001",
        generatedAt: new Date().toISOString(),
        generationMode: "ai" as const,
        evidenceTitle: "Test",
        evidenceInputHash: "0xabcd",
        qualityScore: 80,
        relevanceRating: "high" as const,
        relevanceNote: "Relevant",
        credibilityAssessment: "Credible",
        completenessAssessment: "Complete",
        factualConsistencyNote: "Consistent",
        biasOrConflictNote: "None",
        strengths: [],
        weaknesses: [],
        recommendedActions: [],
        riskFlags: [],
        limitations: "AI only",
      },
      usedFallback: false,
    }),
  } as unknown as EvidenceQualityCheckGenerator;
}

interface MockStore {
  [key: string]: unknown;
}

function makeMockDependencies(overrides: {
  agent?: ResolutionAgent;
  existingExecution?: ToolExecutionRow | null;
  reserveResult?: { kind: "created" | "existing"; agentId: string; requestHash: string; state: string };
  settlementClient?: ResolutionAgentX402SettlementClient;
  walletDecryptor?: ResolutionAgentWalletDecryptor;
} = {}) {
  const store: MockStore = {
    listToolExecutions: vi.fn().mockResolvedValue([]),
    getToolExecutionByRequestHash: vi
      .fn()
      .mockResolvedValue(overrides.existingExecution ?? null),
    updateToolExecution: vi.fn().mockResolvedValue(undefined),
    getAgentVersion: vi.fn().mockResolvedValue(1),
    updateAgent: vi.fn(async (a: ResolutionAgent) => a),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    getAgentById: vi.fn().mockImplementation(async () => {
      // After the atomic reservation the agent is in running_tool with the
      // price reserved — mirror the RPC's post-state for the given agent.
      const base = overrides.agent ?? makeAgent();
      return {
        ...base,
        status: "running_tool",
        currentRunningToolId: "evidence-quality-check",
        budget: {
          approvedAtomic: base.budget.approvedAtomic,
          spentAtomic: base.budget.spentAtomic,
          reservedAtomic: 10000n,
        },
      };
    }),
    reserveToolExecutionAtomically: vi.fn().mockResolvedValue(
      overrides.reserveResult ?? { kind: "created", agentId: "", requestHash: "", state: "reserved" },
    ),
    createToolExecution: vi.fn().mockResolvedValue(undefined),
  };

  const settlementClient = overrides.settlementClient ?? makeSettledSuccess();
  const generator = makeGenerator();
  const walletDecryptor = overrides.walletDecryptor ?? ({
    decrypt: vi.fn().mockResolvedValue({
      address: CASE_WALLET,
    } as unknown as Parameters<ResolutionAgentWalletDecryptor["decrypt"]>[0] extends never
      ? never
      : Awaited<ReturnType<ResolutionAgentWalletDecryptor["decrypt"]>>),
  } as unknown as ResolutionAgentWalletDecryptor);
  const paymentStore = {
    persistPaymentProof: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResolutionAgentPaymentStore;

  const dependencies: EvidenceQualityCheckDependencies = {
    store: store as unknown as EvidenceQualityCheckDependencies["store"],
    settlementClient,
    generator,
    walletDecryptor,
    paymentStore,
  };

  return { dependencies, store, settlementClient, generator, walletDecryptor, paymentStore };
}

const CELO_MAINNET_ID = 42220;

describe("RA1R.7B — run_tool execution path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1) expired policy blocks execution (no reservation, no settlement, no spend)", async () => {
    const agent = makeAgent({
      policy: { ...makeAgent().policy, expiresAt: Date.now() - 1000 },
    });
    const { dependencies, store } = makeMockDependencies({ agent });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).toBe("skipped");
    expect(String("reason" in result ? result.reason : "")).toContain("agent_expired");
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("2) renewed/in-policy agent permits the planned tool (reaches settlement)", async () => {
    const agent = makeAgent(); // in-policy
    const { dependencies } = makeMockDependencies({ agent });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).not.toBe("skipped");
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).toHaveBeenCalledTimes(1);
  });

  it("3) insufficient budget blocks execution", async () => {
    const agent = makeAgent({
      budget: { approvedAtomic: 5000n, spentAtomic: 0n, reservedAtomic: 0n },
    });
    const { dependencies, store } = makeMockDependencies({ agent });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).toBe("skipped");
    expect(String("reason" in result ? result.reason : "")).toContain("insufficient_budget");
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("4) dispatcher run_tool delegates to the executor instead of unsupported_action", async () => {
    const agent = makeAgent();
    const executor = {
      executeOneAction: vi.fn().mockResolvedValue({ kind: "executed" }),
    };
    const plan: ResolutionAgentPlan = agent.plan!;

    const { result } = await dispatchControlAction({
      agent,
      plan,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
      store: {} as never,
      executor: executor as never,
    });

    expect(executor.executeOneAction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "executed" });
  });

  it("4b) dispatcher still returns unsupported_action defensively when no executor is wired", async () => {
    const agent = makeAgent();
    const { result } = await dispatchControlAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
      store: {} as never,
      executor: undefined as never,
    });
    expect(result).toEqual({ kind: "unsupported_action", actionKind: "run_tool" });
  });

  it("5+6) settlement targets the official facilitator config and uses the AGENT case wallet", async () => {
    const agent = makeAgent();
    const { dependencies, settlementClient } = makeMockDependencies({ agent });
    const executor = createProductionActionExecutor(dependencies);

    await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(settlementClient.settleEvidenceQualityCheck).toHaveBeenCalledTimes(1);
    const settleParams = (settlementClient.settleEvidenceQualityCheck as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(settleParams.expectedPriceAtomic).toBe(10000n);
    expect(settleParams.network).toBe("eip155:42220");
    expect(settleParams.asset).toBe("0xcebA9300f2b948710d2653dD7B07f33A8B32118C");
    expect(settleParams.payTo).toBe("0x85522bdE267d05bf8CE8813F97c75417b7894A33");

    expect(settleParams.payerAccount.address.toLowerCase()).toBe(CASE_WALLET.toLowerCase());
    // The adapter verifies the decrypted account against the persisted
    // caseWalletAddress before settling — the case wallet is the payer.
    expect(CASE_WALLET.toLowerCase()).toBe(agent.caseWalletAddress.toLowerCase());
  });

  it("7) failed facilitator/payment does not increment spent", async () => {
    const agent = makeAgent();
    const settlementClient = {
      settleEvidenceQualityCheck: vi.fn().mockResolvedValue({
        success: false,
        ambiguous: false,
        error: "Facilitator settlement failed.",
      }),
    } as unknown as ResolutionAgentX402SettlementClient;
    const { dependencies, store } = makeMockDependencies({ agent, settlementClient });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).not.toBe("executed");
    // Spent must remain 0: the agent updates must never include spentAtomic > 0.
    const agentUpdates = (store.updateAgent as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.map((c: unknown[]) => (c[0] as ResolutionAgent));
    for (const updated of agentUpdates) {
      expect(updated.budget.spentAtomic).toBe(0n);
    }
  });

  it("8) successful verified settlement increments spent by exactly 10000", async () => {
    const agent = makeAgent();
    const { dependencies, store, paymentStore } = makeMockDependencies({ agent });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).toBe("executed");
    const spentUpdate = (store.updateAgent as unknown as ReturnType<typeof vi.fn>)
      .mock.calls
      .map((c: unknown[]) => c[0] as ResolutionAgent)
      .find((a) => a.budget.spentAtomic === 10000n);
    expect(spentUpdate).toBeDefined();
    // Payment proof persisted
    expect(paymentStore.persistPaymentProof).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent.id,
        txHash: "0xs-tx-hash",
      }),
    );
  });

  it("9) duplicate retry cannot spend twice (idempotent request hash)", async () => {
    const agent = makeAgent();
    const existing: ToolExecutionRow = {
      id: "exec_001",
      agent_id: agent.id,
      tool_identifier: "evidence-quality-check",
      request_hash: "0xhash",
      case_version_hash: "case_hash_v1",
      evidence_version_hash: "ev_hash_v1",
      state: "settled",
      price_atomic: 10000,
      network: "eip155:42220",
      asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
      pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
      payment_reference: null,
      settlement_tx_hash: "0xs-tx-hash",
      result_reference: null,
      result_data: null,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { dependencies, settlementClient, store } = makeMockDependencies({
      agent,
      existingExecution: existing,
    });
    const executor = createProductionActionExecutor(dependencies);

    const first = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });
    const second = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("executed");
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
    expect(settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("10) no secret material is emitted on decryption failure or settlement failure", async () => {
    const agent = makeAgent();
    const walletDecryptor = {
      decrypt: vi.fn().mockRejectedValue(new Error("decrypt failed")),
    } as unknown as ResolutionAgentWalletDecryptor;
    const { dependencies } = makeMockDependencies({ agent, walletDecryptor });
    const executor = createProductionActionExecutor(dependencies);

    const result = await executor.executeOneAction({
      agent,
      plan: agent.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });

    expect(result.kind).toBe("failed_recoverable");
    const reason = String("reason" in result ? result.reason : "");
    expect(reason).toContain("Wallet decryption failed");
    expect(reason).not.toContain("ciphertext");
    expect(reason).not.toContain("authenticationTag");
    expect(reason).not.toContain("test_ciphertext");
    expect(reason).not.toMatch(/0x[0-9a-f]{20,}/i);

    // Settlement failure path also stays clean.
    const settlementClient = {
      settleEvidenceQualityCheck: vi.fn().mockRejectedValue(new Error("raw upstream detail: abc123")),
    } as unknown as ResolutionAgentX402SettlementClient;
    const agent2 = makeAgent({ status: "running_tool", currentRunningToolId: "evidence-quality-check" });
    const { dependencies: deps2 } = makeMockDependencies({ agent: agent2, settlementClient });
    const executor2 = createProductionActionExecutor(deps2);
    const result2 = await executor2.executeOneAction({
      agent: agent2,
      plan: agent2.plan!,
      action: makeToolAction(),
      leaseContext: makeLeaseContext(),
      now: Date.now(),
    });
    const reason2 = String("reason" in result2 ? result2.reason : "");
    expect(reason2).not.toContain("abc123");
  });

  it("11) non-run_tool control actions remain unchanged (no_action skipped via dispatcher)", async () => {
    const agent = makeAgent();
    const executor = { executeOneAction: vi.fn() };
    const { result } = await dispatchControlAction({
      agent,
      plan: agent.plan!,
      action: { kind: "no_action", reason: "agent_not_active" },
      leaseContext: makeLeaseContext(),
      now: Date.now(),
      store: {} as never,
      executor: executor as never,
    });

    expect(result).toEqual({ kind: "skipped", reason: "Planner indicated no action is needed" });
    expect(executor.executeOneAction).not.toHaveBeenCalled();
  });

  it("11b) x402 facilitator constants match the planner tool definition", async () => {
    const { getToolDefinition } = await import("../../tools");
    const { AGENT_FACILITATOR_NETWORK, AGENT_MAINNET_USDC_ADDRESS, AGENT_PAY_TO_ADDRESS } =
      await import("../../types");
    const def = getToolDefinition("evidence-quality-check");
    expect(def?.network).toBe(AGENT_FACILITATOR_NETWORK);
    expect(def?.asset).toBe(AGENT_MAINNET_USDC_ADDRESS);
    expect(def?.payTo).toBe(AGENT_PAY_TO_ADDRESS);
    expect(def?.priceAtomic).toBe(10000n);
    expect(AGENT_FACILITATOR_NETWORK).toBe(`eip155:${CELO_MAINNET_ID}`);
  });
});
