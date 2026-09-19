// ---------------------------------------------------------------------------
// P4.5F — canonical chain-aware route helper regression tests.
//
// Proves Mainnet 42220 / explicit Sepolia preserved, unsupported fails closed,
// no silent Mainnet → Sepolia fallback. Fixture shapes only (no Payment #2).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseChainIdParam,
  buildChainQuery,
  buildPaymentPath,
  buildReceiptPath,
  buildEvidencePath,
  buildDisputePath,
  buildReviewPath,
  buildAgentPath,
} from "../paymentLifecycle";

describe("P4.5F chain routing — canonical helper", () => {
  it("create/fund success preserves chainId=42220", () => {
    expect(buildPaymentPath("2", 42220)).toBe("/payments/2?chainId=42220");
    expect(buildPaymentPath(2n, 42220)).toBe("/payments/2?chainId=42220");
  });

  it("evidence route/submit preserves chainId", () => {
    expect(buildEvidencePath("2", 42220)).toBe(
      "/payments/2/evidence?chainId=42220",
    );
    expect(buildEvidencePath("2", 11142220)).toBe(
      "/payments/2/evidence?chainId=11142220",
    );
  });

  it("receipt link preserves chainId", () => {
    expect(buildReceiptPath("2", 42220)).toBe("/receipts/2?chainId=42220");
    expect(buildReceiptPath("2", 11142220)).toBe(
      "/receipts/2?chainId=11142220",
    );
  });

  it("dispute/review/agent links preserve chain", () => {
    expect(buildDisputePath("2", 42220)).toBe(
      "/payments/2/dispute?chainId=42220",
    );
    expect(buildReviewPath("2", 42220)).toBe(
      "/payments/2/review?chainId=42220",
    );
    expect(buildAgentPath("2", 42220)).toBe("/payments/2/agent?chainId=42220");
  });

  it("Sepolia preserves its explicit chain", () => {
    expect(buildPaymentPath("7", 11142220)).toBe(
      "/payments/7?chainId=11142220",
    );
    expect(buildReceiptPath("7", 11142220)).toBe(
      "/receipts/7?chainId=11142220",
    );
    expect(buildChainQuery(11142220)).toBe("?chainId=11142220");
  });

  it("default (absent) stays chain-free for backward compat", () => {
    expect(buildPaymentPath("7", undefined)).toBe("/payments/7");
    expect(buildPaymentPath("7", null)).toBe("/payments/7");
    expect(buildReceiptPath("7")).toBe("/receipts/7");
    expect(buildChainQuery(undefined)).toBe("");
  });

  it("unsupported chain fails closed (null — never silent fallback)", () => {
    expect(buildPaymentPath("2", 1)).toBeNull();
    expect(buildPaymentPath("2", 8453)).toBeNull();
    expect(buildReceiptPath("2", 99999)).toBeNull();
    expect(buildEvidencePath("2", 0)).toBeNull();
    expect(buildDisputePath("2", Number.NaN)).toBeNull();
    expect(buildChainQuery(1)).toBeNull();
  });

  it("malformed payment id fails closed", () => {
    expect(buildPaymentPath("", 42220)).toBeNull();
    expect(buildPaymentPath("abc", 42220)).toBeNull();
    expect(buildPaymentPath("12.5", 42220)).toBeNull();
    expect(buildReceiptPath("  ", 42220)).toBeNull();
  });

  it("parseChainIdParam fails closed on malformed/unsupported", () => {
    expect(parseChainIdParam(null).status).toBe("default");
    expect(parseChainIdParam("").status).toBe("default");
    expect(parseChainIdParam("42220")).toEqual({
      status: "explicit",
      chainId: 42220,
    });
    expect(parseChainIdParam("11142220")).toEqual({
      status: "explicit",
      chainId: 11142220,
    });
    expect(parseChainIdParam("1").status).toBe("invalid");
    expect(parseChainIdParam("abc").status).toBe("invalid");
    expect(parseChainIdParam("0xA").status).toBe("invalid");
  });

  it("source preserves chain in create/fund, evidence, dispute, room receipt", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const newPage = readFileSync(
      resolve(__dirname, "../../../app/(product)/payments/new/page.tsx"),
      "utf-8",
    );
    expect(newPage).toContain("?chainId=${targetChainId}");

    const evidence = readFileSync(
      resolve(
        __dirname,
        "../../../app/(product)/payments/[paymentId]/evidence/page.tsx",
      ),
      "utf-8",
    );
    // All evidence return navigation preserves chainQuery.
    expect(evidence).not.toMatch(/router\.push\(`\/payments\/\$\{paymentIdStr\}`\)/);
    expect(evidence).toContain("router.push(`/payments/${paymentIdStr}${chainQuery}`)");
    expect(evidence).toContain("href={`/payments/${paymentIdStr}${chainQuery}`}");

    const dispute = readFileSync(
      resolve(
        __dirname,
        "../../../app/(product)/payments/[paymentId]/dispute/page.tsx",
      ),
      "utf-8",
    );
    expect(dispute).toContain("chainQuery");
    expect(dispute).not.toMatch(/router\.push\(`\/payments\/\$\{paymentIdStr\}`\)/);

    const room = readFileSync(
      resolve(
        __dirname,
        "../../../app/(product)/payments/[paymentId]/page.tsx",
      ),
      "utf-8",
    );
    expect(room).toContain("buildReceiptPath");
  });
});
