// ---------------------------------------------------------------------------
// P4.5F — production copy regression tests.
//
// Proves: primary production footer no longer USDC-only; legitimate
// x402/Sepolia USDC copy remains unchanged.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, "../../../../", rel), "utf-8");
}

describe("P4.5F production copy", () => {
  it("primary production footer no longer describes the product as USDC-only", () => {
    const footer = readSrc("src/components/layout/Footer.tsx");
    const flat = footer.replace(/\s+/g, " ");
    expect(flat).toContain(
      "Protected stablecoin payments for clients and independent digital workers.",
    );
    expect(footer).not.toContain("Protected USDC payments");
    expect(footer).toContain("Celo");
    expect(footer).toContain("USA₮");
    expect(footer).toContain("x402 agentic payments");
    expect(footer).not.toContain("USDC stablecoin");
  });

  it("legitimate x402/Sepolia USDC copy remains unchanged", () => {
    // x402 dispute brief is genuinely USDC-priced.
    const dispute = readSrc(
      "src/app/(product)/payments/[paymentId]/dispute/page.tsx",
    );
    expect(dispute).toContain("$0.01 USDC");

    // Sepolia escrow token copy is genuinely USDC.
    const tokens = readSrc("src/lib/web3/tokens.ts");
    expect(tokens).toContain("USDC");

    // x402 settlement tests pin USDC separation from Mainnet USA₮.
    const safety = readSrc("src/lib/x402/__tests__/p2dPaymentSafety.test.ts");
    expect(safety).toContain("USDC");
  });
});
