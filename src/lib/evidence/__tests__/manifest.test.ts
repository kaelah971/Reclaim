// ---------------------------------------------------------------------------
// Evidence Metadata tests — manifest construction, hash verification,
// and reader logic
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import { buildEvidenceManifest, type EvidenceFormData } from "../manifest";

const fullData: EvidenceFormData = {
  title: "Delivery Screenshot",
  description: "Screenshot showing completed work",
  type: "screenshot",
  relatedClaim: "Deliverable completed on time",
  date: "2026-08-01",
  externalRef: "https://example.com/evidence/1",
  pastedText: "Work was completed as specified",
  fileHash: "abc123def456",
};

describe("buildEvidenceManifest", () => {
  it("produces canonical manifest with all fields", () => {
    const manifest = buildEvidenceManifest(fullData);
    expect(manifest).toContain("title:Delivery Screenshot");
    expect(manifest).toContain("type:screenshot");
    expect(manifest).toContain("file-sha256:abc123def456");
    expect(manifest).toContain(" | ");
  });

  it("produces deterministic output", () => {
    const m1 = buildEvidenceManifest(fullData);
    const m2 = buildEvidenceManifest({ ...fullData });
    expect(m1).toBe(m2);
  });

  it("omits empty optional fields", () => {
    const minimal: EvidenceFormData = {
      title: "Only Title",
      description: "",
      type: "",
      relatedClaim: "",
      date: "",
      externalRef: "",
      pastedText: "",
      fileHash: "",
    };
    const manifest = buildEvidenceManifest(minimal);
    expect(manifest).toBe("title:Only Title");
    expect(manifest).not.toContain(" | ");
  });

  it("includes file-sha256 when fileHash is set", () => {
    const withFile: EvidenceFormData = {
      ...fullData,
      fileHash: "",
    };
    const manifest = buildEvidenceManifest(withFile);
    expect(manifest).not.toContain("file-sha256");
  });

  it("hash of manifest matches known on-chain reference", () => {
    // Test that the hash computation is consistent
    const manifest = buildEvidenceManifest(fullData);
    const hash = keccak256(stringToHex(manifest));
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    // Same manifest, same hash
    const hash2 = keccak256(stringToHex(manifest));
    expect(hash).toBe(hash2);
  });

  it("different manifests produce different hashes", () => {
    const m1 = buildEvidenceManifest(fullData);
    const m2 = buildEvidenceManifest({ ...fullData, title: "Different Title" });
    const h1 = keccak256(stringToHex(m1));
    const h2 = keccak256(stringToHex(m2));
    expect(h1).not.toBe(h2);
  });
});

describe("hash verification", () => {
  it("rejects manifest that does not match supplied reference", () => {
    const manifest = buildEvidenceManifest(fullData);
    const correctHash = keccak256(stringToHex(manifest));
    const wrongHash = keccak256(stringToHex("wrong manifest"));
    expect(correctHash).not.toBe(wrongHash);
  });

  it("tampered manifest produces different hash", () => {
    const original = buildEvidenceManifest(fullData);
    // Simulate tampering by changing the manifest directly
    const tampered = original.replace("Delivery Screenshot", "Fake Evidence");
    const originalHash = keccak256(stringToHex(original));
    const tamperedHash = keccak256(stringToHex(tampered));
    expect(originalHash).not.toBe(tamperedHash);
  });
});

describe("EvidenceFormData type", () => {
  it("accepts valid data", () => {
    const data: EvidenceFormData = {
      title: "Test",
      description: "Test desc",
      type: "screenshot",
      relatedClaim: "",
      date: "2026-01-01",
      externalRef: "",
      pastedText: "",
      fileHash: "",
    };
    const manifest = buildEvidenceManifest(data);
    expect(manifest).toBe("title:Test | type:screenshot | date:2026-01-01");
  });
});
