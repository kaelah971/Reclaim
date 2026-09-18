// ---------------------------------------------------------------------------
// P4.3D publicSanitize unit tests — public routes must never leak plaintext.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  sanitizeReceiptEvidenceForPublic,
  sanitizeReceiptQualityCheckForPublic,
  sanitizeReviewPacketForPublic,
} from "@/lib/evidence/publicSanitize";

describe("sanitizeReceiptEvidenceForPublic", () => {
  it("redacts all plaintext and keeps hash/safe fields", () => {
    const view = sanitizeReceiptEvidenceForPublic({
      evidenceReference: "0xabc",
      availability: "package_available",
      evidenceType: "other",
      submittedAt: "2026-09-18T00:00:00.000Z",
      submitter: "chain_verified",
      submissionTxHash: "0xtx",
    });
    expect(view.title).toBeNull();
    expect(view.claim).toBeNull();
    expect(view.date).toBeNull();
    expect(view.pastedText).toBeNull();
    expect(view.evidenceReference).toBe("0xabc");
    expect(view.availability).toBe("package_available");
    expect(view.evidenceType).toBe("other");
    expect(view.submittedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(view.submitter).toBe("chain_verified");
    expect(view.submissionTxHash).toBe("0xtx");
  });
});

describe("sanitizeReceiptQualityCheckForPublic", () => {
  it("keeps provenance + readiness, empties all free-text arrays", () => {
    const view = sanitizeReceiptQualityCheckForPublic({
      toolId: "evidence-quality-check",
      priceHuman: "$0.01 USDC",
      network: "Celo Mainnet",
      facilitatorUrl: "https://api.x402.celo.org",
      executionRequestHash: "0xreq",
      readiness: "needs_improvement",
      settlementTxHash: "0xsettle",
      paymentReference: "0xpay",
      resultReference: "0xres",
    });
    expect(view.toolId).toBe("evidence-quality-check");
    expect(view.readiness).toBe("needs_improvement");
    expect(view.settlementTxHash).toBe("0xsettle");
    expect(view.reviewerQuestions).toEqual([]);
    expect(view.ambiguities).toEqual([]);
    expect(view.recommendedImprovements).toEqual([]);
    expect(view.inconsistencies).toEqual([]);
  });
});

describe("sanitizeReviewPacketForPublic", () => {
  it("redacts evidence plaintext + QC text, keeps hashes/flags/counts", () => {
    const packet = {
      schemaVersion: "reclaim-review-packet-v1",
      case: { escrowPaymentId: "7", client: "0xClient", worker: "0xWorker" },
      evidence: {
        evidenceReference: "0xabc",
        title: "Secret title",
        description: "Secret description",
        relatedClaim: "Secret claim",
        pastedText: "Secret pasted text",
        evidenceDate: "2026-09-01",
        externalRef: "https://private.example/secret",
        fileHash: "0xfile",
        fileCount: 1,
        availability: "package_available",
        substantiveEvidence: true,
        caseVersionHash: "0xcase",
        evidenceVersionHash: "0xev",
      },
      qualityCheck: {
        toolId: "evidence-quality-check",
        executionRequestHash: "0xreq",
        readiness: "needs_improvement",
        missingEvidence: ["missing secret"],
        ambiguities: ["ambiguous secret quote"],
        reviewerQuestions: ["Q quoting worker text"],
        recommendedImprovements: ["improve secret"],
        settlementTxHash: "0xsettle",
        paymentReference: "0xpay",
        resultReference: "0xres",
      },
      qcInconsistency: ["QC states no pasted text, but verified evidence contains pasted text."],
    };
    const sanitized = sanitizeReviewPacketForPublic(packet) as Record<string, Record<string, unknown>>;
    const ev = sanitized.evidence as Record<string, unknown>;
    expect(ev.title).toBeNull();
    expect(ev.description).toBeNull();
    expect(ev.relatedClaim).toBeNull();
    expect(ev.pastedText).toBeNull();
    expect(ev.evidenceDate).toBeNull();
    expect(ev.externalRef).toBeNull();
    // Safe fields preserved.
    expect(ev.evidenceReference).toBe("0xabc");
    expect(ev.fileHash).toBe("0xfile");
    expect(ev.fileCount).toBe(1);
    expect(ev.availability).toBe("package_available");
    expect(ev.substantiveEvidence).toBe(true);
    expect(ev.caseVersionHash).toBe("0xcase");
    expect(ev.evidenceVersionHash).toBe("0xev");

    const qc = sanitized.qualityCheck as Record<string, unknown>;
    expect(qc.toolId).toBe("evidence-quality-check");
    expect(qc.readiness).toBe("needs_improvement");
    expect(qc.executionRequestHash).toBe("0xreq");
    expect(qc.settlementTxHash).toBe("0xsettle");
    expect(qc.reviewerQuestions).toEqual([]);
    expect(qc.ambiguities).toEqual([]);
    expect(qc.missingEvidence).toEqual([]);
    expect(qc.recommendedImprovements).toEqual([]);
    expect(sanitized.qcInconsistency).toEqual([]);

    // Input is not mutated.
    expect((packet.evidence as Record<string, unknown>).title).toBe("Secret title");
  });

  it("passes through null", () => {
    expect(sanitizeReviewPacketForPublic(null)).toBeNull();
  });
});
