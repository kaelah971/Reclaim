// @vitest-environment node
// ---------------------------------------------------------------------------
// /api/payments/[paymentId]/evidence/plaintext — party auth matrix.
//
// Full-stack route test with mocked DB + mocked viem recovery + mocked
// on-chain escrow reader + mocked evidence reader. No real RPC/chain.
//
// Covers: anonymous denied; unrelated wallet denied; client allowed; worker
// allowed; malformed signature denied; wrong signer denied; wrong payment
// denied; wrong chain denied; expired denied; consumed cannot replay;
// challenge not reusable across payments; Sepolia+Mainnet canonical.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashEvidenceChallenge, generateEvidenceChallengeId } from "@/lib/evidence/partyAuth";

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  verifyRow: null as Record<string, unknown> | null,
  consumeResult: { id: "row-1" } as Record<string, unknown> | null,
  maybeSingleCalls: 0,
}));
const recoverMock = vi.hoisted(() => ({
  signer: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
  shouldThrow: false,
}));
const escrowMock = vi.hoisted(() => ({
  client: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
  worker: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  exists: true,
}));
const evidenceMock = vi.hoisted(() => ({
  getEvidenceMetadata: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => supabaseMock,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = (await importOriginal<typeof import("viem")>()) as Record<string, unknown>;
  return {
    ...actual,
    recoverMessageAddress: vi.fn(async () => {
      if (recoverMock.shouldThrow) throw new Error("bad signature");
      return recoverMock.signer;
    }),
  };
});

vi.mock("@/lib/resolution-agent/api/escrow-reader", () => ({
  CeloEscrowCaseReader: class {
    constructor(public chain: unknown) {}
    async getCaseParties() {
      return {
        client: escrowMock.client,
        worker: escrowMock.worker,
        exists: escrowMock.exists,
      };
    }
  },
  CeloSepoliaEscrowCaseReader: class {
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
    async getCaseParties() {
      return {
        client: escrowMock.client,
        worker: escrowMock.worker,
        exists: escrowMock.exists,
      };
    }
  },
}));

vi.mock("@/lib/evidence/reader", () => ({
  SupabaseEvidenceReader: class {
    getEvidenceMetadata = evidenceMock.getEvidenceMetadata;
  },
}));

import { POST, GET } from "../[paymentId]/evidence/plaintext/route";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const STRANGER = "0x000000000000000000000000000000000000dEaD";
const SEPOLIA_ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";

function futureIso(): string {
  return new Date(Date.now() + 4 * 60 * 1000).toISOString();
}

function installSupabaseMock() {
  supabaseMock.maybeSingleCalls = 0;
  supabaseMock.from.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    let usedUpdate = false;
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.gt = vi.fn(() => builder);
    builder.update = vi.fn(() => {
      usedUpdate = true;
      return builder;
    });
    builder.insert = vi.fn(async () => ({ error: null }));
    builder.maybeSingle = vi.fn(async () => {
      supabaseMock.maybeSingleCalls += 1;
      // Verify path selects by hash (no update); consume path updates.
      // Distinguish by query shape so early-deny tests (no consume call)
      // don't misalign subsequent lookups.
      if (usedUpdate) {
        return { data: supabaseMock.consumeResult, error: null };
      }
      return { data: supabaseMock.verifyRow, error: null };
    });
    return builder;
  });
}

function challengeRow(challengeId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    escrow_payment_id: "7",
    escrow_chain_id: 11142220,
    escrow_contract_address: SEPOLIA_ESCROW.toLowerCase(),
    wallet_address: CLIENT.toLowerCase(),
    challenge_hash: hashEvidenceChallenge(challengeId).toLowerCase(),
    purpose: "evidence-read",
    expires_at: futureIso(),
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function postPlaintext(paymentId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/payments/${paymentId}/evidence/plaintext`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST evidence plaintext — party auth matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSupabaseMock();
    recoverMock.signer = CLIENT;
    recoverMock.shouldThrow = false;
    escrowMock.client = CLIENT;
    escrowMock.worker = WORKER;
    escrowMock.exists = true;
    supabaseMock.verifyRow = null;
    supabaseMock.consumeResult = { id: "row-1" };
    evidenceMock.getEvidenceMetadata.mockResolvedValue({
      title: "Secret title",
      relatedClaim: "Secret claim",
      description: "Secret description",
      pastedText: "Secret pasted text",
      evidenceDate: "2026-09-01",
      externalRef: "https://private.example",
      evidenceType: "other",
      fileHash: "0xfile",
      fileCount: 1,
      evidenceReference: "0xabc",
      latestUpdateTimestamp: new Date("2026-09-18T00:00:00.000Z").getTime(),
      submitterAddress: "chain_verified",
      substantiveEvidence: true,
    });
  });

  it("denies anonymous callers (no challenge/signature)", async () => {
    const res = await POST(postPlaintext("7", { chainId: 11142220, wallet: CLIENT }), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("CHALLENGE_REQUIRED");
  });

  it("allows the on-chain client", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId);
    recoverMock.signer = CLIENT;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.evidence.pastedText).toBe("Secret pasted text");
    expect(body.evidence.claim).toBe("Secret claim");
    expect(body.evidence.evidenceReference).toBe("0xabc");
  });

  it("allows the on-chain worker", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, {
      wallet_address: WORKER.toLowerCase(),
    });
    recoverMock.signer = WORKER;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: WORKER }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.title).toBe("Secret title");
  });

  it("denies an unrelated wallet with NOT_PARTY", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, {
      wallet_address: STRANGER.toLowerCase(),
    });
    recoverMock.signer = STRANGER;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: STRANGER }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("NOT_PARTY");
  });

  it("denies a malformed signature", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId);
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0x", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("SIGNATURE_INVALID");
  });

  it("denies a wrong signer", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId);
    recoverMock.signer = STRANGER;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("SIGNER_MISMATCH");
  });

  it("denies a wrong payment (challenge bound to another payment)", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, { escrow_payment_id: "8" });
    recoverMock.signer = CLIENT;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CHALLENGE_PAYMENT_MISMATCH");
  });

  it("denies a wrong chain", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId);
    recoverMock.signer = CLIENT;
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 42220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CHALLENGE_CHAIN_MISMATCH");
  });

  it("denies expired challenges", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, {
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("CHALLENGE_EXPIRED");
  });

  it("denies consumed challenges and replays (second consume loses the race)", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, {
      consumed_at: new Date().toISOString(),
    });
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("CHALLENGE_CONSUMED");

    // Fresh challenge but the atomic consume returns no row → replay.
    const challengeId2 = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId2);
    supabaseMock.consumeResult = null;
    recoverMock.signer = CLIENT;
    const res2 = await POST(
      postPlaintext("7", { challengeId: challengeId2, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res2.status).toBe(401);
    expect((await res2.json()).code).toBe("CHALLENGE_CONSUMED");
  });

  it("denies Mainnet challenges presented on Sepolia (no cross-chain reuse)", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId, {
      escrow_chain_id: 42220,
      escrow_contract_address: MAINNET_ESCROW.toLowerCase(),
    });
    const res = await POST(
      postPlaintext("7", { challengeId, signature: "0xsig", chainId: 11142220, wallet: CLIENT }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CHALLENGE_CHAIN_MISMATCH");
  });

  it("supports the GET alias with the same contract", async () => {
    const challengeId = generateEvidenceChallengeId();
    supabaseMock.verifyRow = challengeRow(challengeId);
    recoverMock.signer = CLIENT;
    const req = new NextRequest(
      `http://localhost/api/payments/7/evidence/plaintext?challengeId=${challengeId}&signature=0xsig&chainId=11142220&wallet=${CLIENT}`,
    );
    const res = await GET(req, { params: Promise.resolve({ paymentId: "7" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.pastedText).toBe("Secret pasted text");
  });
});
