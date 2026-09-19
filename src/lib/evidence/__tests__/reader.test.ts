// ---------------------------------------------------------------------------
// Evidence reader tests — manifest-derived substantive facts (RA1R.8D)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  extractManifestField,
  isManifestSubstantive,
  type DurableEvidenceMetadata,
} from "../reader";
import { buildEvidenceManifest } from "../manifest";
import { manifestSignalsFor } from "@/lib/review/evaluationService";

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

  it("Payment #3 recovered manifest (message text-only) is substantive with QC signal", () => {
    // P6.4E recovery target: text-only delivery, type message, no file hash.
    // A recovered is_current row carrying this manifest must read as
    // substantive evidence with the "substantive delivery content" signal.
    const manifest = buildEvidenceManifest({
      title: "Logo delivery",
      description: "Final logo delivery for review",
      type: "message",
      relatedClaim: "Logo",
      date: "2026-09-18",
      externalRef: "",
      pastedText: "Logo concepts attached as described — final delivery note.",
      fileHash: "",
    });
    expect(manifest).toContain("text:");
    expect(isManifestSubstantive(manifest)).toBe(true);
    const facts: DurableEvidenceMetadata = {
      evidenceReference: "0xrecovered",
      title: "Logo delivery",
      evidenceType: "message",
      description: "Final logo delivery for review",
      relatedDeliverable: "Logo",
      externalReference: null,
      fileCount: 0,
      latestUpdateTimestamp: Date.now(),
      substantiveEvidence: isManifestSubstantive(manifest),
      submitterAddress: "chain_verified",
      relatedClaim: "Logo",
      pastedText: "Logo concepts attached as described — final delivery note.",
      evidenceDate: "2026-09-18",
      externalRef: "",
      fileHash: null,
    };
    expect(manifestSignalsFor(facts)).toContain("substantive delivery content");
  });
});
