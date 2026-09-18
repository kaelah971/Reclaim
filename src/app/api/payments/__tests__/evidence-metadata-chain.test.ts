// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.1b POST /api/payments/[paymentId]/evidence/metadata — chain awareness.
//
// - No chainId defaults to Sepolia (behavior unchanged).
// - chainId=42220 verifies against the canonical Mainnet escrow.
// - Unsupported chains are rejected with UNSUPPORTED_CHAIN (no chain read).
// Mocks chain reads following existing test patterns — NO real RPC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const persistMock = vi.hoisted(() => ({
  persistVerifiedEvidenceMetadata: vi.fn(),
}));

vi.mock("@/lib/evidence/persistEvidenceMetadata", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    persistVerifiedEvidenceMetadata: persistMock.persistVerifiedEvidenceMetadata,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({ from: vi.fn() }),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = (await importOriginal<typeof import("viem")>()) as Record<string, unknown>;
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({})),
    http: vi.fn(() => ({})),
  };
});

import { POST } from "../[paymentId]/evidence/metadata/route";

const SEPOLIA_ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";

const BODY = {
  title: "Delivery",
  description: "Delivered work",
  type: "delivery-file",
  relatedClaim: "Claim",
  date: "2026-09-01",
  externalRef: "",
  pastedText: "Text",
  fileHash: "",
};

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST evidence metadata chain awareness (P4.1b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistMock.persistVerifiedEvidenceMetadata.mockResolvedValue({
      status: "persisted",
      evidenceReference: "0xabc",
      rowId: "row-1",
    });
  });

  it("defaults to Sepolia when no chainId is given (behavior unchanged)", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(201);
    expect(persistMock.persistVerifiedEvidenceMetadata).toHaveBeenCalledOnce();
    const args = persistMock.persistVerifiedEvidenceMetadata.mock.calls[0][0];
    expect(args.escrowChainId).toBe("11142220");
    expect(String(args.escrowAddress).toLowerCase()).toBe(SEPOLIA_ESCROW.toLowerCase());
    expect(args.paymentId).toBe("7");
  });

  it("verifies against the Mainnet escrow when chainId=42220 (query)", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata?chainId=42220", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(201);
    const args = persistMock.persistVerifiedEvidenceMetadata.mock.calls[0][0];
    expect(args.escrowChainId).toBe("42220");
    expect(String(args.escrowAddress).toLowerCase()).toBe(MAINNET_ESCROW.toLowerCase());
  });

  it("accepts chainId from the body (explicit chain param)", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata", {
        ...BODY,
        chainId: 42220,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(201);
    const args = persistMock.persistVerifiedEvidenceMetadata.mock.calls[0][0];
    expect(args.escrowChainId).toBe("42220");
  });

  it("rejects unsupported chains without touching the chain", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata?chainId=1", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
    expect(persistMock.persistVerifiedEvidenceMetadata).not.toHaveBeenCalled();
  });

  it("rejects malformed chain values", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata?chainId=abc", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
  });
});
