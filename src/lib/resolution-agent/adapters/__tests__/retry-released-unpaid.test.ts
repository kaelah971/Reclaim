// ---------------------------------------------------------------------------
// RA1R.7O — safe retry of RELEASED-UNPAID tool executions
//
// Proves the retry semantics end to end at the adapter level:
//   - released-unpaid failed execution -> same audit row re-reserved once
//     (RPC kind 'reused'), request hash unchanged
//   - settled / settlement-proof executions can NEVER be reused
//   - unreleased failed_recoverable stays blocked/waiting
//   - successful retry settles normally; failed retry can release again
//   - fresh-execution behavior unchanged (covered by the existing suites)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { ResolutionAgent } from "../../types";
import type { LeaseContext } from "../../worker/types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { ToolExecutionRow } from "../../store/types";
import type { EvidenceQualityCheckDependencies } from "../types";
import { executeEvidenceQualityCheck } from "../evidence-quality-check";

const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";
const REQ_HASH =
  "0x8a26b7131c30af20a6210b78cc00f250f20341ed80feb7219e48b36303c83015";

function makeAgent(): ResolutionAgent {
  return {
    id: AGENT_ID,
    goal: "Prepare this payment case for fair human review." as const,
    status: "running_tool",
    identity: {
      escrowPaymentId: "1",
      escrowChainId: "eip155:11142220",
      escrowContractAddress: "0x1a1ca38d6ac538d491a5c0db2ed7fddc3aec709f",
    },
    policy: {
      allowedTools: ["evidence-quality-check"],
      approvedBudgetAtomic: 40000n,
      expiresAt: Date.now() + 86400000,
      funderAddress: "0xF000000000000000000000000000000000000000",
    },
    budget: { approvedAtomic: 40000n, spentAtomic: 0n, reservedAtomic: 10000n },
    plan: {
      steps: [{ kind: "purchase_evidence_check", description: "run", toolId: "evidence-quality-check" }],
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
    caseWalletAddress: "0xDeaDbeef00000000000000000000000000000000",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "cipher",
      iv: "iv_iv_iv_iv_iv",
      authenticationTag: "tag_tag_tag_tag_tag",
    },
    settledToolIds: [],
    currentRunningToolId: "evidence-quality-check",
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    activatedAt: Date.now() - 5000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
  };
}

function makeExecutionRow(overrides: Partial<ToolExecutionRow> = {}): ToolExecutionRow {
  return {
    id: "exec_001",
    agent_id: AGENT_ID,
    tool_identifier: "evidence-quality-check",
    request_hash: REQ_HASH,
    case_version_hash: "case_hash_v1",
    evidence_version_hash: "ev_hash_v1",
    state: "failed_recoverable",
    price_atomic: 10000,
    network: "eip155:42220",
    asset_address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    pay_to_address: "0x85522bde267d05bf8ce8813f97c75417b7894a33",
    payment_reference: null,
    settlement_tx_hash: null,
    result_reference: null,
    result_data: null,
    failure_reason: "Facilitator settlement request failed.",
    released_unpaid_at: "2026-08-09T06:31:56.579+00:00",
    created_at: "2026-08-09T05:33:04.586+00:00",
    updated_at: "2026-08-09T06:31:56.579+00:00",
    ...overrides,
  };
}

function makeDeps(options: {
  existing?: ToolExecutionRow | null;
  reserveKind?: "reused" | "existing" | "created";
  settle?: "success" | "throws";
}) {
  const store = {
    getToolExecutionByRequestHash: vi.fn().mockResolvedValue(options.existing ?? null),
    reserveToolExecutionAtomically: vi.fn().mockResolvedValue({
      kind: options.reserveKind ?? "reused",
      agentId: AGENT_ID,
      requestHash: REQ_HASH,
      state:
        options.reserveKind === "existing"
          ? options.existing?.state ?? "reserved"
          : "reserved",
    }),
    getAgentById: vi.fn().mockResolvedValue(
      makeAgent(),
    ),
    getAgentVersion: vi.fn().mockResolvedValue(15),
    updateToolExecution: vi.fn().mockResolvedValue(undefined),
    updateAgent: vi.fn(async (a: ResolutionAgent) => a),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    listToolExecutions: vi.fn().mockResolvedValue([]),
    createToolExecution: vi.fn().mockResolvedValue(undefined),
    releaseUnpaidToolExecution: vi.fn().mockResolvedValue({
      kind: "released",
      agentId: AGENT_ID,
      requestHash: REQ_HASH,
    }),
  } as unknown as EvidenceQualityCheckDependencies["store"];

  const settle = vi.fn(
    options.settle === "throws"
      ? () => Promise.reject(new Error("Facilitator settle failed (401): invalid api key"))
      : () =>
          Promise.resolve({
            success: true,
            txHash: "0xsettle-tx",
            receipt: {
              facilitatorUrl: "https://api.x402.celo.org",
              x402Version: 2,
              scheme: "exact",
              network: "eip155:42220",
              payer: "0xdeadbeef00000000000000000000000000000000",
              payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
              token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
              amount: "10000",
              paymentIdentifier: "pay_retry_001",
              settlementTxHash: "0xsettle-tx",
              settlementSuccess: true,
              settledAt: new Date().toISOString(),
            },
            ambiguous: false,
          }),
  );

  const dependencies = {
    store,
    settlementClient: { settleEvidenceQualityCheck: settle } as unknown as EvidenceQualityCheckDependencies["settlementClient"],
    generator: {
      generate: vi.fn().mockResolvedValue({
        assessment: {
          assessmentId: "assess_retry",
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
    } as unknown as EvidenceQualityCheckDependencies["generator"],
    walletDecryptor: {
      decrypt: vi.fn().mockResolvedValue({ address: "0xDeaDbeef00000000000000000000000000000000" }),
    } as unknown as EvidenceQualityCheckDependencies["walletDecryptor"],
    paymentStore: { persistPaymentProof: vi.fn().mockResolvedValue(undefined) } as unknown as EvidenceQualityCheckDependencies["paymentStore"],
  } as EvidenceQualityCheckDependencies;

  return { store, dependencies, settle };
}

const lease: LeaseContext = { agentId: AGENT_ID, ownerToken: "tok", acquiredAt: 0, expiresAt: Date.now() + 60000 };
const action: ResolutionAgentNextAction & { kind: "run_tool" } = {
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

describe("RA1R.7O retry of released-unpaid execution", () => {
  it("1+2) released-unpaid failed execution proceeds with the SAME request hash via the atomic RPC", async () => {
    const { store, dependencies } = makeDeps({ existing: makeExecutionRow(), reserveKind: "reused" });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({
      agent,
      plan: agent.plan!,
      action,
      leaseContext: lease,
      now: Date.now(),
      dependencies,
    });

    // Proceeded (not waiting), and the retry reused the SAME canonical
    // request identity for the existing-row lookup and the reservation.
    expect(result.kind).not.toBe("waiting");
    const lookupHash = (store.getToolExecutionByRequestHash as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const reserveCall = (store.reserveToolExecutionAtomically as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(lookupHash).toBe(reserveCall.requestHash); // unchanged canonical hash
    expect(lookupHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(reserveCall.priceAtomic).toBe(10000n);
  });

  it("4+5) re-reservation reserves 10000 exactly once; spent stays 0 until settlement", async () => {
    const { store, dependencies, settle } = makeDeps({ existing: makeExecutionRow(), reserveKind: "reused" });
    const agent = makeAgent();

    await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(store.reserveToolExecutionAtomically).toHaveBeenCalledTimes(1);
    const reserveCall = (store.reserveToolExecutionAtomically as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(reserveCall.priceAtomic).toBe(10000n);
    expect(settle).toHaveBeenCalledTimes(1);
    // Spent only moves on verified settlement success (exactly 10000).
    const spentUpdate = (store.updateAgent as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as ResolutionAgent)
      .find((a) => a.budget.spentAtomic === 10000n);
    expect(spentUpdate).toBeDefined();
  });

  it("6) concurrent retry cannot reserve twice — RPC returns existing for the already-reused row", async () => {
    // First caller gets 'reused'; a concurrent second caller must observe the
    // row as reserved/unreleased and receive 'existing' (waiting), never a
    // second reservation.
    const { store, dependencies } = makeDeps({ existing: makeExecutionRow(), reserveKind: "existing" });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("waiting");
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("7) settled execution can never be reused (short-circuits as executed)", async () => {
    const { store, dependencies } = makeDeps({
      existing: makeExecutionRow({ state: "settled", settlement_tx_hash: "0xs", payment_reference: "p" }),
    });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("executed");
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("8) execution with settlement proof can never be reused", async () => {
    const { store, dependencies } = makeDeps({
      existing: makeExecutionRow({ settlement_tx_hash: "0xsettled-tx" }),
    });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("waiting"); // not a retry, no reservation
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).not.toHaveBeenCalled();
  });

  it("9) unreleased failed_recoverable remains blocked/waiting", async () => {
    const { store, dependencies } = makeDeps({
      existing: makeExecutionRow({ released_unpaid_at: null }),
    });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("waiting");
    expect(store.reserveToolExecutionAtomically).not.toHaveBeenCalled();
  });

  it("10) successful retry settles normally (same row, one payment)", async () => {
    const { store, dependencies } = makeDeps({ existing: makeExecutionRow(), reserveKind: "reused", settle: "success" });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("executed");
    expect(dependencies.settlementClient.settleEvidenceQualityCheck).toHaveBeenCalledTimes(1);
    const lookupHash = (store.getToolExecutionByRequestHash as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(store.updateToolExecution).toHaveBeenCalledWith(
      AGENT_ID,
      lookupHash,
      expect.objectContaining({ state: "settled" }),
    );
  });

  it("11) failed retry can again use the unpaid-release path (00013)", async () => {
    const { store, dependencies } = makeDeps({ existing: makeExecutionRow(), reserveKind: "reused", settle: "throws" });
    const agent = makeAgent();

    const result = await executeEvidenceQualityCheck({ agent, plan: agent.plan!, action, leaseContext: lease, now: Date.now(), dependencies });

    expect(result.kind).toBe("failed_recoverable");
    expect(store.releaseUnpaidToolExecution).toHaveBeenCalledTimes(1);
    const releaseCall = (store.releaseUnpaidToolExecution as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lookupHash = (store.getToolExecutionByRequestHash as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(releaseCall.requestHash).toBe(lookupHash); // same canonical identity
  });
});
