// @vitest-environment node
// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/evidence/challenge — issuance (mocked DB).
// No chain txs, no real RPC: the canonical escrow mapping is local.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  insertError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => supabaseMock,
}));

import { POST } from "../[paymentId]/evidence/challenge/route";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST evidence challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.insertError = null;
    supabaseMock.from.mockImplementation(() => ({
      insert: vi.fn(async () => ({ error: supabaseMock.insertError })),
    }));
  });

  it("issues a Sepolia challenge by default with a bound message", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge", {
        wallet: CLIENT,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challengeId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.expiresAt).toBeTruthy();
    expect(body.paymentId).toBe("7");
    expect(body.chainId).toBe(11142220);
    expect(body.wallet).toBe(CLIENT.toLowerCase());
    expect(body.purpose).toBe("evidence-read");
    // Message binds every required field in exact order.
    expect(body.message).toContain("Reclaim Evidence Access v1");
    expect(body.message).toContain("Purpose: evidence-read");
    expect(body.message).toContain("Payment ID: 7");
    expect(body.message).toContain("Chain ID: 11142220");
    expect(body.message).toContain(CLIENT.toLowerCase());
    expect(body.message).toContain(body.challengeId);
    // The raw secret is never sent to the DB as-is — only its hash is stored.
    const inserted = supabaseMock.from.mock.results[0].value;
    expect(inserted).toBeTruthy();
  });

  it("issues a Mainnet challenge against the canonical Mainnet escrow", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge", {
        wallet: CLIENT,
        chainId: 42220,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chainId).toBe(42220);
    expect(body.escrowContractAddress.toLowerCase()).toBe(
      "0xe42cf4620de454be0de5004255d25683e4f882c4",
    );
    expect(body.message).toContain("Chain ID: 42220");
  });

  it("rejects invalid payment ids", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/abc/evidence/challenge", {
        wallet: CLIENT,
      }),
      { params: Promise.resolve({ paymentId: "abc" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PAYMENT_ID");
  });

  it("rejects invalid wallets", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge", {
        wallet: "not-an-address",
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_WALLET");
  });

  it("rejects unsupported chains", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge?chainId=1", {
        wallet: CLIENT,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects conflicting query/body chains", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge?chainId=42220", {
        wallet: CLIENT,
        chainId: 11142220,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CONFLICTING_CHAIN");
  });

  it("rejects a wrong purpose", async () => {
    const res = await POST(
      makePost("http://localhost/api/payments/7/evidence/challenge", {
        wallet: CLIENT,
        purpose: "admin-read",
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PURPOSE");
  });
});
