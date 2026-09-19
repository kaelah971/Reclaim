// ---------------------------------------------------------------------------
// P6.4D — natural-language evidence-type mapping tests (mock AI only).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDelivery, inferEvidenceType } from "../parseDelivery";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function ctx(
  over: Partial<Parameters<typeof parseDelivery>[0]["paymentContext"]> = {},
) {
  return {
    paymentId: "7",
    chainId: 42220,
    worker: WORKER,
    deliverables: ["Landing page design"],
    evidenceRequirements: ["Live URL"],
    agreementLabel: "Landing page job",
    ...over,
  };
}

describe("P6.4D natural-language evidence type mapping", () => {
  it("maps 'This is a delivery note.' to message", async () => {
    const res = await parseDelivery({
      message: "This is a delivery note.",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("message");
    expect(inferEvidenceType("This is a delivery note.")).toBe("message");
  });

  it("maps 'This is a text note.' to message (follow-up path)", async () => {
    // Bare "This is a text note." has no delivery keyword, so exercise it
    // as a follow-up fill (priorDraft + nonSpaceLen≥12 counts as in-domain).
    const first = await parseDelivery({
      message: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(first.rejected).toBe(false);
    const res = await parseDelivery({
      message: "This is a text note.",
      priorDraft: first.draft,
      priorMessagesText: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("message");
  });

  it("maps 'Attached file' to delivery-file while keeping file-claim guidance", async () => {
    const res = await parseDelivery({
      message: "Attached file",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("delivery-file");
    // Type inference must NOT clear the file-claim guidance error:
    // "evidence" vs "evidenceType" are separate missing fields.
    expect(res.missingFields).toContain("evidence");
    expect(res.errors.join(" ")).toMatch(/attach it via add evidence/i);
    expect(res.draft.references ?? []).toEqual([]);
    expect(res.ready).toBe(false);
  });

  it("claimed-but-unprovided file keeps evidence missing even with inferred type", async () => {
    const res = await parseDelivery({
      message: "I attached the final files for the landing page design",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.draft.evidenceType).toBe("delivery-file");
    expect(res.missingFields).toContain("evidence");
    expect(res.errors.join(" ")).toMatch(/attach it via add evidence/i);
    expect(res.ready).toBe(false);
  });

  it("maps revision record phrasing to revision-record", async () => {
    const res = await parseDelivery({
      message: "Done — revision record: fixed the logo spacing",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("revision-record");
  });

  it("maps agreement reference phrasing to agreement-reference", async () => {
    const res = await parseDelivery({
      message: "Done — agreement reference: covers the Logo deliverable",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("agreement-reference");
  });

  it("maps payment reference phrasing to payment-reference", async () => {
    const res = await parseDelivery({
      message: "Done — payment reference: Payment #3 covers the Logo",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("payment-reference");
  });

  it("ambiguous dual-category phrase stays undefined", async () => {
    const res = await parseDelivery({
      message: "Done — payment reference and agreement for the logo",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBeUndefined();
    expect(res.missingFields).toContain("evidenceType");
    expect(
      inferEvidenceType("Done — payment reference and agreement for the logo"),
    ).toBeUndefined();
  });

  it("ambiguous bare evidence stays undefined", async () => {
    const first = await parseDelivery({
      message: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    const res = await parseDelivery({
      message: "Here is the evidence",
      priorDraft: first.draft,
      priorMessagesText: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBeUndefined();
    expect(res.missingFields).toContain("evidenceType");
    expect(inferEvidenceType("Here is the evidence")).toBeUndefined();
  });

  it("bare note alone is too weak to infer", () => {
    expect(inferEvidenceType("Note")).toBeUndefined();
    expect(inferEvidenceType("Here is a note")).toBeUndefined();
    expect(inferEvidenceType("Evidence note")).toBeUndefined();
  });

  it("unrelated prose never guesses a type", () => {
    expect(inferEvidenceType("The weather is nice today")).toBeUndefined();
    expect(
      inferEvidenceType("Done — the landing page is live, please review"),
    ).toBeUndefined();
  });

  it("follow-up merge preserves prior fields while filling evidenceType", async () => {
    const first = await parseDelivery({
      message: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(first.rejected).toBe(false);
    const res = await parseDelivery({
      message: "This is a delivery note.",
      priorDraft: first.draft,
      priorMessagesText: "Done — I completed the logo.",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.draft.evidenceType).toBe("message");
    expect(res.draft.title).toBeDefined();
    expect(res.draft.summary).toBeDefined();
    // Prior deliverable grounding is preserved through the merge.
    expect(
      res.draft.relatedDeliverable ?? res.draft.claimedDeliverables?.[0],
    ).toBeDefined();
    if (first.draft.relatedDeliverable) {
      expect(res.draft.relatedDeliverable).toBe(
        first.draft.relatedDeliverable,
      );
    }
    if (first.draft.claimedDeliverables?.length) {
      expect(res.draft.claimedDeliverables).toEqual(
        first.draft.claimedDeliverables,
      );
    }
  });

  it("Payment #3 exact scenario: follow-up delivery note fills message type", async () => {
    const paymentCtx = ctx({
      deliverables: ["Logo"],
      evidenceRequirements: [],
    });
    const initialMsg =
      "Done — I completed the logo. This delivery covers the Logo deliverable. Evidence note: Payment #3 Mainnet E2E logo delivery completed.";
    const first = await parseDelivery({
      message: initialMsg,
      paymentContext: paymentCtx,
      aiEnrich: null,
    });
    expect(first.rejected).toBe(false);
    const second = await parseDelivery({
      message: "This is a delivery note.",
      priorDraft: first.draft,
      priorMessagesText: initialMsg,
      paymentContext: paymentCtx,
      aiEnrich: null,
    });
    expect(second.draft.evidenceType).toBe("message");
    expect(second.draft.title).toBeDefined();
    expect(second.draft.summary).toBeDefined();
    // Prior deliverable context is preserved; assert only on type +
    // preservation (ready may still require evidence refs).
    expect(second.missingFields).not.toContain("evidenceType");
    if (first.draft.relatedDeliverable) {
      expect(second.draft.relatedDeliverable).toBe(
        first.draft.relatedDeliverable,
      );
    }
  });

  it("deterministic evidenceType wins over AI", async () => {
    const aiTriesOverride = async () => ({
      evidenceType: "delivery-file",
      summary: "This is a delivery note.",
    });
    const res = await parseDelivery({
      message: "This is a delivery note.",
      paymentContext: ctx(),
      aiEnrich: aiTriesOverride,
    });
    expect(res.draft.evidenceType).toBe("message");
  });

  it("AI may still fill evidenceType when deterministic found nothing", async () => {
    const aiFills = async () => ({
      evidenceType: "message",
      summary: "Done — logo completed",
    });
    const res = await parseDelivery({
      message: "Done — logo completed https://example.com/live",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: aiFills,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.evidenceType).toBe("message");
  });

  it("no parser path invokes a blockchain write", () => {
    const parser = readFileSync(
      resolve(__dirname, "../parseDelivery.ts"),
      "utf-8",
    );
    expect(parser).not.toContain("writeContract");
    expect(parser).not.toContain("simulateContract");
    expect(parser).not.toContain("sendTransaction");
    const enricher = readFileSync(
      resolve(__dirname, "../aiDeliveryEnricher.ts"),
      "utf-8",
    );
    expect(enricher).not.toContain("writeContract");
    expect(enricher).not.toContain("simulateContract");
    expect(enricher).not.toContain("sendTransaction");
  });
});
