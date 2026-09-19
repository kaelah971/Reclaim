// ---------------------------------------------------------------------------
// P6.4A: Gemini AI provider tests (server-side only, no real network)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { generateStructuredJSON } from "../ai/providers";

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL_PART = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function mockGeminiSuccess(text: string, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    text: async () => text,
  };
}

function mockGeminiHttpError(body: string, status: number) {
  return {
    status,
    ok: false,
    json: async () => ({}),
    text: async () => body,
  };
}

describe("Gemini provider — factory/config", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
  });

  it("isAIConfigured returns true for gemini + key", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_API_KEY = "test-gemini-key";
    const actual = await vi.importActual<typeof import("../ai/providers")>("../ai/providers");
    expect(actual.isAIConfigured()).toBe(true);
  });

  it("isAIConfigured returns false for gemini without key", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_API_KEY = "";
    const actual = await vi.importActual<typeof import("../ai/providers")>("../ai/providers");
    expect(actual.isAIConfigured()).toBe(false);
  });

  it("getAIProvider returns id gemini when AI_PROVIDER=gemini + key", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_API_KEY = "test-gemini-key";
    process.env.AI_MODEL = GEMINI_MODEL;
    const actual = await vi.importActual<typeof import("../ai/providers")>("../ai/providers");
    const provider = actual.getAIProvider();
    expect(provider.id).toBe("gemini");
  });
});

describe("Gemini generateStructuredJSON — mocked fetch", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_API_KEY = "test-gemini-key";
    process.env.AI_MODEL = GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
  });

  it("calls correct endpoint with x-goog-api-key (no Authorization) and maps prompts", async () => {
    const systemPrompt = "SYSTEM-PROMPT-XYZ";
    const userMessage = "USER-MESSAGE-ABC";
    const mockFetch = vi.fn().mockResolvedValue(mockGeminiSuccess('{"foo":1}'));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateStructuredJSON(systemPrompt, userMessage, "corr-gemini-01");
    expect(result).toEqual({ foo: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toContain(GEMINI_URL_PART);
    expect(url).toContain(":generateContent");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-gemini-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect("Authorization" in headers).toBe(false);

    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe(systemPrompt);
    expect(body.contents[0].parts[0].text).toContain(userMessage);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("parses valid structured JSON (Gemini candidates shape)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockGeminiSuccess('{"foo":1}')));
    const result = await generateStructuredJSON("sys", "user", "corr-gemini-valid");
    expect(result).toEqual({ foo: 1 });
  });

  it("parses markdown-fenced JSON safely", async () => {
    const fenced = '```json\n{"foo":1}\n```';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockGeminiSuccess(fenced)));
    const result = await generateStructuredJSON("sys", "user", "corr-gemini-fence");
    expect(result).toEqual({ foo: 1 });
  });

  it("invalid JSON fails honestly with GEMINI_INVALID_JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockGeminiSuccess("{ not valid json }")));
    await expect(
      generateStructuredJSON("sys", "user", "corr-gemini-bad-json"),
    ).rejects.toMatchObject({ code: "GEMINI_INVALID_JSON" });
  });

  it("429 retries then succeeds (2 calls)", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockGeminiHttpError("Rate limited", 429))
      .mockResolvedValueOnce(mockGeminiSuccess('{"foo":1}'));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateStructuredJSON("sys", "user", "corr-gemini-429");
    expect(result).toEqual({ foo: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("401 does not retry (1 call, GEMINI_HTTP_401 non-retryable)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockGeminiHttpError("Invalid API key", 401));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      generateStructuredJSON("sys", "user", "corr-gemini-401"),
    ).rejects.toMatchObject({ code: "GEMINI_HTTP_401", retryable: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("no API key throws NO_API_KEY", async () => {
    process.env.AI_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      generateStructuredJSON("sys", "user", "corr-gemini-no-key"),
    ).rejects.toMatchObject({ code: "NO_API_KEY" });
  });

  it("empty response throws GEMINI_EMPTY_RESPONSE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ candidates: [] }),
        text: async () => "{}",
      }),
    );
    await expect(
      generateStructuredJSON("sys", "user", "corr-gemini-empty"),
    ).rejects.toMatchObject({ code: "GEMINI_EMPTY_RESPONSE" });
  });

  it("redacts key-like material from error body", async () => {
    const leakBody = "Auth failed for key AIzaFakeKey1234567890abcdef please check x-goog-api-key: AIzaFakeKey1234567890abcdef";
    const mockFetch = vi.fn().mockResolvedValue(mockGeminiHttpError(leakBody, 400));
    vi.stubGlobal("fetch", mockFetch);

    let caught: { code?: string; message?: string } = {};
    try {
      await generateStructuredJSON("sys", "user", "corr-gemini-redact");
    } catch (e) {
      caught = e as { code?: string; message?: string };
    }
    expect(caught.code).toBe("GEMINI_HTTP_400");
    expect(caught.message).not.toContain("AIzaFakeKey1234567890abcdef");
    expect(caught.message).toContain("[REDACTED]");
  });
});
