// ---------------------------------------------------------------------------
// /payments/new success state — Payment protected card + share link
// (source asserts; behavior covered by page.test.tsx + SharePaymentLink tests).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildPaymentSharePath } from "@/components/payment/SharePaymentLink";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";

const PAGE_PATH = resolve(__dirname, "..", "page.tsx");

function readPage(): string {
  return readFileSync(PAGE_PATH, "utf-8");
}

describe("/payments/new — success share (P4.3a)", () => {
  it("keeps the Payment protected success state", () => {
    const src = readPage();
    expect(src).toContain("Payment protected");
    expect(src).toContain("Payment ID");
  });

  it("success card shows amount+token, freelancer, network, payment ID", () => {
    const src = readPage();
    const successIdx = src.indexOf("Payment protected");
    const block = src.slice(successIdx, successIdx + 2000);
    expect(block).toContain("{amount}");
    expect(block).toContain("{tokenDisplay}");
    expect(block).toContain("{workerWallet}");
    expect(block).toContain("{networkDisplay}");
    expect(block).toContain("flow.createdPaymentId");
  });

  it("adds a Share with freelancer copy-link button", () => {
    const src = readPage();
    expect(src).toContain("SharePaymentLink");
    expect(src).toContain("chainId={targetChainId}");
  });

  it("validates the share chainId (no unsupported link)", () => {
    const src = readPage();
    expect(src).toContain("isSupportedChain(targetChainId)");
    // Canonical URL for the default new-payment chain validates.
    expect(
      buildPaymentSharePath("9", DEFAULT_NEW_PAYMENT_CHAIN_ID),
    ).toBe(`/payments/9?chainId=${DEFAULT_NEW_PAYMENT_CHAIN_ID}`);
    expect(DEFAULT_NEW_PAYMENT_CHAIN_ID).toBe(42220);
  });

  it("does not hardcode a hostname in the success state", () => {
    const src = readPage();
    const successIdx = src.indexOf("Payment protected");
    const block = src.slice(successIdx, successIdx + 2000);
    expect(block).not.toContain("example.com");
    expect(block).not.toContain("vercel.app");
    expect(block).not.toContain("http://");
    expect(block).not.toContain("https://");
  });
});
