// ---------------------------------------------------------------------------
// P4.3D partyAuth unit tests (mocks only, no real RPC/chain).
//
// Covers pure message discipline + verify logic with injected fakes:
// client/worker allowed, unrelated denied, malformed/wrong signer denied,
// wrong payment/chain denied, expired/consumed denied, cross-payment reuse
// denied, Sepolia+Mainnet canonical validation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  EVIDENCE_AUTH_DOMAIN,
  EVIDENCE_READ_PURPOSE,
  buildEvidenceReadMessage,
  parseEvidenceReadMessage,
  generateEvidenceChallengeId,
  hashEvidenceChallenge,
  isValidEvidenceChallengeId,
  verifyEvidenceChallenge,
  consumeEvidenceChallenge,
} from "@/lib/evidence/partyAuth";

const SEPOLIA_ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const STRANGER = "0x000000000000000000000000000000000000dEaD";

function futureIso(): string {
  return new Date(Date.now() + 4 * 60 * 1000).toISOString();
}

function makeRow(overrides: Record<string, unknown> = {}) {
  const challengeId = generateEvidenceChallengeId();
  return {
    challengeId,
    row: {
      id: "00000000-0000-4000-8000-000000000000",
      escrow_payment_id: "7",
      escrow_chain_id: 11142220,
      escrow_contract_address: SEPOLIA_ESCROW.toLowerCase(),
      wallet_address: CLIENT.toLowerCase(),
      challenge_hash: hashEvidenceChallenge(challengeId).toLowerCase(),
      purpose: EVIDENCE_READ_PURPOSE,
      expires_at: futureIso(),
      consumed_at: null,
      created_at: new Date().toISOString(),
      ...overrides,
    },
  };
}

function supabaseWithRow(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  };
}

function escrowWith(client: string, worker: string, exists = true) {
  return {
    getCaseParties: async () => ({ client, worker, exists }),
  };
}

describe("evidence challenge message discipline", () => {
  it("builds an exact-ordered human-readable message binding all fields", () => {
    const msg = buildEvidenceReadMessage({
      paymentId: "7",
      chainId: 11142220,
      escrowContract: SEPOLIA_ESCROW,
      wallet: CLIENT,
      challengeId: "0x" + "ab".repeat(32),
      expiresAt: "2026-09-18T00:00:00.000Z",
    });
    const lines = msg.split("\n");
    expect(lines[0]).toBe(EVIDENCE_AUTH_DOMAIN);
    expect(lines).toEqual([
      EVIDENCE_AUTH_DOMAIN,
      "Purpose: evidence-read",
      "Payment ID: 7",
      "Chain ID: 11142220",
      `Escrow Contract: ${SEPOLIA_ESCROW.toLowerCase()}`,
      `Wallet: ${CLIENT.toLowerCase()}`,
      `Challenge ID: 0x${"ab".repeat(32)}`,
      "Expires At: 2026-09-18T00:00:00.000Z",
    ]);
  });

  it("round-trips through the strict parser and lowercases addresses", () => {
    const msg = buildEvidenceReadMessage({
      paymentId: "7",
      chainId: 42220,
      escrowContract: MAINNET_ESCROW,
      wallet: CLIENT.toUpperCase(),
      challengeId: "0x" + "cd".repeat(32),
      expiresAt: futureIso(),
    });
    const parsed = parseEvidenceReadMessage(msg);
    expect(parsed.purpose).toBe("evidence-read");
    expect(parsed.paymentId).toBe("7");
    expect(parsed.chainId).toBe("42220");
    expect(parsed.escrowContract).toBe(MAINNET_ESCROW.toLowerCase());
    expect(parsed.wallet).toBe(CLIENT.toLowerCase());
  });

  it("rejects CR bytes and reordered fields", () => {
    const msg = buildEvidenceReadMessage({
      paymentId: "7",
      chainId: 11142220,
      escrowContract: SEPOLIA_ESCROW,
      wallet: CLIENT,
      challengeId: "0x" + "ab".repeat(32),
      expiresAt: futureIso(),
    });
    expect(() => parseEvidenceReadMessage(msg.replace(/\n/g, "\r\n"))).toThrow();
    const reordered = msg.split("\n");
    const swapped = [reordered[0], reordered[2], reordered[1], ...reordered.slice(3)].join("\n");
    expect(() => parseEvidenceReadMessage(swapped)).toThrow();
  });
});

describe("challengeId generation + hashing", () => {
  it("generates unique 256-bit ids and deterministic 0x sha256 hashes", () => {
    const a = generateEvidenceChallengeId();
    const b = generateEvidenceChallengeId();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(b).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(isValidEvidenceChallengeId(a)).toBe(true);
    expect(isValidEvidenceChallengeId("not-a-challenge")).toBe(false);
    expect(hashEvidenceChallenge(a)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashEvidenceChallenge(a)).toBe(hashEvidenceChallenge(a));
    expect(hashEvidenceChallenge(a)).not.toBe(hashEvidenceChallenge(b));
    // Raw secret is never equal to its hash.
    expect(hashEvidenceChallenge(a)).not.toBe(a);
  });
});

describe("verifyEvidenceChallenge (injected fakes)", () => {
  it("allows the on-chain client (Sepolia canonical)", async () => {
    const { challengeId, row } = makeRow();
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0xdeadbeef",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(true);
  });

  it("allows the on-chain worker (Mainnet canonical)", async () => {
    const challengeId = generateEvidenceChallengeId();
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      escrow_payment_id: "9",
      escrow_chain_id: 42220,
      escrow_contract_address: MAINNET_ESCROW.toLowerCase(),
      wallet_address: WORKER.toLowerCase(),
      challenge_hash: hashEvidenceChallenge(challengeId).toLowerCase(),
      purpose: EVIDENCE_READ_PURPOSE,
      expires_at: futureIso(),
      consumed_at: null,
      created_at: new Date().toISOString(),
    };
    const res = await verifyEvidenceChallenge({
      paymentId: "9",
      chainId: 42220,
      wallet: WORKER,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => WORKER,
    });
    expect(res.ok).toBe(true);
  });

  it("denies an unrelated wallet (not client/worker) with NOT_PARTY", async () => {
    const { challengeId, row } = makeRow({
      wallet_address: STRANGER.toLowerCase(),
    });
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: STRANGER,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => STRANGER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_PARTY");
  });

  it("denies a malformed signature", async () => {
    const { challengeId } = makeRow();
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0x",
      supabase: supabaseWithRow(null),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("SIGNATURE_INVALID");
  });

  it("denies a wrong signer (recovered != challenged wallet)", async () => {
    const { challengeId, row } = makeRow();
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => STRANGER,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("SIGNER_MISMATCH");
  });

  it("denies a wrong payment (challenge bound to another payment)", async () => {
    const { challengeId, row } = makeRow({ escrow_payment_id: "8" });
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CHALLENGE_PAYMENT_MISMATCH");
  });

  it("denies a wrong chain (challenge not reusable across chains)", async () => {
    const challengeId = generateEvidenceChallengeId();
    const row = {
      id: "x",
      escrow_payment_id: "7",
      escrow_chain_id: 11142220,
      escrow_contract_address: SEPOLIA_ESCROW.toLowerCase(),
      wallet_address: CLIENT.toLowerCase(),
      challenge_hash: hashEvidenceChallenge(challengeId).toLowerCase(),
      purpose: EVIDENCE_READ_PURPOSE,
      expires_at: futureIso(),
      consumed_at: null,
      created_at: new Date().toISOString(),
    };
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 42220,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CHALLENGE_CHAIN_MISMATCH");
  });

  it("denies unsupported chains", async () => {
    const { challengeId } = makeRow();
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 1,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(null),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("denies expired challenges", async () => {
    const { challengeId, row } = makeRow({
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CHALLENGE_EXPIRED");
  });

  it("denies already-consumed challenges (no replay)", async () => {
    const { challengeId, row } = makeRow({
      consumed_at: new Date().toISOString(),
    });
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId,
      signature: "0xsig",
      supabase: supabaseWithRow(row),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CHALLENGE_CONSUMED");
  });

  it("denies unknown challenges", async () => {
    const res = await verifyEvidenceChallenge({
      paymentId: "7",
      chainId: 11142220,
      wallet: CLIENT,
      challengeId: generateEvidenceChallengeId(),
      signature: "0xsig",
      supabase: supabaseWithRow(null),
      escrowReader: escrowWith(CLIENT, WORKER),
      signatureVerifier: async () => CLIENT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CHALLENGE_NOT_FOUND");
  });
});

describe("consumeEvidenceChallenge atomicity", () => {
  function consumeSupabase(data: unknown) {
    return {
      from: () => ({
        update: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
  }
  it("returns true when the UPDATE wins the race", async () => {
    const ok = await consumeEvidenceChallenge({
      challengeHash: "0x" + "aa".repeat(32),
      supabase: consumeSupabase({ id: "row-1" }),
    });
    expect(ok).toBe(true);
  });
  it("returns false when the row was already consumed (replay)", async () => {
    const ok = await consumeEvidenceChallenge({
      challengeHash: "0x" + "aa".repeat(32),
      supabase: consumeSupabase(null),
    });
    expect(ok).toBe(false);
  });
});
