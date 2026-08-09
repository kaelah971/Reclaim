// ---------------------------------------------------------------------------
// Unpaid reservation release (RA1R.7L) — store RPC mapping + adapter wiring
//
//   1. store.releaseUnpaidToolExecution sends the exact 4 RPC args and maps
//      results; "cannot be released" maps to an explicit denial.
//   2. the adapter calls releaseUnpaidToolExecution when settlement THROWS
//      (best-effort) and marks the execution failed_recoverable.
//   3. the accidental probe execution (request_hash 0xprobe-only-no-mutation)
//      is releasable through the same path because it has no settlement proof.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { SupabaseResolutionAgentStore } from "../../store/supabase";
import type { ResolutionAgent } from "../../types";
import type { LeaseContext } from "../../worker/types";
import type { ResolutionAgentNextAction } from "../../planner/types";
import type { EvidenceQualityCheckDependencies } from "../types";
import { executeEvidenceQualityCheck } from "../evidence-quality-check";

const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";

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

describe("store.releaseUnpaidToolExecution — RPC mapping", () => {
  function makeClient(rpcResult: unknown, rpcError: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: rpcError });
    return { client: { rpc } as never, rpc };
  }

  it("sends the exact 4-argument RPC payload and maps 'released'", async () => {
    const { client, rpc } = makeClient({ kind: "released", agent_id: AGENT_ID, request_hash: "0xprobe-only-no-mutation" });
    const store = new SupabaseResolutionAgentStore(client);

    const result = await store.releaseUnpaidToolExecution({
      agentId: AGENT_ID,
      requestHash: "0xprobe-only-no-mutation",
      expectedAgentVersion: 13,
      now: 1786253000000,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0];
    expect(fnName).toBe("release_unpaid_tool_execution");
    expect(args).toEqual({
      p_agent_id: AGENT_ID,
      p_request_hash: "0xprobe-only-no-mutation",
      p_expected_version: 13,
      p_now: "2026-08-09T05:23:20.000Z",
    });
    expect(result).toEqual({ kind: "released", agentId: AGENT_ID, requestHash: "0xprobe-only-no-mutation" });
  });

  it("maps idempotent 'already_released'", async () => {
    const { client } = makeClient({ kind: "already_released", agent_id: AGENT_ID, request_hash: "0xh" });
    const store = new SupabaseResolutionAgentStore(client);
    const result = await store.releaseUnpaidToolExecution({
      agentId: AGENT_ID,
      requestHash: "0xh",
      expectedAgentVersion: 13,
      now: 0,
    });
    expect(result.kind).toBe("already_released");
  });

  it("maps 'cannot be released' to an explicit denial (settled/proof)", async () => {
    const { client } = makeClient(null, { message: "Settled execution cannot be released: 0xh" });
    const store = new SupabaseResolutionAgentStore(client);
    await expect(
      store.releaseUnpaidToolExecution({ agentId: AGENT_ID, requestHash: "0xh", expectedAgentVersion: 13, now: 0 }),
    ).rejects.toThrow("Execution has settlement proof — release denied");
  });

  it("maps version conflicts", async () => {
    const { client } = makeClient(null, { message: "Version conflict: expected 13, actual 14" });
    const store = new SupabaseResolutionAgentStore(client);
    await expect(
      store.releaseUnpaidToolExecution({ agentId: AGENT_ID, requestHash: "0xh", expectedAgentVersion: 13, now: 0 }),
    ).rejects.toThrow("Version conflict");
  });
});

describe("adapter — release on settlement throw", () => {
  function makeDeps(settleError: unknown) {
    const store = {
      getAgentById: vi.fn().mockResolvedValue(makeAgent()),
      getToolExecutionByRequestHash: vi.fn().mockResolvedValue(null),
      getAgentVersion: vi.fn().mockResolvedValue(12),
      reserveToolExecutionAtomically: vi.fn().mockResolvedValue({ kind: "created", agentId: AGENT_ID, requestHash: "0xreal", state: "reserved" }),
      updateToolExecution: vi.fn().mockResolvedValue(undefined),
      updateAgent: vi.fn(async (a: ResolutionAgent) => a),
      appendEvent: vi.fn().mockResolvedValue(undefined),
      listToolExecutions: vi.fn().mockResolvedValue([]),
      createToolExecution: vi.fn().mockResolvedValue(undefined),
      releaseUnpaidToolExecution: vi.fn().mockResolvedValue({ kind: "released", agentId: AGENT_ID, requestHash: "0xreal" }),
    } as unknown as EvidenceQualityCheckDependencies["store"];

    const dependencies = {
      store,
      settlementClient: {
        settleEvidenceQualityCheck: vi.fn().mockRejectedValue(settleError),
      } as unknown as EvidenceQualityCheckDependencies["settlementClient"],
      generator: { generate: vi.fn() } as unknown as EvidenceQualityCheckDependencies["generator"],
      walletDecryptor: {
        decrypt: vi.fn().mockResolvedValue({ address: "0xDeaDbeef00000000000000000000000000000000" }),
      } as unknown as EvidenceQualityCheckDependencies["walletDecryptor"],
      paymentStore: { persistPaymentProof: vi.fn() } as unknown as EvidenceQualityCheckDependencies["paymentStore"],
    } as EvidenceQualityCheckDependencies;

    return dependencies;
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

  it("calls releaseUnpaidToolExecution exactly once when settlement throws, spent stays 0", async () => {
    const deps = makeDeps(new Error("Facilitator settle failed (401): invalid api key"));
    const agent = makeAgent();
    const result = await executeEvidenceQualityCheck({
      agent,
      plan: agent.plan!,
      action,
      leaseContext: lease,
      now: Date.now(),
      dependencies: deps,
    });

    expect(deps.store.releaseUnpaidToolExecution).toHaveBeenCalledTimes(1);
    const releaseCall = (deps.store.releaseUnpaidToolExecution as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(releaseCall.agentId).toBe(AGENT_ID);
    expect(releaseCall.requestHash).toBeTruthy();

    expect(result.kind).toBe("failed_recoverable");
    expect(deps.store.updateToolExecution).toHaveBeenCalledWith(
      AGENT_ID,
      expect.any(String),
      expect.objectContaining({ state: "failed_recoverable" }),
    );
    // Spent must never be touched by the failure path.
    const agentUpdates = (deps.store.updateAgent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as ResolutionAgent,
    );
    for (const updated of agentUpdates) {
      expect(updated.budget.spentAtomic).toBe(0n);
    }
  });

  it("release reads the agent version FRESH (reserve bumps it), never the stale pre-reservation version", async () => {
    // The reserve RPC increments the agent version; a release using the
    // pre-reservation version would hit Version conflict and strand the
    // reservation. The adapter must re-read the version at release time.
    const deps = makeDeps(new Error("Facilitator settle failed (401): invalid api key"));
    const agent = makeAgent();
    // Pre-reservation read returns 12 (stale); release-time read returns 13.
    (deps.store.getAgentVersion as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(12) // before reserve
      .mockResolvedValue(13); // fresh read at release

    const result = await executeEvidenceQualityCheck({
      agent,
      plan: agent.plan!,
      action,
      leaseContext: lease,
      now: Date.now(),
      dependencies: deps,
    });

    expect(result.kind).toBe("failed_recoverable");
    expect(deps.store.releaseUnpaidToolExecution).toHaveBeenCalledTimes(1);
    const releaseCall = (deps.store.releaseUnpaidToolExecution as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(releaseCall.expectedAgentVersion).toBe(13); // fresh, not 12
  });
});
