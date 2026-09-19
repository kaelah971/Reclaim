// ---------------------------------------------------------------------------
// P6.4B — command grounding hardening tests (mock AI only, never real writes).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parsePaymentCommand } from "../parseCommand";
import { draftToPolicy } from "../paymentIntent";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function futureFriday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  let delta = (5 - day + 7) % 7;
  if (delta === 0) delta = 7;
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta));
  return t.toISOString().slice(0, 10);
}

function tomorrowISO(): string {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return t.toISOString().slice(0, 10);
}

describe("P6.4B command grounding hardening", () => {
  it("1. deterministic logo without formats → exactly [Logo], no invention", async () => {
    const res = await parsePaymentCommand({
      message: `Protect 10 USA₮ for ${WORKER} to deliver a logo by Friday.`,
      aiEnrich: null,
    });
    expect(res.draft.deliverables).toEqual(["Logo"]);
    const joined = (res.draft.deliverables ?? []).join(" ").toLowerCase();
    expect(joined).not.toContain("svg");
    expect(joined).not.toContain("png");
    const { policy } = draftToPolicy(res.draft);
    if (policy) {
      expect(policy.deliverableSummary.toLowerCase()).not.toContain("svg");
      expect(policy.deliverableSummary.toLowerCase()).not.toContain("png");
    }
  });

  it("2. explicit SVG and PNG are preserved when stated", async () => {
    const res = await parsePaymentCommand({
      message: `Protect 10 USA₮ for ${WORKER} to deliver SVG and PNG logo files by Friday.`,
      aiEnrich: null,
    });
    const joined = (res.draft.deliverables ?? []).join(" ");
    expect(joined).toMatch(/SVG/i);
    expect(joined).toMatch(/PNG/i);
  });

  it("3. temporal + release clauses stripped from purpose, deadline + release kept", async () => {
    const res = await parsePaymentCommand({
      message: "Protect 0.01 USA₮ for a designer to deliver a logo tomorrow. Ask me before releasing.",
      aiEnrich: null,
    });
    expect(res.draft.deadlineDate).toBe(tomorrowISO());
    expect(res.draft.releaseMode).toBe("manual");
    expect(res.draft.purpose ?? "").not.toMatch(/tomorrow/i);
    expect(res.draft.purpose ?? "").not.toMatch(/releas/i);
    expect(res.draft.purpose ?? "").not.toMatch(/ask me/i);
    expect(res.draft.purpose).toMatch(/logo/i);
  });

  it("4. AI-invented deliverable formats are dropped", async () => {
    const inventingEnricher = async () => ({
      deliverables: ["Logo (SVG + PNG + Figma)"],
    });
    const res = await parsePaymentCommand({
      message: `Protect 10 USA₮ for ${WORKER} to deliver a logo by Friday.`,
      aiEnrich: inventingEnricher,
    });
    const joined = (res.draft.deliverables ?? []).join(" ").toLowerCase();
    expect(joined).not.toContain("svg");
    expect(joined).not.toContain("png");
    expect(joined).not.toContain("figma");
  });

  it("5. AI-invented evidence requirements are dropped", async () => {
    const inventingEnricher = async () => ({
      evidenceRequirements: ["Notarized audit + video walkthrough"],
    });
    const res = await parsePaymentCommand({
      message: `Protect 10 USA₮ for ${WORKER} to deliver a logo by Friday.`,
      aiEnrich: inventingEnricher,
    });
    const ev = res.draft.evidenceRequirements;
    if (ev !== undefined) {
      const joined = ev.join(" ").toLowerCase();
      expect(joined).not.toContain("notarized");
      expect(joined).not.toContain("audit");
      expect(joined).not.toContain("video");
    } else {
      expect(ev).toBeUndefined();
    }
  });

  it("6. AI-invented review/approval/escalation dropped when ungrounded", async () => {
    const inventingEnricher = async () => ({
      reviewWindow: "7 days",
      approvalThreshold: "2-of-3",
      escalationPolicy: "escalate to DAO",
    });
    const res = await parsePaymentCommand({
      message: `Protect 10 USA₮ for ${WORKER} to deliver a logo by Friday.`,
      aiEnrich: inventingEnricher,
    });
    expect(res.draft.reviewWindow).toBeUndefined();
    expect(res.draft.approvalThreshold).toBeUndefined();
    expect(res.draft.escalationPolicy).toBeUndefined();
  });

  it("7. follow-up fills recipient without losing grounded context", async () => {
    const logoEnricher = async () => ({
      purpose: "Logo design",
    });
    const first = await parsePaymentCommand({
      message: "Protect 50 USA₮ to design a logo by Friday.",
      aiEnrich: logoEnricher,
    });
    expect(first.missingFields).toContain("recipient");
    const second = await parsePaymentCommand({
      message: WORKER,
      priorDraft: first.draft,
      priorMessagesText: "Protect 50 USA₮ to design a logo by Friday.",
      aiEnrich: logoEnricher,
    });
    expect(second.draft.recipient).toBe(WORKER);
    expect(second.draft.amount).toBe("50");
    expect(second.draft.purpose).toMatch(/logo/i);
    expect(second.draft.deadlineDate).toBe(futureFriday());
    expect(second.ready).toBe(true);
  });

  it("8. ready card has word-boundary title/summary (no mid-word cut)", async () => {
    const groundedEnricher = async () => ({
      purpose: "Logo design",
      jobType: "design",
      deliverables: ["Logo"],
      releaseMode: "manual" as const,
    });
    const res = await parsePaymentCommand({
      message: `Protect 50 USA₮ for ${WORKER} to design a logo by Friday. Ask me before releasing.`,
      aiEnrich: groundedEnricher,
    });
    expect(res.ready).toBe(true);
    const { policy } = draftToPolicy(res.draft);
    expect(policy).not.toBeNull();
    const purpose = res.draft.purpose ?? "";
    for (const s of [policy!.title, policy!.deliverableSummary]) {
      expect(s.length).toBeLessThanOrEqual(32);
      if (purpose.length > 0 && purpose.startsWith(s) && s.length < purpose.length) {
        // Cut must land on a word boundary (next char is a space).
        expect(purpose[s.length]).toBe(" ");
      }
    }
  });

  it("9. draftToPolicy truncates long purpose at word boundary", async () => {
    const purpose = "deliver an extraordinary logo design package";
    expect(purpose.length).toBeGreaterThan(32);
    const { policy } = draftToPolicy({
      recipient: WORKER,
      amount: "10",
      asset: "USA₮",
      purpose,
      deliverables: [purpose],
      deadlineDate: futureFriday(),
      releaseMode: "manual",
    });
    expect(policy).not.toBeNull();
    expect(policy!.title.length).toBeLessThanOrEqual(32);
    // Title must be a word-boundary prefix of the purpose.
    expect(purpose.startsWith(policy!.title)).toBe(true);
    if (policy!.title.length < purpose.length) {
      expect(purpose[policy!.title.length]).toBe(" ");
    }
    expect(policy!.deliverableSummary.length).toBeLessThanOrEqual(32);
  });
});
