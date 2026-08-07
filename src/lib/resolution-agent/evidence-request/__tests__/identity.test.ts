import { describe, it, expect } from "vitest";
import {
  computeEvidenceRequestDedupIdentity,
  normalizeEvidenceItem,
  normalizeReason,
} from "../identity";

// ---------------------------------------------------------------------------
// normalizeEvidenceItem
// ---------------------------------------------------------------------------

describe("normalizeEvidenceItem", () => {
  it("trims whitespace", () => {
    expect(normalizeEvidenceItem("  missing receipt  ")).toBe("missing receipt");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeEvidenceItem("missing   receipt   proof")).toBe("missing receipt proof");
  });

  it("handles tabs and newlines as whitespace", () => {
    expect(normalizeEvidenceItem("\t\nevidence\titem\n")).toBe("evidence item");
  });

  it("rejects empty string", () => {
    expect(() => normalizeEvidenceItem("")).toThrow("Evidence item must not be empty");
  });

  it("rejects whitespace-only string", () => {
    expect(() => normalizeEvidenceItem("   ")).toThrow("Evidence item must not be empty");
  });

  it("truncates to max length (200)", () => {
    const long = "a".repeat(250);
    const result = normalizeEvidenceItem(long);
    expect(result.length).toBe(200);
    expect(result).toBe("a".repeat(200));
  });

  it("does not truncate strings within limit", () => {
    const within = "a".repeat(200);
    expect(normalizeEvidenceItem(within).length).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// normalizeReason
// ---------------------------------------------------------------------------

describe("normalizeReason", () => {
  it("trims whitespace", () => {
    expect(normalizeReason("  Need this for review  ")).toBe("Need this for review");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeReason("This   is   needed")).toBe("This is needed");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeReason("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeReason("   ")).toBe("");
  });

  it("truncates to max length (500)", () => {
    const long = "r".repeat(600);
    const result = normalizeReason(long);
    expect(result.length).toBe(500);
  });

  it("preserves string within limit", () => {
    const within = "r".repeat(500);
    expect(normalizeReason(within).length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceRequestDedupIdentity
// ---------------------------------------------------------------------------

describe("computeEvidenceRequestDedupIdentity", () => {
  const baseParams = {
    agentId: "agt_test_1",
    responsibleParty: "client" as const,
    evidenceItem: "missing receipt",
    caseVersionHash: "case_v1",
    evidenceVersionHash: "ev_v1",
  };

  it("same logical request → same dedup identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity(baseParams);
    expect(id1).toEqual(id2);
  });

  it("whitespace normalized — trailing", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      evidenceItem: "missing receipt  ",
    });
    expect(id1).toEqual(id2);
  });

  it("whitespace normalized — leading", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      evidenceItem: "  missing receipt",
    });
    expect(id1).toEqual(id2);
  });

  it("whitespace normalized — repeated inner", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      evidenceItem: "missing    receipt",
    });
    expect(id1).toEqual(id2);
  });

  it("empty evidenceItem is rejected during identity computation", () => {
    expect(() =>
      computeEvidenceRequestDedupIdentity({
        ...baseParams,
        evidenceItem: "",
      }),
    ).toThrow("Evidence item must not be empty");
  });

  it("changed responsibleParty → different identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      responsibleParty: "worker",
    });
    expect(id1).not.toEqual(id2);
  });

  it("changed evidenceItem → different identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      evidenceItem: "proof of delivery",
    });
    expect(id1).not.toEqual(id2);
  });

  it("changed caseVersionHash → different identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      caseVersionHash: "case_v2",
    });
    expect(id1).not.toEqual(id2);
  });

  it("changed evidenceVersionHash → different identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      evidenceVersionHash: "ev_v2",
    });
    expect(id1).not.toEqual(id2);
  });

  it("timestamp is not in identity (no timestamp parameter)", () => {
    // The function does not accept a timestamp parameter,
    // confirming timestamp is not part of the identity.
    const params = computeEvidenceRequestDedupIdentity(baseParams);
    const keys = Object.keys(params);
    expect(keys).not.toContain("timestamp");
    expect(keys).not.toContain("createdAt");
    expect(keys).not.toContain("now");
  });

  it("changed agentId → different identity", () => {
    const id1 = computeEvidenceRequestDedupIdentity(baseParams);
    const id2 = computeEvidenceRequestDedupIdentity({
      ...baseParams,
      agentId: "agt_test_2",
    });
    expect(id1).not.toEqual(id2);
  });
});
