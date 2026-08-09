// ---------------------------------------------------------------------------
// Review packet builder tests (RA1R.8D)
//
// Verified evidence facts are authoritative: QC statements contradicting
// them are flagged as inconsistencies, never silently presented as fact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildReviewPacket,
  detectQcInconsistencies,
  type ReviewPacketEvidenceFacts,
  type ReviewPacketQc,
} from "../reviewPacket";

const facts: ReviewPacketEvidenceFacts = {
  evidenceReference: "0xabc",
  title: "Completed work evidence",
  evidenceType: "other",
  description: "Evidence showing completed work",
  relatedClaim: "Completed work for the controlled dispute test",
  pastedText:
    "I completed the agreed controlled dispute test deliverable for Payment #1.",
  evidenceDate: "2026-08-08",
  externalRef: null,
  fileHash: null,
  fileCount: 0,
  availability: "package_available",
  substantiveEvidence: true,
  caseVersionHash: "0xcase",
  evidenceVersionHash: "0xev",
};

function makeQc(overrides: Partial<ReviewPacketQc> = {}): ReviewPacketQc {
  return {
    toolId: "evidence-quality-check",
    executionRequestHash: "0xreq",
    readiness: "needs_improvement",
    missingEvidence: [],
    ambiguities: [],
    reviewerQuestions: [
      "Reviewer question: No pasted text content — evidence may lack substance.",
      "Reviewer question: No date specified — chronological context is missing.",
      "Reviewer question: No file hash — files cannot be verified for integrity.",
    ],
    recommendedImprovements: ["Paste relevant message logs."],
    settlementTxHash: "0xtx",
    paymentReference: "0xpay",
    resultReference: "0xresult",
    ...overrides,
  };
}

describe("detectQcInconsistencies", () => {
  it("flags QC 'no pasted text' when verified evidence contains pasted text", () => {
    const qc = makeQc({
      reviewerQuestions: [
        "Reviewer question: No pasted text content — evidence may lack substance.",
      ],
    });
    const flags = detectQcInconsistencies(facts, qc);
    expect(flags).toContain(
      "QC states there is no pasted text, but verified evidence contains pasted text.",
    );
  });

  it("flags QC 'no date specified' when verified evidence has a date", () => {
    const qc = makeQc({
      reviewerQuestions: [
        "Reviewer question: No date specified — chronological context is missing.",
      ],
    });
    const flags = detectQcInconsistencies(facts, qc);
    expect(flags).toContain(
      "QC states no date was specified, but verified evidence has a date.",
    );
  });

  it("flags QC 'no claim' when verified evidence has a claim", () => {
    const qc = makeQc({
      reviewerQuestions: ["Reviewer question: No claim provided."],
    });
    const flags = detectQcInconsistencies(facts, qc);
    expect(flags).toContain(
      "QC states no claim was provided, but verified evidence has a claim.",
    );
  });

  it("does NOT flag QC 'no file hash' when verified evidence truly has no file hash", () => {
    const qc = makeQc({
      reviewerQuestions: [
        "Reviewer question: No file hash — files cannot be verified for integrity.",
      ],
    });
    const flags = detectQcInconsistencies(facts, qc);
    expect(flags).not.toContain(
      "QC states there is no pasted text, but verified evidence contains pasted text.",
    );
    expect(flags).not.toContain(
      "QC states no date was specified, but verified evidence has a date.",
    );
  });

  it("returns no flags when QC is consistent with verified facts", () => {
    const consistentQc = makeQc({
      reviewerQuestions: [
        "Reviewer question: No file hash — files cannot be verified for integrity.",
      ],
    });
    expect(detectQcInconsistencies(facts, consistentQc)).toEqual([]);
  });

  it("returns no flags when evidence lacks the contested facts", () => {
    const noFacts: ReviewPacketEvidenceFacts = {
      ...facts,
      relatedClaim: null,
      pastedText: null,
      evidenceDate: null,
    };
    const qc = makeQc({
      reviewerQuestions: [
        "Reviewer question: No pasted text content — evidence may lack substance.",
        "Reviewer question: No date specified — chronological context is missing.",
      ],
    });
    expect(detectQcInconsistencies(noFacts, qc)).toEqual([]);
  });
});

describe("buildReviewPacket", () => {
  const baseInput = {
    agentId: "agt_test",
    agentObjective: "Prepare this payment case for fair human review.",
    escrowChainId: "eip155:11142220",
    escrowContractAddress: "0xcontract",
    escrowPaymentId: "1",
    escrowState: "delivered",
    client: "0xclient",
    worker: "0xworker",
    amountAtomic: "10000",
    evidence: facts,
    qualityCheck: makeQc(),
  };

  it("carries verified evidence facts verbatim", () => {
    const packet = buildReviewPacket(baseInput) as {
      evidence: Record<string, unknown>;
    };
    expect(packet.evidence.pastedText).toBe(facts.pastedText);
    expect(packet.evidence.relatedClaim).toBe(facts.relatedClaim);
    expect(packet.evidence.evidenceDate).toBe(facts.evidenceDate);
    expect(packet.evidence.fileHash).toBeNull();
  });

  it("keeps the original QC provenance (never rewritten)", () => {
    const packet = buildReviewPacket(baseInput) as {
      qualityCheck: Record<string, unknown>;
    };
    expect(packet.qualityCheck.executionRequestHash).toBe("0xreq");
    expect(packet.qualityCheck.settlementTxHash).toBe("0xtx");
    expect(packet.qualityCheck.paymentReference).toBe("0xpay");
    expect(packet.qualityCheck.resultReference).toBe("0xresult");
  });

  it("marks contradictory QC statements as inconsistencies", () => {
    const packet = buildReviewPacket(baseInput) as { qcInconsistency: string[] };
    expect(packet.qcInconsistency).toContain(
      "QC states there is no pasted text, but verified evidence contains pasted text.",
    );
    expect(packet.qcInconsistency).toContain(
      "QC states no date was specified, but verified evidence has a date.",
    );
  });

  it("never makes a decision", () => {
    const packet = buildReviewPacket(baseInput) as { decision: string };
    expect(packet.decision).toContain("NO DECISION MADE BY THE AGENT");
  });
});
