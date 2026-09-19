// ---------------------------------------------------------------------------
// P6.3 — /api/payments/[paymentId]/delivery/parse route tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function req(
  paymentId: string,
  body: unknown,
): { request: NextRequest; params: Promise<{ paymentId: string }> } {
  const request = new NextRequest(
    `http://localhost/api/payments/${paymentId}/delivery/parse`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return { request, params: Promise.resolve({ paymentId }) };
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    message: "Done! Delivery here https://example.com/live is ready",
    paymentContext: {
      chainId: 42220,
      worker: WORKER,
      deliverables: ["Landing page design"],
      evidenceRequirements: ["Live URL"],
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_API_KEY;
  delete process.env.AI_PROVIDER;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AI_API_KEY;
  delete process.env.AI_PROVIDER;
});

describe("P6.3 delivery parse route", () => {
  it("valid message → 200 shape with echoed payment scope", async () => {
    const { request, params } = req("7", validBody());
    const res = await POST(request, { params });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.paymentId).toBe("7");
    expect(data.chainId).toBe(42220);
    expect(data.worker).toBe(WORKER);
    expect(data).toHaveProperty("draft");
    expect(data).toHaveProperty("missingFields");
    expect(data).toHaveProperty("clarifyingQuestion");
    expect(data).toHaveProperty("ready");
    expect(data).toHaveProperty("rejected");
    expect(data).toHaveProperty("boundaryMessage");
    expect(data).toHaveProperty("errors");
    expect(data).toHaveProperty("aiUnavailable");
    // deterministic URL extraction works even without AI configured
    const draft = data.draft as { references?: Array<{ value?: string }> };
    expect(draft.references?.[0]?.value).toBe("https://example.com/live");
  });

  it("AI unavailable still returns 200 deterministic draft (never 503)", async () => {
    // No AI env → generateStructuredJSON throws NO_API_KEY → aiUnavailable.
    const { request, params } = req("7", validBody());
    const res = await POST(request, { params });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { aiUnavailable?: boolean };
    expect(data.aiUnavailable).toBe(true);
  });

  it("rejects a bad worker with 400 INVALID_WORKER", async () => {
    const { request, params } = req(
      "7",
      validBody({
        paymentContext: { chainId: 42220, worker: "0x123" },
      }),
    );
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("INVALID_WORKER");
  });

  it("rejects a bad chain with 400 UNSUPPORTED_CHAIN", async () => {
    const { request, params } = req(
      "7",
      validBody({ paymentContext: { chainId: 1, worker: WORKER } }),
    );
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects an overlong message with 400", async () => {
    const { request, params } = req(
      "7",
      validBody({ message: "x".repeat(2001) }),
    );
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("MESSAGE_TOO_LONG");
  });

  it("rejects a non-numeric paymentId with 400", async () => {
    const { request, params } = req("abc", validBody());
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
  });

  it("never broadcasts a transaction", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve(__dirname, "../route.ts"), "utf-8");
    expect(src).not.toContain("writeContract");
    expect(src).not.toContain("sendTransaction");
  });
});
