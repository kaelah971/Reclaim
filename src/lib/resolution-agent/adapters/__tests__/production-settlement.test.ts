// ---------------------------------------------------------------------------
// Production x402 settlement client — facilitator payload + proof tests
//
// Proves the REAL production settlement client:
//   - targets the official Celo facilitator config (eip155:42220, mainnet
//     USDC, payTo) with amount 10000 atomic USDC, scheme "exact"
//   - signs EIP-3009 TransferWithAuthorization with the AGENT CASE wallet
//     (authorization.from === case wallet address)
//   - never reports success from an HTTP-level success alone — the
//     facilitator's on-chain settlement proof (txHash + settlementSuccess)
//     is required; otherwise the outcome is ambiguous/failed
//   - requires celo-facilitator mode
// ---------------------------------------------------------------------------

process.env.X402_SETTLEMENT_MODE = "celo-facilitator";
process.env.X402_API_KEY = "x402_test_key_do_not_use";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

const settlePaymentMock = vi.fn();
const verifyPaymentMock = vi.fn();
const providerMock = {
  identifier: "celo-facilitator",
  network: "eip155:42220",
  payToAddress: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  settlePayment: settlePaymentMock,
  verifyPayment: verifyPaymentMock,
};

vi.mock("@/lib/x402/settlementProvider", () => ({
  getSettlementProvider: () => providerMock,
  FacilitatorSettlementReceipt: {},
}));

// Dynamic import AFTER setting the mode env — "@/lib/x402/config" reads
// process.env at module load.
async function loadProductionClient(): Promise<
  import("../types").ResolutionAgentX402SettlementClient
> {
  const production = (await import("../production")) as {
    createProductionSettlementClient: () => import("../types").ResolutionAgentX402SettlementClient;
  };
  return production.createProductionSettlementClient();
}

const CASE_WALLET_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CASE_WALLET = privateKeyToAccount(CASE_WALLET_KEY);

const SUCCESS_RECEIPT = {
  facilitatorUrl: "https://api.x402.celo.org",
  x402Version: 2,
  scheme: "exact",
  network: "eip155:42220",
  payer: CASE_WALLET.address.toLowerCase(),
  payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  amount: "10000",
  paymentIdentifier: "pay_abc",
  settlementTxHash: "0xsettle-tx",
  settlementSuccess: true,
  settledAt: new Date().toISOString(),
};

function baseParams() {
  return {
    payerAccount: CASE_WALLET,
    requestHash: "0xreq-hash",
    serviceInput: {
      escrowPaymentId: "1",
      escrowChainId: "eip155:11142220",
      escrowContractAddress: "0x1a1ca38d6ac538d491a5c0db2ed7fddc3aec709f",
      payer: CASE_WALLET.address,
      paymentNetwork: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      amount: "10000",
      scheme: "exact",
      evidenceTitle: "Test evidence",
      evidenceDescription: "Description",
      evidenceType: "other",
      relatedClaim: "",
      evidenceDate: "",
      externalRef: "",
      pastedText: "",
      fileHash: "",
      evidenceInputHash: "0xinput-hash",
    },
    expectedPriceAtomic: 10000n,
    network: "eip155:42220",
    asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  };
}

describe("createProductionSettlementClient().settleEvidenceQualityCheck", () => {
  beforeEach(() => {
    settlePaymentMock.mockReset();
    verifyPaymentMock.mockReset();
    verifyPaymentMock.mockResolvedValue({ valid: true, payer: undefined, reason: undefined });
  });

  it("calls /verify BEFORE /settle with the exact payload intended for settlement", async () => {
    settlePaymentMock.mockResolvedValue({
      success: true,
      txHash: "0xsettle-tx",
      receipt: SUCCESS_RECEIPT,
    });

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(true);
    expect(verifyPaymentMock).toHaveBeenCalledTimes(1);
    expect(settlePaymentMock).toHaveBeenCalledTimes(1);
    const [verifyPayload, verifyRequirement] = verifyPaymentMock.mock.calls[0];
    expect(verifyPayload.x402Version).toBe(2);
    expect(verifyRequirement).toEqual(expect.objectContaining({ scheme: "exact", amount: "10000" }));
  }, 30000);

  it("never calls /settle when /verify rejects the payment (sanitized reason surfaced)", async () => {
    verifyPaymentMock.mockResolvedValue({
      valid: false,
      reason: "unsupported_scheme: scheme=exact version=2 network=eip155:42220",
    });

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(false);
    expect(result.ambiguous).toBe(false);
    expect(settlePaymentMock).not.toHaveBeenCalled();
    // Explicitly reports the full sanitized version/scheme/network tuple.
    expect(result.error).toContain("/verify");
    expect(result.error).toContain("unsupported_scheme");
    expect(result.error).toContain("exact");
    expect(result.error).toContain("eip155:42220");
  }, 30000);

  it("sends the exact-scheme payload to the official facilitator config", async () => {
    settlePaymentMock.mockResolvedValue({
      success: true,
      txHash: "0xsettle-tx",
      receipt: SUCCESS_RECEIPT,
    });

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xsettle-tx");
    expect(settlePaymentMock).toHaveBeenCalledTimes(1);

    const [payload, requirement] = settlePaymentMock.mock.calls[0];
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(
      expect.objectContaining({
        scheme: "exact",
        network: "eip155:42220",
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
        amount: "10000",
      }),
    );
    expect(requirement).toEqual(
      expect.objectContaining({ scheme: "exact", amount: "10000" }),
    );
  });

  it("signs the EIP-3009 authorization with the AGENT CASE wallet", async () => {
    settlePaymentMock.mockResolvedValue({
      success: true,
      txHash: "0xsettle-tx",
      receipt: SUCCESS_RECEIPT,
    });

    const client = await loadProductionClient();
    await client.settleEvidenceQualityCheck(baseParams());

    const [payload] = settlePaymentMock.mock.calls[0];
    const payment = payload.payload as {
      authorization: { from: string; to: string; value: bigint; validBefore: bigint };
      signature: string;
    };
    expect(payment.authorization.from.toLowerCase()).toBe(
      CASE_WALLET.address.toLowerCase(),
    );
    expect(payment.authorization.to).toBe(
      "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    );
    expect(payment.authorization.value).toBe(10000n);
    expect(payment.authorization.validBefore).toBeGreaterThan(0n);
    expect(payment.signature).toMatch(/^0x[0-9a-f]{130}$/); // 65-byte ECDSA sig
  });

  it("reports ambiguous when the facilitator returns success without on-chain settlement proof", async () => {
    // HTTP-level success but NO settlementSuccess — must NOT be treated as
    // success (never spend on an unverified outcome).
    settlePaymentMock.mockResolvedValue({
      success: true,
      receipt: { ...SUCCESS_RECEIPT, settlementSuccess: false },
    });

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.txHash).toBeUndefined();
  });

  it("reports failure when the facilitator explicitly fails", async () => {
    settlePaymentMock.mockResolvedValue({ success: false, reason: "rejected" });

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(false);
    expect(result.ambiguous).toBe(false);
    expect(result.error).toContain("rejected");
  });

  it("fails safe when the settlement provider throws — sanitized detail preserved, no secrets", async () => {
    settlePaymentMock.mockRejectedValue(
      new Error("Celo facilitator /settle failed: Facilitator settle failed (401): invalid api key"),
    );

    const client = await loadProductionClient();
    const result = await client.settleEvidenceQualityCheck(baseParams());

    expect(result.success).toBe(false);
    expect(result.ambiguous).toBe(true);
    // Endpoint + status + reason must remain visible…
    expect(result.error).toContain("POST https://api.x402.celo.org/settle");
    expect(result.error).toContain("401");
    expect(result.error).toContain("invalid api key");
    // …while secrets never leak.
    expect(result.error).not.toContain("x402_test_key");
    expect(result.error).not.toMatch(/x402_[A-Za-z0-9]+/);
  });

  it("sanitizes signatures/long hex out of facilitator failure details", async () => {
    const { sanitizeFacilitatorFailure } = (await import("../production")) as {
      sanitizeFacilitatorFailure: (err: unknown, endpoint: string) => string;
    };
    const fakeSignature = `0x${"ab".repeat(64)}`;
    const err = new Error(
      `Facilitator settle failed (422): ${fakeSignature} authorization=${fakeSignature}`,
    );
    const safe = sanitizeFacilitatorFailure(err, "POST https://api.x402.celo.org/settle");
    expect(safe).toContain("422");
    expect(safe).not.toContain(fakeSignature);
    expect(safe).not.toMatch(/0x[0-9a-fA-F]{40,}/);
    expect(safe).not.toContain("authorization=");
  });

  it("missing X402_API_KEY fails BEFORE signing/settlement with an explicit config error", async () => {
    const prev = process.env.X402_API_KEY;
    delete process.env.X402_API_KEY;
    try {
      const client = await loadProductionClient();
      const result = await client.settleEvidenceQualityCheck(baseParams());

      expect(result.success).toBe(false);
      expect(result.ambiguous).toBe(false);
      expect(result.error).toContain("X402_API_KEY is not configured");
      expect(result.error).toContain("/settle");
      // No settlement request was attempted (fail before any signing).
      expect(settlePaymentMock).not.toHaveBeenCalled();
    } finally {
      process.env.X402_API_KEY = prev;
    }
  });

  it("case-refresh and dispute-brief settlements are not wired yet", async () => {
    const client = await loadProductionClient();
    const cr = await client.settleCaseRefresh(baseParams() as never);
    const db = await client.settleDisputeBrief(baseParams() as never);
    expect(cr.success).toBe(false);
    expect(db.success).toBe(false);
    expect(settlePaymentMock).not.toHaveBeenCalled();
  });
});
