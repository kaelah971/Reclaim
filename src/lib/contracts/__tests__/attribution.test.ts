// ---------------------------------------------------------------------------
// Celo transaction attribution helper tests
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { normalizeTag } from "@/lib/contracts/attribution";

const ASSIGNED_CODE = "celo_b7de8bf7e64e";
const EXPECTED_SUFFIX = toDataSuffix(ASSIGNED_CODE);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("normalizeTag", () => {
  it("encodes the assigned text code with the official SDK", () => {
    expect(normalizeTag(ASSIGNED_CODE)).toBe(EXPECTED_SUFFIX);
  });

  it("round-trips through the SDK decoder", () => {
    expect(fromDataSuffix(normalizeTag(ASSIGNED_CODE)!)).toEqual({
      codes: [ASSIGNED_CODE],
      schemaId: 0,
    });
  });

  it("uses the SDK for raw-looking text instead of preserving it as hex", () => {
    const normalized = normalizeTag("0x1234");
    expect(normalized).not.toBe("0x1234");
    expect(fromDataSuffix(normalized!)).toEqual({
      codes: ["0x1234"],
      schemaId: 0,
    });
  });

  it("rejects invalid codes", () => {
    expect(normalizeTag("Celo_B7DE8BF7E64E")).toBeUndefined();
    expect(normalizeTag("invalid code")).toBeUndefined();
  });

  it("fails closed on empty, undefined, and whitespace-only input", () => {
    expect(normalizeTag(undefined)).toBeUndefined();
    expect(normalizeTag("")).toBeUndefined();
    expect(normalizeTag("   ")).toBeUndefined();
  });

  it("trims surrounding whitespace before SDK validation", () => {
    expect(normalizeTag(`  ${ASSIGNED_CODE}  `)).toBe(EXPECTED_SUFFIX);
  });
});

describe("env integration (module-level const)", () => {
  it("uses the assigned code and appends the encoded suffix", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", ASSIGNED_CODE);
    const attribution = await import("@/lib/contracts/attribution");

    expect(attribution.getAttributionTag()).toBe(EXPECTED_SUFFIX);
    expect(attribution.getAttributionDataSuffix()).toBe(EXPECTED_SUFFIX);
    expect(attribution.isAttributionEnabled()).toBe(true);
    const calldata = "0xdeadbeef" as const;
    const appended = attribution.appendAttributionTag(calldata);
    expect(appended).toBe(`${calldata}${EXPECTED_SUFFIX.slice(2)}`);
    expect(fromDataSuffix(appended)).toEqual({
      codes: [ASSIGNED_CODE],
      schemaId: 0,
    });
  });

  it("fails closed when the configuration is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "");
    const attribution = await import("@/lib/contracts/attribution");

    expect(attribution.getAttributionTag()).toBeUndefined();
    expect(attribution.getAttributionDataSuffix()).toBeUndefined();
    expect(attribution.isAttributionEnabled()).toBe(false);
    expect(attribution.appendAttributionTag("0xdeadbeef")).toBe("0xdeadbeef");
  });

  it("fails closed when the configured code is invalid", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "INVALID CODE");
    const attribution = await import("@/lib/contracts/attribution");

    expect(attribution.getAttributionTag()).toBeUndefined();
    expect(attribution.getAttributionDataSuffix()).toBeUndefined();
    expect(attribution.isAttributionEnabled()).toBe(false);
    expect(attribution.appendAttributionTag("0xdeadbeef")).toBe("0xdeadbeef");
  });
});
