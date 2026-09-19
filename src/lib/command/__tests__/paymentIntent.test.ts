// ---------------------------------------------------------------------------
// P6.1 — PaymentIntent/PaymentPolicy domain model tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  paymentIntentDraftSchema,
  paymentPolicySchema,
  canonicalizeAsset,
  isUnsupportedAssetToken,
  resolveCommandChainId,
  validateCommandAmount,
  isValidFutureDeadline,
  buildMissingFields,
  buildClarifyingQuestion,
  draftToPolicy,
  isDraftReady,
  mergeDrafts,
  releaseModeToRule,
  COMMAND_DEFAULT_CHAIN_ID,
  COMMAND_BOUNDARY_MESSAGE,
} from "../paymentIntent";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function futureDate(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

describe("P6.1 payment intent schema", () => {
  it("uses canonical Celo Mainnet default with USA₮", () => {
    expect(COMMAND_DEFAULT_CHAIN_ID).toBe(42220);
    expect(canonicalizeAsset("USA₮", 42220)).toBe("USA₮");
    expect(canonicalizeAsset("USAT", 42220)).toBe("USA₮");
    expect(canonicalizeAsset("USDC", 11142220)).toBe("USDC");
  });

  it("validates recipient addresses (no invented wallets)", () => {
    expect(
      paymentIntentDraftSchema.safeParse({ recipient: WORKER }).success,
    ).toBe(true);
    expect(
      paymentIntentDraftSchema.safeParse({ recipient: "0x123" }).success,
    ).toBe(false);
    expect(
      paymentIntentDraftSchema.safeParse({
        recipient: "0x0000000000000000000000000000000000000000",
      }).success,
    ).toBe(false);
  });

  it("validates amounts against 6 decimals", () => {
    expect(validateCommandAmount("50", 42220)?.raw).toBe(50_000_000n);
    expect(validateCommandAmount("0", 42220)).toBeNull();
    expect(validateCommandAmount("-5", 42220)).toBeNull();
    expect(validateCommandAmount("1.1234567", 42220)).toBeNull();
    expect(validateCommandAmount("abc", 42220)).toBeNull();
  });

  it("validates deadlines (future only)", () => {
    expect(isValidFutureDeadline(futureDate())).toBe(true);
    expect(isValidFutureDeadline("2000-01-01")).toBe(false);
    expect(isValidFutureDeadline("not-a-date")).toBe(false);
    expect(isValidFutureDeadline(undefined)).toBe(false);
  });

  it("rejects unsupported chains/assets", () => {
    expect(resolveCommandChainId(1)).toBeNull();
    expect(resolveCommandChainId(8453)).toBeNull();
    expect(resolveCommandChainId(42220)).toBe(42220);
    expect(resolveCommandChainId(undefined)).toBe(42220);
    expect(canonicalizeAsset("ETH", 42220)).toBeNull();
    expect(canonicalizeAsset("DAI", 42220)).toBeNull();
    expect(isUnsupportedAssetToken("ETH")).toBe(true);
    expect(isUnsupportedAssetToken("USA₮")).toBe(false);
  });

  it("keeps ambiguous financial fields missing rather than guessing", () => {
    const missing = buildMissingFields({});
    expect(missing).toContain("recipient");
    expect(missing).toContain("amount");
    expect(missing).toContain("deadline");
    expect(buildClarifyingQuestion(missing)).toMatch(/wallet/i);
  });

  it("builds a validated policy only from real values", () => {
    const { policy, missing, errors } = draftToPolicy({
      recipient: WORKER,
      amount: "50",
      asset: "USA₮",
      purpose: "Logo design",
      deliverables: ["SVG + PNG"],
      deadlineDate: futureDate(),
      releaseMode: "manual",
      chainId: 42220,
    });
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    expect(policy).not.toBeNull();
    expect(policy!.worker).toBe(WORKER);
    expect(policy!.amountRaw).toBe("50000000");
    expect(policy!.asset).toBe("USA₮");
    expect(policy!.chainId).toBe(42220);
    expect(paymentPolicySchema.safeParse(policy).success).toBe(true);
    expect(isDraftReady({
      recipient: WORKER,
      amount: "50",
      asset: "USA₮",
      purpose: "Logo",
      deadlineDate: futureDate(),
    })).toBe(true);
  });

  it("never produces a policy from invented data", () => {
    const { policy } = draftToPolicy({ purpose: "Logo" });
    expect(policy).toBeNull();
    expect(isDraftReady({ purpose: "Logo" })).toBe(false);
  });

  it("maps release modes without executable autopilot", () => {
    expect(releaseModeToRule("manual")).toBe("manual");
    expect(releaseModeToRule("agent_assisted")).toBe("buyer-approval");
  });

  it("merges follow-ups without losing prior context", () => {
    const base = { amount: "50", asset: "USA₮", purpose: "Logo" };
    const merged = mergeDrafts(base, { recipient: WORKER });
    expect(merged.amount).toBe("50");
    expect(merged.recipient).toBe(WORKER);
    expect(merged.purpose).toBe("Logo");
  });

  it("defines a domain boundary (not a generic chatbot)", () => {
    expect(COMMAND_BOUNDARY_MESSAGE).toMatch(/protected work payments/i);
  });
});
