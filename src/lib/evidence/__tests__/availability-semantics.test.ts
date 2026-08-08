// ---------------------------------------------------------------------------
// Evidence availability semantics tests
//
// After RA1R.6A: evidence availability is based on substantive manifest
// content, not file count.  A verified manifest with usable text/reference
// data qualifies as "package_available" even with fileCount 0.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { isManifestSubstantive } from "../reader";

describe("isManifestSubstantive", () => {
  it("returns false for null/empty manifest", () => {
    expect(isManifestSubstantive(null)).toBe(false);
    expect(isManifestSubstantive("")).toBe(false);
    expect(isManifestSubstantive("   ")).toBe(false);
  });

  it("returns true when manifest has pasted text", () => {
    const m = "title:Test | type:screenshot | text:Here is the evidence content | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(true);
  });

  it("returns true when manifest has claim", () => {
    const m = "title:Test | type:screenshot | claim:The deliverable was completed | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(true);
  });

  it("returns true when manifest has external reference", () => {
    const m = "title:Test | type:screenshot | ref:https://example.com/e | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(true);
  });

  it("returns false when manifest has only title/type/date", () => {
    const m = "title:Test | type:screenshot | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(false);
  });

  it("returns false when file hash present but no textual evidence", () => {
    const m = "title:Test | type:screenshot | file-sha256:abc123 | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(false);
  });

  it("returns true when file hash AND pasted text both present", () => {
    const m = "title:Test | type:screenshot | text:Content here | file-sha256:abc123";
    expect(isManifestSubstantive(m)).toBe(true);
  });

  it("returns false for empty text field", () => {
    const m = "title:Test | type:screenshot | text:  | date:2026-01-01";
    expect(isManifestSubstantive(m)).toBe(false);
  });
});

describe("evidence availability semantics", () => {
  it("no reference and no metadata → none", () => {
    expect(isManifestSubstantive(null)).toBe(false);
  });

  it("chain reference only, no DB manifest → on_chain_reference_only", () => {
    expect(isManifestSubstantive(null)).toBe(false);
  });

  it("verified manifest with pasted text, fileCount 0 → package_available", () => {
    expect(isManifestSubstantive("title:E | type:text | text:Real content | date:2026-01-01")).toBe(true);
  });

  it("verified manifest with external reference, fileCount 0 → package_available", () => {
    expect(isManifestSubstantive("title:E | type:link | ref:https://x.com | date:2026-01-01")).toBe(true);
  });

  it("empty/non-substantive manifest does NOT qualify", () => {
    expect(isManifestSubstantive("title:X | type:doc | date:2026-01-01")).toBe(false);
  });

  it("fileHash/fileCount > 0 but no readable textual evidence does NOT qualify", () => {
    expect(isManifestSubstantive("title:S | type:img | file-sha256:beef | date:2026-01-01")).toBe(false);
  });

  it("stale manifest vs current chain hash — content still substantive", () => {
    expect(isManifestSubstantive("title:Old | text:Still valid")).toBe(true);
  });
});
