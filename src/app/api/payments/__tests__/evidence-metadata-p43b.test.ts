// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.3b POST /api/payments/[paymentId]/evidence/metadata — hardening.
//
//   - Conflicting query-vs-body chains are rejected with CONFLICTING_CHAIN
//     (no chain read, no write) — metadata is never tied to an ambiguous
//     canonical payment+chain.
//   - Non-numeric payment ids are rejected with INVALID_PAYMENT_ID.
//   - Hash-match and review-lock rules are never weakened (400 / 409).
//   - Sepolia default is unchanged.
//   - There is NO plaintext read endpoint on this route (D3: anonymous stays
//     hash-only) — the module exports POST only.
// Mocks chain reads following existing test patterns — NO real RPC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { resolve } from "path";

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

import * as metadataRoute from "../[paymentId]/evidence/metadata/route";

const { POST } = metadataRoute;

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

describe("P4.3b evidence metadata hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistMock.persistVerifiedEvidenceMetadata.mockResolvedValue({
      status: "persisted",
      evidenceReference: "0xabc",
      rowId: "row-1",
    });
  });

  it("rejects conflicting query-vs-body chains without touching the chain", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata?chainId=42220", {
        ...BODY,
        chainId: 11142220,
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CONFLICTING_CHAIN");
    expect(persistMock.persistVerifiedEvidenceMetadata).not.toHaveBeenCalled();
  });

  it("accepts matching query+body chains (no false conflict)", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata?chainId=42220", {
        ...BODY,
        escrowChainId: "42220",
      }),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(201);
    const args = persistMock.persistVerifiedEvidenceMetadata.mock.calls[0][0];
    expect(args.escrowChainId).toBe("42220");
  });

  it("rejects non-numeric payment ids without touching the chain", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/abc/evidence/metadata", BODY),
      { params: Promise.resolve({ paymentId: "abc" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PAYMENT_ID");
    expect(persistMock.persistVerifiedEvidenceMetadata).not.toHaveBeenCalled();
  });

  it("Sepolia default is unchanged (no chain given)", async () => {
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(201);
    const args = persistMock.persistVerifiedEvidenceMetadata.mock.calls[0][0];
    expect(args.escrowChainId).toBe("11142220");
  });

  it("hash mismatch is still rejected without any write (rule never weakened)", async () => {
    persistMock.persistVerifiedEvidenceMetadata.mockResolvedValue({
      status: "hash_mismatch",
      evidenceReference: "0xonchain",
      rowId: null,
      detail: "0xcomputed",
    });
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("HASH_MISMATCH");
  });

  it("review lock is still respected (409, rule never weakened)", async () => {
    persistMock.persistVerifiedEvidenceMetadata.mockResolvedValue({
      status: "review_locked",
      evidenceReference: "0xonchain",
      rowId: null,
      detail: "Reviewer review has begun; evidence metadata is immutable.",
    });
    const res = await POST(
      postRequest("http://localhost/api/payments/7/evidence/metadata", BODY),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EVIDENCE_REVIEW_LOCKED");
  });

  it("exposes no plaintext read endpoint (D3: anonymous stays hash-only)", async () => {
    // Anonymous callers must not obtain plaintext via this route: the POST
    // verifies by hash, and the P6.4E GET oracle returns hash + boolean
    // only — never titles, descriptions, pasted text, or manifests.
    expect(typeof POST).toBe("function");
    const { GET } = metadataRoute as Record<string, unknown>;
    expect(typeof GET).toBe("function");
    const routeSrc = readFileSync(
      resolve(__dirname, "..", "[paymentId]", "evidence", "metadata", "route.ts"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    const getBlock = routeSrc.slice(routeSrc.indexOf("export async function GET"));
    expect(getBlock).toContain("evidenceReference");
    expect(getBlock).toContain("found");
    for (const plaintext of [
      "pastedText",
      "description",
      "manifest",
      "externalRef",
      "relatedClaim",
    ]) {
      expect(getBlock).not.toContain(plaintext);
    }
  });
});
