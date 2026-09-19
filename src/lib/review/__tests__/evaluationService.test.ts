// ---------------------------------------------------------------------------
// P6.2 — evaluation service orchestration tests (fixture deps, no network).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  evaluateDeliveryRequest,
  manifestSignalsFor,
  requirementLabelsFor,
  scrubPlaintext,
  type EvaluationServiceDeps,
} from "../evaluationService";
import type { PaymentData } from "@/lib/contracts/types";
import type { DurableEvidenceMetadata } from "@/lib/evidence/reader";

const CLIENT = "0x1111111111111111111111111111111111111111";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const PASTE = "Secret delivery prose that must never leak into the evaluation output text.";

function payment(overrides: Partial<PaymentData> = {}): PaymentData {
  return {
    id: 9n,
    client: CLIENT,
    worker: WORKER,
    token: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    amount: 50_000_000n,
    agreementLabel: "Logo design",
    deliverableSummary: "Logo design files",
    deliveryFormat: "SVG + PNG",
    releaseRule: "buyer-approval",
    evidenceExpectation: "SVG and PNG exports",
    termsHash: "0x00",
    evidenceReference: "0xeeee",
    disputeReference: "",
    deliveryDeadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
    autoReleaseSeconds: 0n,
    disputeWindowSeconds: 86400n,
    state: "DeliverySubmitted",
    createdAt: 1n,
    fundedAt: 2n,
    acceptedAt: 3n,
    deliveryAt: BigInt(Math.floor(Date.now() / 1000) - 100),
    releaseRequestedAt: 0n,
    releasedAt: 0n,
    ...overrides,
  } as PaymentData;
}

function facts(overrides: Partial<DurableEvidenceMetadata> = {}): DurableEvidenceMetadata {
  return {
    evidenceReference: "0xeeee",
    title: "Logo delivery",
    evidenceType: "delivery-file",
    description: "Final logo",
    relatedDeliverable: "Logo",
    externalReference: null,
    fileCount: 1,
    latestUpdateTimestamp: Date.now(),
    substantiveEvidence: true,
    submitterAddress: "chain_verified",
    relatedClaim: "Logo delivery",
    pastedText: PASTE,
    evidenceDate: "2026-09-20",
    externalRef: "",
    fileHash: "0xbeef",
    ...overrides,
  };
}

function deps(overrides: Partial<EvaluationServiceDeps> = {}): EvaluationServiceDeps & {
  gradeWithAI: ReturnType<typeof vi.fn>;
} {
  const gradeWithAI = vi.fn();
  gradeWithAI.mockResolvedValue({
    requirements: [
      { requirement: "Logo design files", status: "satisfied", evidence: "delivery text present" },
      { requirement: "Delivery format: SVG + PNG", status: "satisfied", evidence: "file hash present" },
      { requirement: "SVG and PNG exports", status: "satisfied", evidence: "delivery text present" },
    ],
    summary: "The worker submitted evidence matching 3 of 3 agreed requirements.",
    concerns: [],
    confidence: "high",
  });
  return {
    verifyChallenge: async () => ({ ok: true as const, signer: CLIENT }),
    consumeChallenge: async () => true,
    hashChallenge: (id: string) => `hash:${id}`,
    readPayment: async () => payment(),
    readEvidence: async () => facts(),
    gradeWithAI,
    ...overrides,
  } as EvaluationServiceDeps & {
    gradeWithAI: ReturnType<typeof vi.fn>;
  };
}

const BASE_REQ = {
  paymentId: "9",
  chainId: 42220,
  wallet: CLIENT,
  challengeId: "0x" + "ab".repeat(32),
  signature: "0xsig",
};

describe("P6.2 evaluation service", () => {
  it("fully matching evidence → ready_for_review", async () => {
    const res = await evaluateDeliveryRequest(deps(), BASE_REQ);
    expect(res.status).toBe(200);
    const body = res.body as { available?: boolean; evaluation?: { recommendation?: string } };
    expect(body.available).toBe(true);
    expect(body.evaluation?.recommendation).toBe("ready_for_review");
  });

  it("missing required deliverable → needs_attention", async () => {
    const d = deps();
    d.gradeWithAI.mockResolvedValueOnce({
      requirements: [
        { requirement: "Logo design files", status: "satisfied", evidence: "delivery text present" },
        { requirement: "Delivery format: SVG + PNG", status: "unclear", evidence: "not clearly evidenced" },
        { requirement: "SVG and PNG exports", status: "satisfied", evidence: "delivery text present" },
      ],
      summary: "2 of 3 requirements appear met; the format needs a human look.",
      concerns: ["PNG export not clearly evidenced."],
      confidence: "medium" as const,
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const body = res.body as { evaluation?: { recommendation?: string } };
    expect(body.evaluation?.recommendation).toBe("needs_attention");
  });

  it("no evidence → insufficient_evidence WITHOUT calling AI", async () => {
    const d = deps({
      readPayment: async () => payment({ evidenceReference: "" }),
      readEvidence: async () =>
        facts({
          evidenceReference: null,
          substantiveEvidence: false,
          pastedText: null,
          relatedClaim: null,
          description: null,
          fileHash: null,
          externalRef: null,
          evidenceDate: null,
          fileCount: 0,
        }),
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const body = res.body as { available?: boolean; evaluation?: { recommendation?: string } };
    expect(body.available).toBe(true);
    expect(body.evaluation?.recommendation).toBe("insufficient_evidence");
    expect(d.gradeWithAI).not.toHaveBeenCalled();
  });

  it("ambiguous evidence stays unclear", async () => {
    const d = deps();
    d.gradeWithAI.mockResolvedValueOnce({
      requirements: [
        { requirement: "Logo design files", status: "unclear", evidence: "not clearly evidenced" },
        { requirement: "Delivery format: SVG + PNG", status: "unclear", evidence: "not clearly evidenced" },
        { requirement: "SVG and PNG exports", status: "unclear", evidence: "not clearly evidenced" },
      ],
      summary: "The submission is ambiguous; a human should inspect it.",
      concerns: ["Nothing clearly maps to the agreed deliverables."],
      confidence: "low" as const,
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const body = res.body as { evaluation?: { recommendation?: string; requirements?: Array<{ status?: string }> } };
    expect(body.evaluation?.recommendation).toBe("needs_attention");
    expect(
      body.evaluation?.requirements?.every((r) => r.status === "unclear"),
    ).toBe(true);
  });

  it("late delivery is deterministically identified (model cannot override)", async () => {
    const d = deps({
      readPayment: async () =>
        payment({
          deliveryAt: BigInt(Math.floor(Date.now() / 1000) + 7200),
          deliveryDeadline: BigInt(Math.floor(Date.now() / 1000) - 7200),
        }),
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const body = res.body as {
      evaluation?: { recommendation?: string; deadlineStatus?: string };
    };
    expect(body.evaluation?.deadlineStatus).toBe("late");
    // AI graded everything satisfied, yet lateness caps the recommendation.
    expect(body.evaluation?.recommendation).toBe("needs_attention");
  });

  it("AI grades for unknown labels are dropped; gaps stay unclear", async () => {
    const d = deps();
    d.gradeWithAI.mockResolvedValueOnce({
      requirements: [
        { requirement: "Free bonus work", status: "satisfied", evidence: "imagined" },
      ],
      summary: "All good.",
      concerns: [],
      confidence: "high" as const,
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const body = res.body as {
      evaluation?: { requirements?: Array<{ requirement?: string; status?: string }> };
    };
    const labels = body.evaluation?.requirements?.map((r) => r.requirement) ?? [];
    expect(labels).not.toContain("Free bonus work");
    expect(
      body.evaluation?.requirements?.every((r) => r.status === "unclear"),
    ).toBe(true);
  });

  it("AI unavailable fails honestly (never a silent positive)", async () => {
    const d = deps({ gradeWithAI: async () => null });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    expect(res.body.available).toBe(false);
    expect((res.body as { reason?: string }).reason).toBe("AI_UNAVAILABLE");
  });

  it("anonymous callers get CHALLENGE_REQUIRED (401)", async () => {
    const res = await evaluateDeliveryRequest(deps(), {
      ...BASE_REQ,
      challengeId: "",
      signature: "",
    });
    expect(res.status).toBe(401);
    expect((res.body as { code?: string }).code).toBe("CHALLENGE_REQUIRED");
  });

  it("unrelated wallets are rejected (403 passthrough)", async () => {
    const d = deps({
      verifyChallenge: async () => ({
        ok: false as const,
        code: "NOT_PARTY",
        error: "Not a party.",
        status: 403,
      }),
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    expect(res.status).toBe(403);
  });

  it("non-evaluable states return available:false (never fabricated)", async () => {
    const d = deps({ readPayment: async () => payment({ state: "Accepted" }) });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    expect(res.body.available).toBe(false);
    expect((res.body as { reason?: string }).reason).toBe("INVALID_STATE");
    expect(d.gradeWithAI).not.toHaveBeenCalled();
  });

  it("manual release mode is reported (UI keeps existing flow)", async () => {
    const d = deps({
      readPayment: async () => payment({ releaseRule: "manual" }),
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    expect((res.body as { releaseMode?: string }).releaseMode).toBe("manual");
  });

  it("agent_assisted mode is reported for buyer-approval rules", async () => {
    const res = await evaluateDeliveryRequest(deps(), BASE_REQ);
    expect((res.body as { releaseMode?: string }).releaseMode).toBe("agent_assisted");
  });

  it("public output never exposes plaintext evidence", async () => {
    const d = deps();
    d.gradeWithAI.mockResolvedValueOnce({
      requirements: [
        { requirement: "Logo design files", status: "satisfied", evidence: "delivery text present" },
        { requirement: "Delivery format: SVG + PNG", status: "satisfied", evidence: "file hash present" },
        { requirement: "SVG and PNG exports", status: "satisfied", evidence: "delivery text present" },
      ],
      summary: `Quoting verbatim: ${PASTE} — looks good.`,
      concerns: [],
      confidence: "high" as const,
    });
    const res = await evaluateDeliveryRequest(d, BASE_REQ);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PASTE);
    expect(text).not.toContain("Secret delivery prose");
  });

  it("requirement labels reconstruct from agreement (no invented policy)", () => {
    expect(
      requirementLabelsFor({
        deliverableSummary: "Logo",
        deliveryFormat: "SVG",
        evidenceExpectation: "Exports",
      }),
    ).toEqual(["Logo", "Delivery format: SVG", "Exports"]);
    expect(
      requirementLabelsFor({ deliverableSummary: "", deliveryFormat: "", evidenceExpectation: "" }),
    ).toEqual([]);
  });

  it("manifest signals describe presence, never content", () => {
    const signals = manifestSignalsFor(facts());
    expect(signals).toContain("delivery text present");
    expect(signals.join(" ")).not.toContain(PASTE);
  });

  it("scrubPlaintext redacts long verbatim echoes", () => {
    expect(scrubPlaintext(`See ${PASTE} ok`, [PASTE])).not.toContain(PASTE);
    expect(scrubPlaintext("short and fine", [PASTE])).toBe("short and fine");
  });
});
