// ---------------------------------------------------------------------------
// renewResolutionAgentPolicy — explicit policy renewal tests
//
// Renewal is the ONLY way to extend an existing agent's policy expiry:
//   - funder-signed, explicit (never auto-renewed)
//   - strict extension only (new expiry must be later than current AND
//     in the future)
//   - everything else preserved: agent id, case wallet, budget, spent/
//     reserved accounting, allowed tools, observation, plan
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { signMessage, privateKeyToAccount } from "viem/accounts";
import type { ResolutionAgent } from "../../types";
import type { ResolutionAgentStore } from "../service";
import { renewResolutionAgentPolicy } from "../service";
import { buildRenewPolicyMessage, verifyAuth } from "../auth";

function makeAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
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
      expiresAt: 1786161440000, // 2026-08-08T03:57:20Z
      funderAddress: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
    },
    budget: { approvedAtomic: 40000n, spentAtomic: 0n, reservedAtomic: 0n },
    plan: null,
    observation: {
      escrowState: "delivered",
      evidenceCount: 1,
      evidenceVersionHash: "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
      caseVersionHash: "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: Date.now(),
    },
    caseWalletAddress: "0x22bf4271a3f8f3c6885c0d2c825f06f9c9d7f72a",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "cipher",
      iv: "iv_iv_iv_iv_iv",
      authenticationTag: "tag_tag_tag_tag_tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: Date.now() - 100000,
    updatedAt: Date.now() - 1000,
    activatedAt: Date.now() - 5000,
    pausedAt: null,
    closedAt: null,
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
    ...overrides,
  };
}

function makeStore(agent: ResolutionAgent) {
  const updateAgent = vi.fn(async (updated: ResolutionAgent) => updated);
  const appendEvent = vi.fn(async () => undefined);
  const store = {
    getAgentById: vi.fn(async () => agent),
    getAgentVersion: vi.fn(async () => 1),
    updateAgent,
    appendEvent,
  } as unknown as ResolutionAgentStore;
  return { store, updateAgent, appendEvent };
}

const FUNDER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const NOW = 1786245000000; // 2026-08-09T03:10:00Z (after the live expiry)
const NEW_EXPIRY = NOW + 7 * 86400000; // +7 days

describe("renewResolutionAgentPolicy", () => {
  it("renews an expired active agent, preserving every other binding", async () => {
    const agent = makeAgent();
    const { store, updateAgent, appendEvent } = makeStore(agent);

    const view = await renewResolutionAgentPolicy({
      agentId: agent.id,
      authenticatedCaller: FUNDER,
      newExpiresAt: NEW_EXPIRY,
      now: NOW,
      store,
    });

    expect(view.expiresAt).toBe(NEW_EXPIRY);
    expect(updateAgent).toHaveBeenCalledTimes(1);
    const updated = updateAgent.mock.calls[0][0] as ResolutionAgent;
    // Preserved:
    expect(updated.id).toBe(agent.id);
    expect(updated.caseWalletAddress).toBe(agent.caseWalletAddress);
    expect(updated.policy.approvedBudgetAtomic).toBe(40000n);
    expect(updated.budget).toEqual(agent.budget); // spent 0, reserved 0 untouched
    expect(updated.policy.allowedTools).toEqual(agent.policy.allowedTools);
    expect(updated.identity).toEqual(agent.identity);
    expect(updated.observation).toEqual(agent.observation);
    expect(updated.plan).toBeNull();
    expect(updated.encryptedSecret).toEqual(agent.encryptedSecret);
    // Event appended
    expect(appendEvent).toHaveBeenCalledWith(
      agent.id,
      "policy_renewed",
      expect.stringContaining("1786161440000"),
      agent.status,
      agent.status,
      expect.objectContaining({ newExpiresAtMs: NEW_EXPIRY }),
    );
  });

  it("rejects a caller who is not the funder", async () => {
    const agent = makeAgent();
    const { store } = makeStore(agent);

    await expect(
      renewResolutionAgentPolicy({
        agentId: agent.id,
        authenticatedCaller: "0x1111111111111111111111111111111111111111",
        newExpiresAt: NEW_EXPIRY,
        now: NOW,
        store,
      }),
    ).rejects.toThrow("only the agent's funder");
  });

  it("rejects an expiry that does not strictly extend the current policy", async () => {
    // Current expiry is in the FUTURE; a new expiry equal to it passes the
    // future check but must fail the strict-extension check.
    const currentExpiry = NOW + 86400000;
    const agent = makeAgent({ policy: { ...makeAgent().policy, expiresAt: currentExpiry } });
    const { store } = makeStore(agent);

    await expect(
      renewResolutionAgentPolicy({
        agentId: agent.id,
        authenticatedCaller: FUNDER,
        newExpiresAt: currentExpiry, // same value — not an extension
        now: NOW,
        store,
      }),
    ).rejects.toThrow("strictly later");
  });

  it("rejects an expiry in the past", async () => {
    const agent = makeAgent();
    const { store } = makeStore(agent);

    await expect(
      renewResolutionAgentPolicy({
        agentId: agent.id,
        authenticatedCaller: FUNDER,
        newExpiresAt: NOW - 1000,
        now: NOW,
        store,
      }),
    ).rejects.toThrow("future");
  });

  it("rejects renewal for terminal/non-renewable statuses (closed)", async () => {
    const agent = makeAgent({ status: "closed" as const });
    const { store } = makeStore(agent);

    await expect(
      renewResolutionAgentPolicy({
        agentId: agent.id,
        authenticatedCaller: FUNDER,
        newExpiresAt: NEW_EXPIRY,
        now: NOW,
        store,
      }),
    ).rejects.toThrow('Policy cannot be renewed from status "closed"');
  });

  it("rejects renewal for a pre-activation draft", async () => {
    const agent = makeAgent({ status: "draft" as const });
    const { store } = makeStore(agent);

    await expect(
      renewResolutionAgentPolicy({
        agentId: agent.id,
        authenticatedCaller: FUNDER,
        newExpiresAt: NEW_EXPIRY,
        now: NOW,
        store,
      }),
    ).rejects.toThrow('Policy cannot be renewed from status "draft"');
  });
});

// ---------------------------------------------------------------------------
// RA1R.7F — header-safe transport + signature round-trip
//
// The wallet-auth message travels in the x-wallet-message HTTP header, so
// it must be pure ASCII (browser fetch rejects non-ISO-8859-1 header
// values). The canonical builder is ASCII-only; the server verifies the
// header message EXACTLY as signed (no re-encoding, no character
// alteration on either side).
// ---------------------------------------------------------------------------

describe("renewal message transport + verification (RA1R.7F)", () => {
  const FUNDER_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const FUNDER_ACCOUNT = privateKeyToAccount(FUNDER_KEY);

  function buildMessage(): string {
    return buildRenewPolicyMessage({
      agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
      escrowChainId: "eip155:11142220",
      escrowPaymentId: "1",
      oldExpiresAtMs: 1786161440000,
      newExpiresAtMs: 1786161440000 + 86400000,
      funderAddress: FUNDER_ACCOUNT.address,
    });
  }

  it("canonical message is ASCII-only but MULTILINE — raw header transport is illegal", () => {
    const message = buildMessage();
    expect(message.startsWith("Reclaim - Renew Resolution Agent Policy")).toBe(true);
    // ASCII-only (no smart punctuation)…
    expect(message).not.toMatch(/[\u2014\u2013\u201C\u201D]/);
    expect(message).toContain("renew_resolution_agent_policy");
    expect(message).toContain("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    // …but it contains line breaks, so it must NEVER be transported raw in
    // an HTTP header (browser fetch rejects CR/LF with "Invalid value").
    expect(message).toMatch(/\n/);
    expect(() => new Headers({ "x-wallet-message": message })).toThrow(TypeError);
  });

  it("server verifies the exact signed message (valid signature succeeds)", async () => {
    const message = buildMessage();
    const signature = await signMessage({
      privateKey: FUNDER_KEY,
      message,
    });

    const authResult = await verifyAuth({
      claimedAddress: FUNDER_ACCOUNT.address,
      message,
      signature,
    });

    expect(authResult.verified).toBe(true);
  });

  it("tampered message fails verification (exact-string binding)", async () => {
    const message = buildMessage();
    const signature = await signMessage({
      privateKey: FUNDER_KEY,
      message,
    });

    // A single altered character anywhere in the transported message must
    // break the signature — proving server and client reconstruct the same
    // canonical string.
    const tampered = message.replace("+24h", "+24h ").trim() + "x";
    const authResult = await verifyAuth({
      claimedAddress: FUNDER_ACCOUNT.address,
      message: tampered,
      signature,
    });

    expect(authResult.verified).toBe(false);
  });

  it("wrong funder signature fails verification", async () => {
    const message = buildMessage();
    const WRONG_KEY =
      "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
    const signature = await signMessage({
      privateKey: WRONG_KEY,
      message,
    });

    const authResult = await verifyAuth({
      claimedAddress: FUNDER_ACCOUNT.address,
      message,
      signature,
    });

    expect(authResult.verified).toBe(false);
  });
});
