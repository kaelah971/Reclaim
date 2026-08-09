// ---------------------------------------------------------------------------
// Celo transaction attribution helper tests
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTag } from "@/lib/contracts/attribution";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("normalizeTag", () => {
  it("encodes a plain Celo project tag (text) to its UTF-8 hex bytes", () => {
    expect(normalizeTag("celo_b7de8bf7e64e")).toBe(
      "0x63656c6f5f623764653862663765363465",
    );
  });

  it("encodes arbitrary text to hex", () => {
    expect(normalizeTag("hello")).toBe("0x68656c6c6f");
  });

  it("preserves valid 0x-prefixed hex without double-encoding", () => {
    expect(normalizeTag("0x1234")).toBe("0x1234");
  });

  it("lowercases valid 0x-prefixed hex while preserving it", () => {
    expect(normalizeTag("0xABC123")).toBe("0xabc123");
  });

  it("rejects empty 0x-prefixed hex", () => {
    expect(normalizeTag("0x")).toBeUndefined();
  });

  it("rejects odd-length 0x-prefixed hex", () => {
    expect(normalizeTag("0x123")).toBeUndefined();
  });

  it("rejects 0x-prefixed values with non-hex characters", () => {
    expect(normalizeTag("0xZZ")).toBeUndefined();
  });

  it("fails closed on empty/undefined/whitespace-only input", () => {
    expect(normalizeTag(undefined)).toBeUndefined();
    expect(normalizeTag("")).toBeUndefined();
    expect(normalizeTag("   ")).toBeUndefined();
  });

  it("trims surrounding whitespace from the env value", () => {
    expect(normalizeTag("  0x1234  ")).toBe("0x1234");
  });
});

describe("env integration (module-level const)", () => {
  it("normalizes NEXT_PUBLIC_CELO_ATTRIBUTION_TAG as text when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "celo_b7de8bf7e64e");
    const attribution = await import("@/lib/contracts/attribution");

    const expected = "0x63656c6f5f623764653862663765363465";
    expect(attribution.getAttributionTag()).toBe(expected);
    expect(attribution.getAttributionDataSuffix()).toBe(expected);
    expect(attribution.isAttributionEnabled()).toBe(true);
    expect(attribution.appendAttributionTag("0xdeadbeef")).toBe(
      "0xdeadbeef63656c6f5f623764653862663765363465",
    );
  });

  it("fails closed when NEXT_PUBLIC_CELO_ATTRIBUTION_TAG is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "");
    const attribution = await import("@/lib/contracts/attribution");

    expect(attribution.getAttributionTag()).toBeUndefined();
    expect(attribution.getAttributionDataSuffix()).toBeUndefined();
    expect(attribution.isAttributionEnabled()).toBe(false);
    expect(attribution.appendAttributionTag("0xdeadbeef")).toBe("0xdeadbeef");
  });

  it("preserves a raw hex env value without double-encoding", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "0x1234");
    const attribution = await import("@/lib/contracts/attribution");

    expect(attribution.getAttributionTag()).toBe("0x1234");
    expect(attribution.appendAttributionTag("0xdeadbeef")).toBe(
      "0xdeadbeef1234",
    );
  });
});
