// ---------------------------------------------------------------------------
// P6.3 — delivery parser tests (mock AI only, never real writes).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDelivery } from "../parseDelivery";
import { DELIVERY_BOUNDARY_MESSAGE } from "../deliveryIntent";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function ctx(over: Partial<Parameters<typeof parseDelivery>[0]["paymentContext"]> = {}) {
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

describe("P6.3 delivery parser", () => {
  it("extracts a URL without invention", async () => {
    const res = await parseDelivery({
      message: "Done! Here is the delivery https://example.com/live.",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.references?.[0]?.value).toBe(
      "https://example.com/live",
    );
    expect(res.draft.externalRef).toBe("https://example.com/live");
  });

  it("classifies github as repository, figma/deployment as generic url", async () => {
    const gh = await parseDelivery({
      message: "Done, repo here https://github.com/acme/site is ready",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(gh.draft.references?.[0]?.type).toBe("repository");
    const figma = await parseDelivery({
      message:
        "Done, figma here https://figma.com/file/abc123 is ready for review now",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(figma.draft.references?.[0]?.type).toBe("url");
  });

  it("missing required reference asks for evidence", async () => {
    const res = await parseDelivery({
      message: "Logo done",
      paymentContext: ctx({
        deliverables: ["Logo"],
        evidenceRequirements: [],
      }),
      aiEnrich: null,
    });
    expect(res.missingFields).toContain("evidence");
    expect(res.clarifyingQuestion).toMatch(/where can the delivery be seen/i);
    expect(res.ready).toBe(false);
  });

  it("claimed-but-unprovided file stays unclear with guidance", async () => {
    const res = await parseDelivery({
      message: "I attached the final files for the landing page design",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.missingFields).toContain("evidence");
    expect(res.errors.join(" ")).toMatch(/attach it via add evidence/i);
    expect(res.ready).toBe(false);
    // file mention alone never synthesizes a reference
    expect(res.draft.references ?? []).toEqual([]);
  });

  it("model-invented URL is rejected, never persisted", async () => {
    const lying = async () => ({
      references: [
        { type: "url" as const, value: "https://evil.example/phish" },
      ],
      summary: "Delivered",
    });
    const res = await parseDelivery({
      message: "The landing page design is done, see my note above",
      paymentContext: ctx(),
      aiEnrich: lying,
    });
    const values = (res.draft.references ?? []).map((r) => r.value);
    expect(values).not.toContain("https://evil.example/phish");
  });

  it("unrelated prompt rejected with boundary", async () => {
    const res = await parseDelivery({
      message: "What is the weather today?",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.rejected).toBe(true);
    expect(res.boundaryMessage).toBe(DELIVERY_BOUNDARY_MESSAGE);
  });

  it("parser cannot alter worker/chain — ctx always wins", async () => {
    const sneaky = async () => ({
      worker: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      references: [{ type: "url", value: "https://example.com/live" }],
      summary: "Done",
    });
    const res = await parseDelivery({
      message: "Done! Delivery here https://example.com/live for review",
      paymentContext: ctx(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiEnrich: sneaky as any,
    });
    expect(res.draft.references?.[0]?.value).toBe(
      "https://example.com/live",
    );
    // draft carries no payment/chain/worker authority at all
    expect(res.draft).not.toHaveProperty("worker");
    expect(res.draft).not.toHaveProperty("chainId");
    expect(res.draft).not.toHaveProperty("paymentId");
  });

  it("matched deliverable grounds the title and related field", async () => {
    const res = await parseDelivery({
      message: "Landing page design is done — https://example.com/live",
      paymentContext: ctx(),
      aiEnrich: null,
    });
    expect(res.draft.claimedDeliverables).toContain("Landing page design");
    expect(res.draft.relatedDeliverable).toBe("Landing page design");
  });

  it("AI unavailable fails honestly with deterministic draft", async () => {
    const failing = async () => {
      throw { code: "NO_API_KEY" };
    };
    const res = await parseDelivery({
      message: "Done! Delivery https://example.com/live is ready",
      paymentContext: ctx(),
      aiEnrich: failing,
    });
    expect(res.aiUnavailable).toBe(true);
    expect(res.ready).toBe(false);
    expect(res.draft.references?.[0]?.value).toBe(
      "https://example.com/live",
    );
  });

  it("no parser path invokes a blockchain write", () => {
    const parser = readFileSync(resolve(__dirname, "../parseDelivery.ts"), "utf-8");
    expect(parser).not.toContain("writeContract");
    expect(parser).not.toContain("simulateContract");
    expect(parser).not.toContain("sendTransaction");
    const intent = readFileSync(
      resolve(__dirname, "../deliveryIntent.ts"),
      "utf-8",
    );
    expect(intent).not.toContain("writeContract");
    const enricher = readFileSync(
      resolve(__dirname, "../aiDeliveryEnricher.ts"),
      "utf-8",
    );
    expect(enricher).not.toContain("writeContract");
  });
});
