import { describe, expect, it } from "vitest";
import { validateX402SettlementResult } from "../types";

const receipt = {
  facilitatorUrl: "https://api.x402.celo.org",
  x402Version: 2,
  scheme: "exact",
  network: "eip155:42220",
  payer: "0x0000000000000000000000000000000000000001",
  payTo: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003",
  amount: "10000",
  paymentIdentifier: "pay_test",
  settlementTxHash: "0xtx",
  settlementSuccess: true,
  settledAt: new Date().toISOString(),
};

describe("validateX402SettlementResult", () => {
  it("requires a transaction proof before a success can be persisted", () => {
    expect(validateX402SettlementResult({ success: true, ambiguous: false })).toContain(
      "transaction hash",
    );
  });

  it("requires the facilitator receipt as well as the transaction proof", () => {
    expect(
      validateX402SettlementResult({
        success: true,
        ambiguous: false,
        txHash: "0xtx",
      }),
    ).toContain("facilitator receipt");
  });

  it("rejects a failed or mismatched facilitator receipt", () => {
    expect(
      validateX402SettlementResult({
        success: true,
        ambiguous: false,
        txHash: "0xtx",
        receipt: { ...receipt, settlementSuccess: false },
      }),
    ).toContain("does not confirm");

    expect(
      validateX402SettlementResult({
        success: true,
        ambiguous: false,
        txHash: "0xtx-other",
        receipt,
      }),
    ).toContain("does not match");
  });

  it("accepts a confirmed matching settlement", () => {
    expect(
      validateX402SettlementResult({
        success: true,
        ambiguous: false,
        txHash: "0xtx",
        receipt,
      }),
    ).toBeNull();
  });
});
