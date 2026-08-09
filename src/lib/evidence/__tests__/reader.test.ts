// ---------------------------------------------------------------------------
// Evidence reader tests — manifest-derived substantive facts (RA1R.8D)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { extractManifestField, isManifestSubstantive } from "../reader";

const manifest =
  "title:Controlled dispute test — completed work evidence | " +
  "type:other | claim:Completed work for the controlled dispute test | " +
  "date:2026-08-08 | " +
  "text:I completed the agreed controlled dispute test deliverable for Payment #1.";

describe("extractManifestField", () => {
  it("extracts claim", () => {
    expect(extractManifestField(manifest, "claim")).toBe(
      "Completed work for the controlled dispute test",
    );
  });

  it("extracts text", () => {
    expect(extractManifestField(manifest, "text")).toBe(
      "I completed the agreed controlled dispute test deliverable for Payment #1.",
    );
  });

  it("extracts date", () => {
    expect(extractManifestField(manifest, "date")).toBe("2026-08-08");
  });

  it("returns null for absent fields", () => {
    expect(extractManifestField(manifest, "ref")).toBeNull();
    expect(extractManifestField(manifest, "file-sha256")).toBeNull();
  });

  it("does not match partial keys (ref vs ref-x)", () => {
    const m = "ref:https://example.com | ref-x:nope";
    expect(extractManifestField(m, "ref")).toBe("https://example.com");
  });
});

describe("isManifestSubstantive", () => {
  it("treats pasted text as substantive", () => {
    expect(isManifestSubstantive(manifest)).toBe(true);
  });

  it("treats a claim alone as substantive", () => {
    expect(isManifestSubstantive("claim:Work completed")).toBe(true);
  });

  it("treats a ref alone as substantive", () => {
    expect(isManifestSubstantive("ref:https://example.com/e")).toBe(true);
  });

  it("treats a file hash alone as NOT substantive", () => {
    expect(isManifestSubstantive("file-sha256:abc123")).toBe(false);
  });

  it("treats empty manifest as NOT substantive", () => {
    expect(isManifestSubstantive(null)).toBe(false);
    expect(isManifestSubstantive("")).toBe(false);
  });
});
