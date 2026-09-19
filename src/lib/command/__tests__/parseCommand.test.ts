// ---------------------------------------------------------------------------
// P6.1 — command parser tests (mock AI only, never real writes).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parsePaymentCommand } from "../parseCommand";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function futureFriday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  let delta = (5 - day + 7) % 7;
  if (delta === 0) delta = 7;
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta));
  return t.toISOString().slice(0, 10);
}

/** Mock AI: semantic enrichment only, never financial facts. */
async function mockEnricher(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("logo")) {
    return {
      purpose: "Logo design",
      jobType: "design",
      deliverables: ["Logo design files (SVG + PNG)"],
    };
  }
  if (lower.includes("landing")) {
    return {
      purpose: "Landing page",
      jobType: "development",
      deliverables: ["Landing page delivery"],
    };
  }
  return {};
}

describe("P6.1 command parser", () => {
  it("complete command → structured draft", async () => {
    const res = await parsePaymentCommand({
      message: `Protect 50 USA₮ for ${WORKER} to design a logo by Friday. Ask me before releasing.`,
      aiEnrich: mockEnricher,
    });
    expect(res.rejected).toBe(false);
    expect(res.draft.amount).toBe("50");
    expect(res.draft.asset).toBe("USA₮");
    expect(res.draft.recipient).toBe(WORKER);
    expect(res.draft.releaseMode).toBe("manual");
    expect(res.draft.deadlineDate).toBe(futureFriday());
    expect(res.ready).toBe(true);
    expect(res.missingFields).toEqual([]);
    expect(res.clarifyingQuestion).toBeNull();
  });

  it("missing recipient → clarification (address never invented)", async () => {
    const res = await parsePaymentCommand({
      message: "Protect 50 USA₮ to design a logo by Friday.",
      aiEnrich: mockEnricher,
    });
    expect(res.draft.recipient).toBeUndefined();
    expect(res.missingFields).toContain("recipient");
    expect(res.clarifyingQuestion).toMatch(/wallet/i);
    expect(res.ready).toBe(false);
  });

  it("missing amount → clarification", async () => {
    const res = await parsePaymentCommand({
      message: `Protect USA₮ for ${WORKER} to design a logo by Friday.`,
      aiEnrich: mockEnricher,
    });
    expect(res.missingFields).toContain("amount");
    expect(res.ready).toBe(false);
  });

  it("ambiguous amount is NOT guessed", async () => {
    const res = await parsePaymentCommand({
      message: `Protect 50 or 60 USA₮ for ${WORKER} to design a logo.`,
      aiEnrich: mockEnricher,
    });
    expect(res.draft.amount).toBeUndefined();
    expect(res.missingFields).toContain("amount");
    expect(res.ready).toBe(false);
  });

  it("invalid address rejected", async () => {
    const res = await parsePaymentCommand({
      message: "Protect 50 USA₮ for 0x123 to design a logo by Friday.",
      aiEnrich: mockEnricher,
    });
    expect(res.draft.recipient).toBeUndefined();
    expect(res.errors.join(" ")).toMatch(/invalid recipient/i);
  });

  it("unsupported token rejected", async () => {
    const res = await parsePaymentCommand({
      message: `Protect 50 ETH for ${WORKER} to design a logo by Friday.`,
      aiEnrich: mockEnricher,
    });
    expect(res.draft.asset).toBeUndefined();
    expect(res.errors.join(" ")).toMatch(/unsupported asset/i);
    expect(res.ready).toBe(false);
  });

  it("unrelated/generic prompt rejected with boundary", async () => {
    const res = await parsePaymentCommand({
      message: "What is the weather today?",
      aiEnrich: mockEnricher,
    });
    expect(res.rejected).toBe(true);
    expect(res.boundaryMessage).toMatch(/protected work payments/i);
  });

  it("follow-up fills missing field without losing prior context", async () => {
    const first = await parsePaymentCommand({
      message: "Protect 50 USA₮ to design a logo by Friday.",
      aiEnrich: mockEnricher,
    });
    expect(first.missingFields).toContain("recipient");
    const second = await parsePaymentCommand({
      message: WORKER,
      priorDraft: first.draft,
      priorMessagesText: "Protect 50 USA₮ to design a logo by Friday.",
      aiEnrich: mockEnricher,
    });
    expect(second.draft.recipient).toBe(WORKER);
    expect(second.draft.amount).toBe("50");
    expect(second.draft.purpose).toMatch(/logo/i);
  });

  it("AI critical fields without grounding are dropped", async () => {
    const lyingEnricher = async () => ({
      recipient: "0x1111111111111111111111111111111111111111",
      amount: "9999",
      asset: "USA₮",
    });
    const res = await parsePaymentCommand({
      message: "Protect a logo design.",
      aiEnrich: lyingEnricher,
    });
    expect(res.draft.recipient).toBeUndefined();
    expect(res.draft.amount).toBeUndefined();
  });

  it("AI unavailable fails honestly", async () => {
    const failing = async () => {
      throw { code: "NO_API_KEY" };
    };
    const res = await parsePaymentCommand({
      message: `Protect 50 USA₮ for ${WORKER}.`,
      aiEnrich: failing,
    });
    expect(res.aiUnavailable).toBe(true);
    expect(res.ready).toBe(false);
  });

  it("no parser path invokes a blockchain write", () => {
    const parser = readFileSync(
      resolve(__dirname, "../parseCommand.ts"),
      "utf-8",
    );
    expect(parser).not.toContain("writeContract");
    expect(parser).not.toContain("simulateContract");
    expect(parser).not.toContain("sendTransaction");
    const route = readFileSync(
      resolve(__dirname, "../../../app/api/command/parse/route.ts"),
      "utf-8",
    );
    expect(route).not.toContain("writeContract");
    const intent = readFileSync(
      resolve(__dirname, "../paymentIntent.ts"),
      "utf-8",
    );
    expect(intent).not.toContain("writeContract");
  });

  it("uses canonical Mainnet/USA₮ config", () => {
    const intent = readFileSync(
      resolve(__dirname, "../paymentIntent.ts"),
      "utf-8",
    );
    expect(intent).toContain("COMMAND_DEFAULT_CHAIN_ID = CELO_MAINNET_CHAIN_ID");
    expect(intent).toContain("USA₮");
  });
});
