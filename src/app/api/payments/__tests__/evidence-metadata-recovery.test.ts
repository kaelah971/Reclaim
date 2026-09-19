// @vitest-environment node
// ---------------------------------------------------------------------------
// P6.4E POST+GET /api/payments/[paymentId]/evidence/metadata — recovery.
//
//   (a) Exact Payment #3-shaped body (all-string fields, type "message",
//       chainId 42220 + escrowChainId "42220") with a matching chain read
//       → 201 persisted (proves no VALIDATION_ERROR for this shape).
//   (b) Same body with a STALE chain read (zero-hash, pre-submission value)
//       → 400 HASH_MISMATCH (reproduces the production Payment #3 failure).
//   (c) Mismatched manifest (wrong worker / public user without the manifest)
//       → 400 HASH_MISMATCH (manifest-knowledge auth preserved).
//   (d) Duplicate POST → 200 alreadyExisted (idempotent).
//   (e) Wrong chain (1) → 400 UNSUPPORTED_CHAIN with no write.
//   (f) GET oracle: found:true / found:false, invalid id 400, unsupported
//       chain 400, chain-read failure 500. GET returns hash + boolean only.
//
// Mocks the chain reader (viem createPublicClient) + Supabase store — the
// REAL persistVerifiedEvidenceMetadata runs. No real RPC, no real DB.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { keccak256, stringToHex } from "viem";
import { buildEvidenceManifest } from "@/lib/evidence/manifest";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const oracleMock = vi.hoisted(() => ({
  onChainRef:
    "0x0000000000000000000000000000000000000000000000000000000000000000" as string,
  shouldThrow: false,
  readCalls: 0,
  rows: [] as Array<{
    paymentId: string;
    chainId: string;
    address: string;
    ref: string;
  }>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = (await importOriginal<typeof import("viem")>()) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(async () => {
        oracleMock.readCalls += 1;
        if (oracleMock.shouldThrow) throw new Error("PaymentNotFound");
        return { evidenceReference: oracleMock.onChainRef };
      }),
    })),
    http: vi.fn(() => ({})),
  };
});

interface EqFilter {
  key: string;
  value: unknown;
}

function makeQuery(table: string) {
  const filters: EqFilter[] = [];
  let insertedRow: Record<string, unknown> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select() {
      return chain;
    },
    eq(key: string, value: unknown) {
      filters.push({ key, value });
      return chain;
    },
    insert(row: Record<string, unknown>) {
      insertedRow = row;
      if (table === "evidence_metadata") {
        oracleMock.inserts.push(row);
        oracleMock.rows.push({
          paymentId: String(row.escrow_payment_id),
          chainId: String(row.escrow_chain_id),
          address: String(row.escrow_contract_address),
          ref: String(row.evidence_reference),
        });
      }
      return chain;
    },
    update() {
      return chain;
    },
    neq() {
      return { data: null, error: null };
    },
    maybeSingle: async () => {
      if (table === "evidence_review_locks") {
        return { data: null, error: null };
      }
      const get = (key: string) =>
        filters.find((f) => f.key === key)?.value;
      const match = oracleMock.rows.find(
        (r) =>
          r.paymentId === String(get("escrow_payment_id")) &&
          r.chainId === String(get("escrow_chain_id")) &&
          r.address === String(get("escrow_contract_address")) &&
          r.ref === String(get("evidence_reference")),
      );
      return { data: match ? { id: "row-existing" } : null, error: null };
    },
    single: async () => {
      if (!insertedRow) return { data: null, error: { message: "no row" } };
      return { data: { id: "row-new" }, error: null };
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => makeQuery(table),
  }),
}));

import { POST, GET } from "../[paymentId]/evidence/metadata/route";

// Exact Payment #3 shape: text-only delivery, type message/other,
// all-string fields, explicit 42220 scope in both body keys.
const P3_BODY = {
  title: "Logo delivery",
  description: "Final logo delivery for review",
  type: "message",
  relatedClaim: "Logo",
  date: "2026-09-18",
  externalRef: "",
  pastedText: "Logo concepts attached as described — final delivery note.",
  fileHash: "",
  chainId: 42220,
  escrowChainId: "42220",
};

function p3Form() {
  return {
    title: P3_BODY.title,
    description: P3_BODY.description,
    type: P3_BODY.type,
    relatedClaim: P3_BODY.relatedClaim,
    date: P3_BODY.date,
    externalRef: P3_BODY.externalRef,
    pastedText: P3_BODY.pastedText,
    fileHash: P3_BODY.fileHash,
  };
}

function p3Reference(): string {
  return keccak256(stringToHex(buildEvidenceManifest(p3Form()))).toLowerCase();
}

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("P6.4E evidence metadata recovery (Payment #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oracleMock.onChainRef = ZERO_HASH;
    oracleMock.shouldThrow = false;
    oracleMock.readCalls = 0;
    oracleMock.rows = [];
    oracleMock.inserts = [];
  });

  it("(a) exact Payment #3-shaped body with matching chain read → 201 persisted", async () => {
    oracleMock.onChainRef = p3Reference();
    const res = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", P3_BODY),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.persisted).toBe(true);
    expect(String(body.evidenceReference).toLowerCase()).toBe(p3Reference());
    expect(oracleMock.inserts).toHaveLength(1);
  });

  it("(b) same body with a STALE chain read (zero-hash) → 400 HASH_MISMATCH", async () => {
    // The metadata POST raced receipt confirmation: forno still served the
    // pre-submission reference, so the matching manifest mismatches.
    oracleMock.onChainRef = ZERO_HASH;
    const res = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", P3_BODY),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("HASH_MISMATCH");
    expect(oracleMock.inserts).toHaveLength(0);
  });

  it("(c) mismatched manifest (no manifest knowledge) → 400 HASH_MISMATCH", async () => {
    oracleMock.onChainRef = p3Reference();
    const res = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", {
        ...P3_BODY,
        title: "Someone else's guess",
      }),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("HASH_MISMATCH");
    expect(oracleMock.inserts).toHaveLength(0);
  });

  it("(d) duplicate POST → 200 alreadyExisted (idempotent retry)", async () => {
    oracleMock.onChainRef = p3Reference();
    const first = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", P3_BODY),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(first.status).toBe(201);
    const second = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", P3_BODY),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.alreadyExisted).toBe(true);
    // No second insert — the idempotency check short-circuits.
    expect(oracleMock.inserts).toHaveLength(1);
  });

  it("(e) wrong chain (1) → 400 UNSUPPORTED_CHAIN with no chain read or write", async () => {
    oracleMock.onChainRef = p3Reference();
    // No body chain scope here: query ?chainId=1 alone must fail closed
    // (a body 42220 + query 1 would be CONFLICTING_CHAIN instead).
    const res = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata?chainId=1", p3Form()),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
    expect(oracleMock.readCalls).toBe(0);
    expect(oracleMock.inserts).toHaveLength(0);
  });

  it("(f) GET oracle found:true after persist, found:false when missing", async () => {
    oracleMock.onChainRef = p3Reference();
    // Nothing persisted yet → found:false, but the on-chain hash is reported.
    const missing = await GET(
      getRequest(
        "http://localhost/api/payments/3/evidence/metadata?chainId=42220",
      ),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(missing.status).toBe(200);
    const missingBody = await missing.json();
    expect(missingBody.found).toBe(false);
    expect(String(missingBody.evidenceReference).toLowerCase()).toBe(
      p3Reference(),
    );

    // Persist via POST, then the oracle reports found:true.
    const persisted = await POST(
      postRequest("http://localhost/api/payments/3/evidence/metadata", P3_BODY),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(persisted.status).toBe(201);

    const found = await GET(
      getRequest(
        "http://localhost/api/payments/3/evidence/metadata?chainId=42220",
      ),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(found.status).toBe(200);
    const foundBody = await found.json();
    expect(foundBody.found).toBe(true);
    expect(String(foundBody.evidenceReference).toLowerCase()).toBe(
      p3Reference(),
    );
    // Hash + boolean only — no plaintext leaks through the oracle.
    expect(foundBody.title).toBeUndefined();
    expect(foundBody.manifest).toBeUndefined();
    expect(foundBody.pastedText).toBeUndefined();
    expect(foundBody.description).toBeUndefined();
  });

  it("(f) GET rejects invalid payment id and unsupported chain", async () => {
    const invalid = await GET(
      getRequest("http://localhost/api/payments/abc/evidence/metadata"),
      { params: Promise.resolve({ paymentId: "abc" }) },
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("INVALID_PAYMENT_ID");

    const unsupported = await GET(
      getRequest(
        "http://localhost/api/payments/3/evidence/metadata?chainId=1",
      ),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).code).toBe("UNSUPPORTED_CHAIN");
  });

  it("(f) GET surfaces chain-read failure as 500 CHAIN_READ_FAILED", async () => {
    oracleMock.shouldThrow = true;
    const res = await GET(
      getRequest(
        "http://localhost/api/payments/3/evidence/metadata?chainId=42220",
      ),
      { params: Promise.resolve({ paymentId: "3" }) },
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("CHAIN_READ_FAILED");
  });
});
