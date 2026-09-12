// @vitest-environment node
// ---------------------------------------------------------------------------
// P2C structured wallet authorization — tests first.
//
// These tests deliberately exercise the authorization boundary, rather than
// the worker or settlement layers.  A valid signature is not sufficient: the
// signed fields must bind to the exact request and the nonce must be consumed
// exactly once.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { privateKeyToAccount, signMessage } from "viem/accounts";
import {
  authorizeWalletRequest,
  buildRunAgentMessage,
  EMPTY_BODY_HASH,
  hashCanonicalJson,
  parseStructuredAuthorizationMessage,
} from "../auth";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "../escrow-reader";

const FUNDER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const FUNDER = privateKeyToAccount(FUNDER_KEY as `0x${string}`).address;
const OTHER = privateKeyToAccount(OTHER_KEY as `0x${string}`).address;
const AGENT_ID = "agt_structured_auth_1";
const CHAIN = "eip155:11142220";
const PAYMENT_ID = "42";

function expected(bodyHash: string = EMPTY_BODY_HASH) {
  return {
    action: "run_resolution_agent" as const,
    agentId: AGENT_ID,
    escrowChainId: CHAIN,
    escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
    escrowPaymentId: PAYMENT_ID,
    bodyHash,
    signerAddress: FUNDER,
  };
}

function makeNonceStore() {
  const consumed = new Set<string>();
  return {
    consumed,
    async consumeAuthorizationNonce(input: { nonceHash: string }) {
      if (consumed.has(input.nonceHash)) return false;
      consumed.add(input.nonceHash);
      return true;
    },
  };
}

async function authorize(message: string, signature: string, bodyHash: string = EMPTY_BODY_HASH) {
  return authorizeWalletRequest({
    claimedAddress: FUNDER,
    message,
    signature,
    expected: expected(bodyHash),
    nonceStore: makeNonceStore(),
  });
}

function buildValidMessage(overrides: Partial<Parameters<typeof buildRunAgentMessage>[0]> = {}) {
  return buildRunAgentMessage({
    agentId: AGENT_ID,
    escrowChainId: CHAIN,
    escrowPaymentId: PAYMENT_ID,
    signerAddress: FUNDER,
    ...overrides,
  });
}

describe("P2C structured authorization boundary", () => {
  it("hashes canonical JSON deterministically regardless of object key order", () => {
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(hashCanonicalJson({ a: 1, b: 2 }));
    expect(hashCanonicalJson({ a: 1 })).not.toBe(hashCanonicalJson({ a: 2 }));
  });

  it("accepts an exact, signed, context-bound bodyless request", async () => {
    const message = buildValidMessage();
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature);

    expect(result.verified).toBe(true);
    if (result.verified) expect(result.authorization.action).toBe("run_resolution_agent");
  });

  it("rejects a tampered request body hash", async () => {
    const originalBodyHash = hashCanonicalJson({ budgetAtomic: "30000" });
    const message = buildValidMessage({ bodyHash: originalBodyHash });
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature, hashCanonicalJson({ budgetAtomic: "50000" }));

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toBe("MESSAGE_BODY_HASH_MISMATCH");
  });

  it.each([
    ["agentId", { agentId: "agt_other" }],
    ["payment", { escrowPaymentId: "43" }],
    ["chain", { escrowChainId: "eip155:42220" }],
  ])("rejects a tampered %s binding", async (_name, override) => {
    const message = buildValidMessage(override);
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature);

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toMatch(/^MESSAGE_/);
  });

  it("rejects a tampered contract binding", async () => {
    const message = buildValidMessage().replace(
      `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
      "Escrow Contract: 0x2222222222222222222222222222222222222222",
    );
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature);

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toBe("MESSAGE_CONTRACT_MISMATCH");
  });

  it("rejects an expired authorization", async () => {
    const now = Date.now();
    const message = buildValidMessage({
      issuedAt: now - 10_000,
      authorizationExpiresAt: now - 1,
    });
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature);

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toBe("AUTH_EXPIRED");
  });

  it("rejects a replayed nonce", async () => {
    const nonceStore = makeNonceStore();
    const message = buildValidMessage();
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const params = {
      claimedAddress: FUNDER,
      message,
      signature,
      expected: expected(),
      nonceStore,
    };

    expect((await authorizeWalletRequest(params)).verified).toBe(true);
    const replay = await authorizeWalletRequest(params);
    expect(replay.verified).toBe(false);
    expect((replay as { code: string }).code).toBe("AUTH_REPLAY");
  });

  it("rejects a signature whose recovered signer differs from the claimed address", async () => {
    const message = buildValidMessage({ signerAddress: FUNDER });
    const signature = await signMessage({ privateKey: OTHER_KEY as `0x${string}`, message });
    const result = await authorizeWalletRequest({
      claimedAddress: FUNDER,
      message,
      signature,
      expected: expected(),
      nonceStore: makeNonceStore(),
    });

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toBe("SIGNATURE_INVALID");
    expect(OTHER.toLowerCase()).not.toBe(FUNDER.toLowerCase());
  });

  it.each([
    "Reclaim Resolution Agent Authorization v2\nAction: run_resolution_agent",
    `${buildValidMessage()}\nAction: run_resolution_agent`,
    buildValidMessage().replace("Action: run_resolution_agent", "Action run_resolution_agent"),
  ])("rejects malformed or duplicate fields", async (message) => {
    expect(() => parseStructuredAuthorizationMessage(message)).toThrow();
  });

  it("requires the explicit empty-body hash for bodyless routes", async () => {
    const message = buildValidMessage({ bodyHash: hashCanonicalJson({ unexpected: true }) });
    const signature = await signMessage({ privateKey: FUNDER_KEY as `0x${string}`, message });
    const result = await authorize(message, signature);

    expect(result.verified).toBe(false);
    expect((result as { code: string }).code).toBe("MESSAGE_BODY_HASH_MISMATCH");
  });
});
