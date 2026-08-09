// @vitest-environment node
// ---------------------------------------------------------------------------
// Renew route integration — encoded wallet-auth transport reaches the route
// (RA1R.7G case 8)
//
// A real funder signature over the canonical multiline message, transported
// via encodeWalletAuthMessage in x-wallet-message, must decode server-side
// and reach renewResolutionAgentPolicy with the EXACT signed message.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signMessage, privateKeyToAccount } from "viem/accounts";
import { buildRenewPolicyMessage } from "@/lib/resolution-agent/api/auth";
import { encodeWalletAuthMessage } from "@/lib/x402/walletAuth";

const FUNDER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FUNDER_ACCOUNT = privateKeyToAccount(FUNDER_KEY);

// Mock ONLY the service layer of the renew route — wallet-auth helpers and
// signature verification stay REAL.
const serviceMock = vi.hoisted(() => ({
  createStore: vi.fn(),
  renewResolutionAgentPolicy: vi.fn(),
}));

vi.mock("@/lib/resolution-agent/api/service", () => ({
  createStore: serviceMock.createStore,
  renewResolutionAgentPolicy: serviceMock.renewResolutionAgentPolicy,
}));

import { POST } from "@/app/api/resolution-agents/[agentId]/renew/route";

describe("POST /api/resolution-agents/[agentId]/renew — encoded transport", () => {
  beforeEach(() => {
    serviceMock.createStore.mockReset();
    serviceMock.renewResolutionAgentPolicy.mockReset();
    serviceMock.createStore.mockReturnValue({});
    serviceMock.renewResolutionAgentPolicy.mockResolvedValue({
      id: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
      status: "active",
      expiresAt: 1786248000000,
    });
  });

  it("decodes the encoded header and reaches the renewal service", async () => {
    const agentId = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";
    const newExpiresAt = 1786248000000;
    const message = buildRenewPolicyMessage({
      agentId,
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      oldExpiresAtMs: 1786161440000,
      newExpiresAtMs: newExpiresAt,
      funderAddress: FUNDER_ACCOUNT.address,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${agentId}/renew`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": FUNDER_ACCOUNT.address,
          "x-wallet-message": encodeWalletAuthMessage(message),
          "x-wallet-signature": signature,
        },
        body: JSON.stringify({ expiresAt: String(newExpiresAt) }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId }) });

    expect(response.status).toBe(200);
    expect(serviceMock.renewResolutionAgentPolicy).toHaveBeenCalledTimes(1);
    const call = serviceMock.renewResolutionAgentPolicy.mock.calls[0][0];
    expect(call.agentId).toBe(agentId);
    expect(call.authenticatedCaller.toLowerCase()).toBe(
      FUNDER_ACCOUNT.address.toLowerCase(),
    );
    expect(call.newExpiresAt).toBe(newExpiresAt);
  });

  it("rejects a tampered encoded message before reaching the service", async () => {
    const agentId = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";
    const newExpiresAt = 1786248000000;
    const message = buildRenewPolicyMessage({
      agentId,
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      oldExpiresAtMs: 1786161440000,
      newExpiresAtMs: newExpiresAt,
      funderAddress: FUNDER_ACCOUNT.address,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    // Attacker alters the transported (encoded) message.
    const tampered = encodeWalletAuthMessage(message + "x");
    const request = new NextRequest(
      `http://localhost/api/resolution-agents/${agentId}/renew`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": FUNDER_ACCOUNT.address,
          "x-wallet-message": tampered,
          "x-wallet-signature": signature,
        },
        body: JSON.stringify({ expiresAt: String(newExpiresAt) }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ agentId }) });

    expect(response.status).toBe(401);
    expect(serviceMock.renewResolutionAgentPolicy).not.toHaveBeenCalled();
  });
});
