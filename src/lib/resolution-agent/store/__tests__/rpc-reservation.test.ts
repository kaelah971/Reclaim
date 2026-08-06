// ---------------------------------------------------------------------------
// RPC Reservation Store Tests
//
// Verifies that reserveToolExecutionAtomically calls the Supabase .rpc()
// method with the correct function name and parameters, and correctly maps
// the response and error classification.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from "vitest";

describe("reserveToolExecutionAtomically — RPC call", () => {
  it("calls Supabase .rpc() with the correct function name", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const rpcSpy = vi.fn().mockResolvedValue({
      data: { kind: "created", agent_id: "agt_1", request_hash: "0xabc", state: "reserved" },
      error: null,
    });

    const client = {
      rpc: rpcSpy,
      from: () => {
        throw new Error("from() should not be called");
      },
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await store.reserveToolExecutionAtomically({
      agentId: "agt_1",
      expectedAgentVersion: 1,
      requestHash: "0xabc",
      toolId: "evidence-quality-check",
      caseVersionHash: "cv1",
      evidenceVersionHash: "ev1",
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xCeBA",
      payTo: "0x8552",
      serviceIdentifier: "evidence-quality-check",
      policyVersion: "v1",
      now: 1_700_000_000,
    });

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpcSpy.mock.calls[0];
    expect(fnName).toBe("reserve_resolution_agent_tool_execution");
    expect(params).toBeDefined();
  });

  it("passes all parameters to the RPC with correct PostgreSQL-naming convention", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const rpcSpy = vi.fn().mockResolvedValue({
      data: { kind: "created", agent_id: "agt_1", request_hash: "0xabc", state: "reserved" },
      error: null,
    });

    const store = new SupabaseResolutionAgentStore({ rpc: rpcSpy } as any);
    await store.reserveToolExecutionAtomically({
      agentId: "agt_1",
      expectedAgentVersion: 2,
      requestHash: "0xdef",
      toolId: "eqc",
      caseVersionHash: "cv2",
      evidenceVersionHash: "ev2",
      priceAtomic: 20000n,
      network: "eip155:1",
      asset: "0xAsset",
      payTo: "0xPay",
      serviceIdentifier: "eqc-svc",
      policyVersion: "v2",
      now: 2_000_000_000,
    });

    const [, params] = rpcSpy.mock.calls[0];
    expect(params.p_agent_id).toBe("agt_1");
    expect(params.p_expected_version).toBe(2);
    expect(params.p_request_hash).toBe("0xdef");
    expect(params.p_tool_id).toBe("eqc");
    expect(params.p_case_version_hash).toBe("cv2");
    expect(params.p_evidence_version_hash).toBe("ev2");
    expect(params.p_price_atomic).toBe(20000);
    expect(params.p_network).toBe("eip155:1");
    expect(params.p_asset).toBe("0xAsset");
    expect(params.p_pay_to).toBe("0xPay");
    expect(params.p_service_identifier).toBe("eqc-svc");
    expect(params.p_policy_version).toBe("v2");
    expect(params.p_now).toBeDefined();
  });
});

describe("reserveToolExecutionAtomically — result mapping", () => {
  it("returns created result from RPC", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { kind: "created", agent_id: "agt_1", request_hash: "0xabc", state: "reserved" },
        error: null,
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.reserveToolExecutionAtomically({
      agentId: "agt_1",
      expectedAgentVersion: 1,
      requestHash: "0xabc",
      toolId: "eqc",
      caseVersionHash: "cv1",
      evidenceVersionHash: "ev1",
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xCeBA",
      payTo: "0x8552",
      serviceIdentifier: "eqc",
      policyVersion: "v1",
      now: 1_700_000_000,
    });

    expect(result.kind).toBe("created");
    expect(result.agentId).toBe("agt_1");
    expect(result.requestHash).toBe("0xabc");
    expect(result.state).toBe("reserved");
  });

  it("returns existing result from RPC", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { kind: "existing", agent_id: "agt_1", request_hash: "0xabc", state: "settled" },
        error: null,
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.reserveToolExecutionAtomically({
      agentId: "agt_1",
      expectedAgentVersion: 1,
      requestHash: "0xabc",
      toolId: "eqc",
      caseVersionHash: "cv1",
      evidenceVersionHash: "ev1",
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xCeBA",
      payTo: "0x8552",
      serviceIdentifier: "eqc",
      policyVersion: "v1",
      now: 1_700_000_000,
    });

    expect(result.kind).toBe("existing");
    expect(result.agentId).toBe("agt_1");
    expect(result.requestHash).toBe("0xabc");
    expect(result.state).toBe("settled");
  });
});

describe("reserveToolExecutionAtomically — error classification", () => {
  it("throws 'Agent not found' on agent not found error", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Agent not found: agt_1" },
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await expect(
      store.reserveToolExecutionAtomically({
        agentId: "agt_1",
        expectedAgentVersion: 1,
        requestHash: "0xabc",
        toolId: "eqc",
        caseVersionHash: "cv1",
        evidenceVersionHash: "ev1",
        priceAtomic: 10000n,
        network: "eip155:42220",
        asset: "0xCeBA",
        payTo: "0x8552",
        serviceIdentifier: "eqc",
        policyVersion: "v1",
        now: 1_700_000_000,
      }),
    ).rejects.toThrow("Agent not found");
  });

  it("throws 'Version conflict' on version conflict error", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Version conflict: expected 1, actual 3" },
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await expect(
      store.reserveToolExecutionAtomically({
        agentId: "agt_1",
        expectedAgentVersion: 1,
        requestHash: "0xabc",
        toolId: "eqc",
        caseVersionHash: "cv1",
        evidenceVersionHash: "ev1",
        priceAtomic: 10000n,
        network: "eip155:42220",
        asset: "0xCeBA",
        payTo: "0x8552",
        serviceIdentifier: "eqc",
        policyVersion: "v1",
        now: 1_700_000_000,
      }),
    ).rejects.toThrow("Version conflict");
  });

  it("throws 'Invalid lifecycle state' on status error", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Agent status draft cannot start tool execution" },
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await expect(
      store.reserveToolExecutionAtomically({
        agentId: "agt_1",
        expectedAgentVersion: 1,
        requestHash: "0xabc",
        toolId: "eqc",
        caseVersionHash: "cv1",
        evidenceVersionHash: "ev1",
        priceAtomic: 10000n,
        network: "eip155:42220",
        asset: "0xCeBA",
        payTo: "0x8552",
        serviceIdentifier: "eqc",
        policyVersion: "v1",
        now: 1_700_000_000,
      }),
    ).rejects.toThrow("Invalid lifecycle state");
  });

  it("throws 'Insufficient budget' on budget error", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Insufficient budget: approved 5000, spent 0, reserved 0, requested 10000" },
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await expect(
      store.reserveToolExecutionAtomically({
        agentId: "agt_1",
        expectedAgentVersion: 1,
        requestHash: "0xabc",
        toolId: "eqc",
        caseVersionHash: "cv1",
        evidenceVersionHash: "ev1",
        priceAtomic: 10000n,
        network: "eip155:42220",
        asset: "0xCeBA",
        payTo: "0x8552",
        serviceIdentifier: "eqc",
        policyVersion: "v1",
        now: 1_700_000_000,
      }),
    ).rejects.toThrow("Insufficient budget");
  });

  it("re-throws unclassified errors", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Some unexpected database error" },
      }),
    };

    const store = new SupabaseResolutionAgentStore(client as any);
    await expect(
      store.reserveToolExecutionAtomically({
        agentId: "agt_1",
        expectedAgentVersion: 1,
        requestHash: "0xabc",
        toolId: "eqc",
        caseVersionHash: "cv1",
        evidenceVersionHash: "ev1",
        priceAtomic: 10000n,
        network: "eip155:42220",
        asset: "0xCeBA",
        payTo: "0x8552",
        serviceIdentifier: "eqc",
        policyVersion: "v1",
        now: 1_700_000_000,
      }),
    ).rejects.toThrow();
  });
});
