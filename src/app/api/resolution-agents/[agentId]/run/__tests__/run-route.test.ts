// @vitest-environment node
// ---------------------------------------------------------------------------
// Run route — POST /api/resolution-agents/[agentId]/run
//
// Wallet-auth transport tests: a real funder signature over the canonical
// run-agent message, transported via encodeWalletAuthMessage, must decode
// server-side and reach runResolutionAgentIteration. The SERVICE module is
// mocked (createStore + runResolutionAgentIteration) — the worker is NEVER
// executed and no live transactions/DB writes occur.
//
// Also verifies the route's own guards:
//   - missing wallet headers            → 401, service not called
//   - signature over a DIFFERENT action → 400 MESSAGE_ACTION_MISMATCH
//   - tampered encoded message          → 401, service not called
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signMessage, privateKeyToAccount } from "viem/accounts";
import {
  buildRunAgentMessage,
  buildPauseMessage,
} from "@/lib/resolution-agent/api/auth";
import { encodeWalletAuthMessage } from "@/lib/x402/walletAuth";

const FUNDER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FUNDER_ACCOUNT = privateKeyToAccount(FUNDER_KEY);

const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";

// Mock ONLY the service layer of the run route — wallet-auth helpers and
// signature verification stay REAL. The worker is mocked here too (the
// service mock resolves without executing any worker code).
const serviceMock = vi.hoisted(() => ({
  createStore: vi.fn(),
  runResolutionAgentIteration: vi.fn(),
}));

vi.mock("@/lib/resolution-agent/api/service", () => ({
  createStore: serviceMock.createStore,
  runResolutionAgentIteration: serviceMock.runResolutionAgentIteration,
}));

import { POST } from "@/app/api/resolution-agents/[agentId]/run/route";

describe("POST /api/resolution-agents/[agentId]/run", () => {
  beforeEach(() => {
    serviceMock.createStore.mockReset();
    serviceMock.runResolutionAgentIteration.mockReset();
    serviceMock.createStore.mockReturnValue({
      getAgentById: vi.fn().mockResolvedValue({
        id: AGENT_ID,
        identity: {
          escrowChainId: "eip155:11142220",
          escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
          escrowPaymentId: "1",
        },
        policy: { funderAddress: FUNDER_ACCOUNT.address },
      }),
      consumeAuthorizationNonce: vi.fn().mockResolvedValue(true),
    });
    serviceMock.runResolutionAgentIteration.mockResolvedValue({
      result: {
        workerIterationId: "iter_1",
        agentId: AGENT_ID,
        outcome: "no_work",
        actionDispatched: null,
      },
      agent: { id: AGENT_ID },
    });
  });

  it("decodes the encoded header and reaches the service with the authenticated caller", async () => {
    const message = buildRunAgentMessage({
      agentId: AGENT_ID,
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      signerAddress: FUNDER_ACCOUNT.address,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${AGENT_ID}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": FUNDER_ACCOUNT.address,
          "x-wallet-message": encodeWalletAuthMessage(message),
          "x-wallet-signature": signature,
        },
      },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId: AGENT_ID }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.outcome).toBe("no_work");
    expect(body.agent.id).toBe(AGENT_ID);

    expect(serviceMock.runResolutionAgentIteration).toHaveBeenCalledTimes(1);
    const call = serviceMock.runResolutionAgentIteration.mock.calls[0][0];
    expect(call.agentId).toBe(AGENT_ID);
    expect(call.authenticatedCaller.toLowerCase()).toBe(
      FUNDER_ACCOUNT.address.toLowerCase(),
    );
  });

  it("rejects missing wallet headers with 401 before reaching the service", async () => {
    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${AGENT_ID}/run`,
      { method: "POST" },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId: AGENT_ID }) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MISSING_WALLET_HEADERS");
    expect(serviceMock.runResolutionAgentIteration).not.toHaveBeenCalled();
  });

  it("rejects a signature over a different action with 400 MESSAGE_ACTION_MISMATCH", async () => {
    // Valid signature, but the message authorizes PAUSING, not running.
    const message = buildPauseMessage({
      agentId: AGENT_ID,
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      signerAddress: FUNDER_ACCOUNT.address,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${AGENT_ID}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": FUNDER_ACCOUNT.address,
          "x-wallet-message": encodeWalletAuthMessage(message),
          "x-wallet-signature": signature,
        },
      },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId: AGENT_ID }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("MESSAGE_ACTION_MISMATCH");
    expect(serviceMock.runResolutionAgentIteration).not.toHaveBeenCalled();
  });

  it("rejects a tampered encoded message with 401 before reaching the service", async () => {
    const message = buildRunAgentMessage({
      agentId: AGENT_ID,
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      signerAddress: FUNDER_ACCOUNT.address,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    // Attacker alters the transported (encoded) message.
    const tampered = encodeWalletAuthMessage(message + "x");
    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${AGENT_ID}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": FUNDER_ACCOUNT.address,
          "x-wallet-message": tampered,
          "x-wallet-signature": signature,
        },
      },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId: AGENT_ID }) });

    expect(response.status).toBe(401);
    expect(serviceMock.runResolutionAgentIteration).not.toHaveBeenCalled();
  });
});
