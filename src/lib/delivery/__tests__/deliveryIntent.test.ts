// ---------------------------------------------------------------------------
// P6.3 — delivery intent domain tests (mock AI only, never real writes).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  deliveryIntentDraftSchema,
  deliveryPackageSchema,
  buildDeliveryMissingFields,
  buildDeliveryClarifyingQuestion,
  mergeDeliveryDrafts,
  deliveryDraftToPackage,
  deliveryPackageToEvidenceFormData,
  isDeliveryDraftReady,
  DELIVERY_BOUNDARY_MESSAGE,
} from "../deliveryIntent";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const CTX = { paymentId: "42", chainId: 42220 as const, worker: WORKER };

describe("P6.3 delivery intent", () => {
  it("reports all missing fields in priority order", () => {
    expect(buildDeliveryMissingFields({})).toEqual([
      "evidence",
      "title",
      "deliverable",
      "evidenceType",
    ]);
  });

  it("evidence satisfied by references or pastedText", () => {
    expect(
      buildDeliveryMissingFields({
        title: "Landing page delivery",
        references: [{ type: "url", value: "https://example.com" }],
        relatedDeliverable: "Landing page",
        evidenceType: "other",
      }),
    ).toEqual([]);
    expect(
      buildDeliveryMissingFields({
        title: "T",
        pastedText: "some long delivery note text here",
        relatedDeliverable: "X",
        evidenceType: "message",
      }),
    ).toEqual([]);
  });

  it("title blank counts as missing; deliverable needs related or claimed", () => {
    expect(
      buildDeliveryMissingFields({
        title: "   ",
        references: [{ type: "url", value: "https://example.com" }],
        evidenceType: "other",
      }),
    ).toContain("title");
    expect(
      buildDeliveryMissingFields({
        title: "T",
        references: [{ type: "url", value: "https://example.com" }],
        evidenceType: "other",
      }),
    ).toContain("deliverable");
    // claimedDeliverables satisfy deliverable
    expect(
      buildDeliveryMissingFields({
        title: "T",
        references: [{ type: "url", value: "https://example.com" }],
        claimedDeliverables: ["Landing page"],
        evidenceType: "other",
      }),
    ).not.toContain("deliverable");
  });

  it("clarification copy is focused, evidence-first, max 2", () => {
    expect(buildDeliveryClarifyingQuestion([])).toBeNull();
    expect(buildDeliveryClarifyingQuestion(["evidence"])).toBe(
      "Got it — where can the delivery be seen? Paste the live link, repo URL, or a short delivery note.",
    );
    expect(buildDeliveryClarifyingQuestion(["title"])).toBe(
      "What should this delivery be called?",
    );
    expect(buildDeliveryClarifyingQuestion(["deliverable"])).toBe(
      "Which agreed deliverable does this cover?",
    );
    // evidence-first ordering even when input is shuffled
    const q = buildDeliveryClarifyingQuestion([
      "evidenceType",
      "title",
      "evidence",
    ]);
    expect(q).toMatch(/where can the delivery be seen/i);
    // two fields joined, never more than two questions
    expect((q?.match(/\?/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("merge preserves prior fields; non-empty update wins", () => {
    const base = { title: "Landing page delivery", summary: "old" };
    const merged = mergeDeliveryDrafts(base, {
      references: [{ type: "url", value: "https://example.com" }],
    });
    expect(merged.title).toBe("Landing page delivery");
    expect(merged.references?.[0]?.value).toBe("https://example.com");
    // empty update never wipes prior
    const kept = mergeDeliveryDrafts(merged, { title: "   " });
    expect(kept.title).toBe("Landing page delivery");
    // arrays replaced when non-empty
    const replaced = mergeDeliveryDrafts(merged, {
      references: [{ type: "url", value: "https://other.com" }],
    });
    expect(replaced.references?.[0]?.value).toBe("https://other.com");
  });

  it("draftToPackage applies deterministic defaults", () => {
    const { pkg, errors } = deliveryDraftToPackage(
      {
        summary: "Deployed the landing page to staging",
        references: [{ type: "url", value: "https://example.com" }],
        claimedDeliverables: ["Landing page"],
      },
      CTX,
    );
    expect(errors).toEqual([]);
    expect(pkg).not.toBeNull();
    expect(pkg!.title).toMatch(/Landing page/i);
    expect(pkg!.evidenceType).toBe("other");
    expect(pkg!.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pkg!.description).toMatch(/landing page/i);
    expect(pkg!.relatedDeliverable).toBe("Landing page");
    expect(pkg!.paymentId).toBe("42");
    expect(pkg!.chainId).toBe(42220);
    expect(pkg!.worker).toBe(WORKER);
    expect(deliveryPackageSchema.safeParse(pkg).success).toBe(true);
  });

  it("draftToPackage synthesizes a text reference from pastedText only", () => {
    const { pkg, errors } = deliveryDraftToPackage(
      {
        title: "Delivery",
        pastedText: "Here is what I built this week in detail...",
        claimedDeliverables: ["Logo"],
      },
      CTX,
    );
    expect(errors).toEqual([]);
    expect(pkg!.references.length).toBe(1);
    expect(pkg!.references[0]?.type).toBe("text");
  });

  it("draftToPackage fails honestly with no evidence or bad ctx", () => {
    const noEvidence = deliveryDraftToPackage({ title: "T" }, CTX);
    expect(noEvidence.pkg).toBeNull();
    expect(noEvidence.errors.length).toBeGreaterThan(0);
    const badType = deliveryDraftToPackage(
      {
        title: "T",
        references: [{ type: "url", value: "https://example.com" }],
        evidenceType: "not-a-type",
      },
      CTX,
    );
    expect(badType.pkg).toBeNull();
    // ctx comes only from caller — invalid ctx never yields a package
    const badCtx = deliveryDraftToPackage(
      {
        title: "T",
        references: [{ type: "url", value: "https://example.com" }],
      },
      { paymentId: "abc", chainId: 42220, worker: WORKER },
    );
    expect(badCtx.pkg).toBeNull();
  });

  it("isDeliveryDraftReady requires full validation", () => {
    expect(isDeliveryDraftReady({})).toBe(false);
    expect(
      isDeliveryDraftReady({
        title: "Landing page delivery",
        references: [{ type: "url", value: "https://example.com" }],
        relatedDeliverable: "Landing page",
        evidenceType: "other",
      }),
    ).toBe(true);
  });

  it("package maps to EvidenceFormData (single manifest vocabulary)", () => {
    const { pkg } = deliveryDraftToPackage(
      {
        title: "Landing page delivery",
        description: "Shipped",
        references: [
          { type: "url", value: "https://example.com/live" },
          { type: "repository", value: "https://github.com/acme/site" },
          { type: "text", value: "extra note", label: "Note" },
        ],
        pastedText: "Built the page",
        relatedDeliverable: "Landing page",
        deliveryDate: "2026-09-01",
        evidenceType: "message",
      },
      CTX,
    );
    expect(pkg).not.toBeNull();
    const form = deliveryPackageToEvidenceFormData(pkg!);
    expect(form.title).toBe("Landing page delivery");
    expect(form.type).toBe("message");
    expect(form.relatedClaim).toBe("Landing page");
    expect(form.date).toBe("2026-09-01");
    // primary URL → externalRef
    expect(form.externalRef).toBe("https://example.com/live");
    // extra refs appended to pastedText
    expect(form.pastedText).toMatch(/Built the page/);
    expect(form.pastedText).toMatch(/github\.com\/acme\/site/);
    expect(form.pastedText.length).toBeLessThanOrEqual(4000);
    expect(form.fileHash).toBe("");
    expect(deliveryIntentDraftSchema.safeParse({}).success).toBe(true);
  });

  it("defines a delivery boundary (not a generic chatbot)", () => {
    expect(DELIVERY_BOUNDARY_MESSAGE).toMatch(/delivery evidence/i);
  });
});
