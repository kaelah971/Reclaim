// ---------------------------------------------------------------------------
// P6.1 — /api/command/parse route tests (mock fetch for AI only).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/command/parse", {
    method: "POST",
    body: JSON.stringify(body),
  });
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

describe("P6.1 command parse route", () => {
  it("rejects a missing message", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("fails honestly when the AI provider is unavailable", async () => {
    const res = await POST(
      req({ message: `Protect 50 USA₮ for ${WORKER} by Friday.` }),
    );
    expect(res.status).toBe(503);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("AI_UNAVAILABLE");
  });

  it("complete command → structured draft via mocked AI", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "test-key";
    const aiDraft = {
      purpose: "Logo design",
      jobType: "design",
      deliverables: ["Logo design files (SVG + PNG)"],
      releaseMode: "manual",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify(aiDraft) } }],
          }),
      }),
    );
    const res = await POST(
      req({ message: `Protect 50 USA₮ for ${WORKER} to design a logo by Friday. Ask me before releasing.` }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      draft?: { amount?: string; recipient?: string; purpose?: string };
      ready?: boolean;
    };
    expect(data.draft?.amount).toBe("50");
    expect(data.draft?.recipient).toBe(WORKER);
    expect(data.draft?.purpose).toMatch(/logo/i);
    expect(data.ready).toBe(true);
  });

  it("never broadcasts a transaction", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve(__dirname, "../route.ts"), "utf-8");
    expect(src).not.toContain("writeContract");
    expect(src).not.toContain("sendTransaction");
  });
});
