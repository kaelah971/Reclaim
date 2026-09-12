import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  X402_FACILITATOR_USDC_MAINNET,
  X402_USDC_ADDRESS,
  X402_USDC_DECIMALS,
  X402_NETWORK,
  getCaseRefreshPriceAtomic,
  getX402ServicePaymentTerms,
} from "../config";
import {
  buildCaseRefreshPaymentRequirements,
  verifyPaymentPayload,
  getPaymentPayloadPayer,
  validateCorePaymentPayload,
} from "../shared";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type {
  PaymentDetails,
  PaymentPayloadCustom,
} from "../types";
import {
  assertSettlementReceiptPersistable,
  InMemoryPaymentStore,
  PaymentStoreConflictError,
  type PaymentMetadata,
} from "../paymentStore";
import type { SettlementReceipt } from "../types";

const MAINNET_USAT = "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771";
const PAY_TO = "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const PAYER = "0x1111111111111111111111111111111111111111";

function validPayload(
  overrides: Partial<PaymentDetails> = {},
): PaymentPayloadCustom {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    payment: {
      from: PAYER,
      to: PAY_TO,
      token: X402_USDC_ADDRESS,
      amount: "10000",
      signature: "0x" + "ab".repeat(65),
      ...overrides,
    },
  };
}

function metadata(overrides: Partial<PaymentMetadata> = {}): PaymentMetadata {
  return {
    service: "reclaim-dispute-brief-v1",
    payerAddress: PAYER,
    payToAddress: PAY_TO,
    network: X402_NETWORK,
    chainId: 11142220,
    tokenAddress: X402_USDC_ADDRESS,
    tokenSymbol: "USDC",
    tokenDecimals: X402_USDC_DECIMALS,
    amountAtomic: "10000",
    amountDisplay: "0.01",
    escrowPaymentId: "42",
    requestHash: "0x" + "12".repeat(32),
    ...overrides,
  };
}

let receipt: SettlementReceipt = {
  txHash: "0x" + "ab".repeat(32),
  blockNumber: 123n,
  blockHash: "0x" + "cd".repeat(32),
  status: "success",
  from: PAYER,
  to: PAY_TO,
  amount: "10000",
  tokenAddress: X402_USDC_ADDRESS,
};

// Settlement transaction hashes are unique across payments. Generate a fresh
// fixture per test so the replay-protection invariant is tested intentionally.
beforeEach(() => {
  receipt = {
    ...receipt,
    txHash: `0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`,
  };
});

describe("P2D x402 asset and exact-payment safety", () => {
  it("keeps x402 on USDC and separate from the mainnet USA₮ escrow asset", () => {
    expect(X402_USDC_ADDRESS.toLowerCase()).not.toBe(MAINNET_USAT.toLowerCase());
    expect(X402_FACILITATOR_USDC_MAINNET.toLowerCase()).not.toBe(
      MAINNET_USAT.toLowerCase(),
    );
    expect(getX402ServicePaymentTerms("reclaim-dispute-brief-v1").tokenSymbol).toBe(
      "USDC",
    );
  });

  it.each([
    ["amount", { amount: "10001" }, /exact amount/],
    ["token", { token: "0x2222222222222222222222222222222222222222" }, /server-configured|token/],
    ["network", {}, /network/],
    ["recipient", { to: "0x3333333333333333333333333333333333333333" }, /recipient/],
  ] as const)("rejects facilitator/payment %s mismatches before provider use", (field, paymentOverrides, reason) => {
    const payload = validPayload(paymentOverrides);
    if (field === "network") payload.network = "eip155:42220";

    const result = verifyPaymentPayload(
      payload,
      getX402ServicePaymentTerms("reclaim-dispute-brief-v1"),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it("does not derive the payer or amount from an x402 identifier", () => {
    const payload = validPayload({ amount: "10000" });
    expect(getPaymentPayloadPayer(payload)).toBe(PAYER);
    expect(getX402ServicePaymentTerms("reclaim-dispute-brief-v1").amountAtomic).toBe(
      "10000",
    );
  });

  it("uses a server-owned price for every paid service", () => {
    for (const service of [
      "reclaim-dispute-brief-v1",
      "evidence-quality-check",
      "case-refresh",
    ] as const) {
      const terms = getX402ServicePaymentTerms(service);
      expect(terms.service).toBe(service);
      expect(terms.amountAtomic).toBe(
        service === "case-refresh"
          ? getCaseRefreshPriceAtomic().toString()
          : terms.amountAtomic,
      );
      expect(terms.tokenSymbol).toBe("USDC");
      expect(terms.tokenDecimals).toBe(6);
      expect(terms.network).toBe(`eip155:${terms.chainId}`);
    }
  });

  it("advertises the case-refresh price rather than the evidence-check price", () => {
    const requirements = buildCaseRefreshPaymentRequirements();
    expect(requirements.accepts[0]?.amount).toBe(
      getX402ServicePaymentTerms("case-refresh").amountAtomic,
    );
    expect(requirements.description).toBe("Reclaim case refresh");
  });

  it.each([
    ["amount", { amount: "10001" }, /exact amount/],
    ["token", { token: "0x2222222222222222222222222222222222222222" }, /server-configured|token/],
    ["recipient", { to: "0x3333333333333333333333333333333333333333" }, /recipient/],
  ] as const)("rejects %s mismatch before a core provider call", (_field, paymentOverrides, reason) => {
    const terms = getX402ServicePaymentTerms("reclaim-dispute-brief-v1");
    const requirement: PaymentRequirements = {
      scheme: "exact",
      network: terms.network as `${string}:${string}`,
      asset: terms.tokenAddress,
      amount: terms.amountAtomic,
      payTo: terms.payToAddress,
      maxTimeoutSeconds: 300,
      extra: {},
    };
    const custom = validPayload(paymentOverrides);
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: requirement,
      payload: custom.payment as unknown as Record<string, unknown>,
    };

    if (_field === "token") {
      // Permit2 carries the token in the scheme payload.
      expect(validateCorePaymentPayload(payload, requirement, terms).valid).toBe(false);
    } else {
      const result = verifyPaymentPayload(custom, terms);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(reason);
      return;
    }
    expect(validateCorePaymentPayload(payload, requirement, terms).reason).toMatch(reason);
  });
});

describe("P2D race-safe in-memory payment state", () => {
  it("rejects a request-hash race when incoming server-owned metadata differs", async () => {
    const store = new InMemoryPaymentStore();
    const requestHash = "0x" + "23".repeat(32);
    const firstPaymentId = store.createPaymentId();
    const conflictingPaymentId = store.createPaymentId();

    const attempts = await Promise.allSettled([
      store.recordPending(firstPaymentId, metadata({ requestHash })),
      store.recordPending(
        conflictingPaymentId,
        metadata({ requestHash, amountAtomic: "20000", amountDisplay: "0.02" }),
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(PaymentStoreConflictError);
  });

  it("allows one settlement claim for concurrent identical requests", async () => {
    const store = new InMemoryPaymentStore();
    const requestHash = "0x" + "34".repeat(32);
    const paymentIdA = store.createPaymentId();
    const paymentIdB = store.createPaymentId();

    const creations = await Promise.all([
      store.recordPending(paymentIdA, metadata({ requestHash })),
      store.recordPending(paymentIdB, metadata({ requestHash })),
    ]);
    const winner = creations.find((creation) => creation.created);
    expect(winner).toBeDefined();
    expect(creations.filter((creation) => creation.created)).toHaveLength(1);
    expect(creations.find((creation) => !creation.created)?.paymentId).toBe(winner!.paymentId);

    const claims = await Promise.all([
      store.claimSettlement(winner!.paymentId, requestHash),
      store.claimSettlement(winner!.paymentId, requestHash),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(await store.getState(winner!.paymentId)).toBe("settlement_submitted");
  });

  it("rejects UUIDs as escrow IDs while retaining numeric IDs", async () => {
    const store = new InMemoryPaymentStore();
    await expect(
      store.recordPending(store.createPaymentId(), metadata({ escrowPaymentId: "pay_abc" })),
    ).rejects.toThrow(/numeric escrow payment ID/);

    const result = await store.recordPending(
      store.createPaymentId(),
      metadata({ escrowPaymentId: "123" }),
    );
    expect(result.created).toBe(true);
    expect(result.record.metadata?.escrowPaymentId).toBe("123");
  });

  it("transitions pending -> authorization_verified -> settlement_submitted", async () => {
    const store = new InMemoryPaymentStore();
    const paymentId = store.createPaymentId();
    const requestHash = "0x" + "56".repeat(32);
    await store.recordPending(paymentId, metadata({ requestHash }));

    await store.recordAuthorizationVerified(paymentId);
    expect(await store.getState(paymentId)).toBe("authorization_verified");

    const claim = await store.claimSettlement(paymentId, requestHash);
    expect(claim.claimed).toBe(true);
    expect(await store.getState(paymentId)).toBe("settlement_submitted");
  });

  it("persists one receipt and returns it on an idempotent retry", async () => {
    const store = new InMemoryPaymentStore();
    const paymentId = store.createPaymentId();
    await store.recordPending(paymentId, metadata({ requestHash: "0x" + "78".repeat(32) }));
    await store.claimSettlement(paymentId, "0x" + "78".repeat(32));

    await store.recordSettlementReceipt(paymentId, receipt);
    await store.recordSettlementReceipt(paymentId, receipt);
    const retry = await store.claimSettlement(paymentId, "0x" + "78".repeat(32));

    expect(retry.claimed).toBe(false);
    expect(retry.receipt?.txHash).toBe(receipt.txHash);
    expect((await store.getResult(paymentId))?.receipt.txHash).toBe(receipt.txHash);
  });

  it("persists all server-owned payment metadata without using the x402 UUID as escrow ID", async () => {
    const store = new InMemoryPaymentStore();
    const paymentId = store.createPaymentId();
    const record = await store.recordPending(paymentId, metadata({
      escrowPaymentId: "987",
      requestHash: "0x" + crypto.randomUUID().replaceAll("-", ""),
    }));

    expect(record.record.metadata).toMatchObject({
      payerAddress: PAYER,
      payToAddress: PAY_TO,
      network: X402_NETWORK,
      chainId: 11142220,
      tokenAddress: X402_USDC_ADDRESS,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      amountAtomic: "10000",
      service: "reclaim-dispute-brief-v1",
      escrowPaymentId: "987",
    });
    expect(record.record.metadata?.escrowPaymentId).not.toBe(paymentId);
  });

  it("invokes settlement at most once when identical requests claim concurrently", async () => {
    const store = new InMemoryPaymentStore();
    const paymentId = store.createPaymentId();
    const requestHash = "0x" + "89".repeat(32);
    await store.recordPending(paymentId, metadata({ requestHash }));
    await store.recordAuthorizationVerified(paymentId);

    const providerSettle = vi.fn().mockResolvedValue({ success: true });
    const claims = await Promise.all([
      store.claimSettlement(paymentId, requestHash),
      store.claimSettlement(paymentId, requestHash),
    ]);
    await Promise.all(
      claims.filter((claim) => claim.claimed).map(() => providerSettle()),
    );

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(providerSettle).toHaveBeenCalledTimes(1);
  });

  it("returns the confirmed receipt on retry without a second settlement call", async () => {
    const store = new InMemoryPaymentStore();
    const paymentId = store.createPaymentId();
    const requestHash = "0x" + "9a".repeat(32);
    await store.recordPending(paymentId, metadata({ requestHash }));
    await store.recordAuthorizationVerified(paymentId);

    const providerSettle = vi.fn().mockResolvedValue({
      success: true,
      txHash: receipt.txHash,
    });
    const firstClaim = await store.claimSettlement(paymentId, requestHash);
    if (firstClaim.claimed) {
      await providerSettle();
      await store.recordSettlementReceipt(paymentId, receipt);
    }

    const retryClaim = await store.claimSettlement(paymentId, requestHash);
    if (retryClaim.claimed) await providerSettle();

    expect(retryClaim.claimed).toBe(false);
    expect(retryClaim.receipt?.txHash).toBe(receipt.txHash);
    expect(providerSettle).toHaveBeenCalledTimes(1);
  });

  it("rejects reverted and incomplete receipts before persistence", () => {
    expect(() =>
      assertSettlementReceiptPersistable({ ...receipt, status: "reverted" }),
    ).toThrow(/successful settlement receipts/);
    expect(() =>
      assertSettlementReceiptPersistable({ ...receipt, txHash: "" }),
    ).toThrow(/incomplete/);
  });
});
