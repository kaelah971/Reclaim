import { describe, expect, it } from "vitest";
import {
  getReviewerBindingMismatches,
  normalizeEscrowPaymentId,
  type ReviewerOnchainBinding,
} from "@/lib/reviewer/store";
import { getEscrowContractAddress } from "@/lib/contracts/config";

const CLIENT = "0x1111111111111111111111111111111111111111";
const WORKER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const CONTRACT = "0x4444444444444444444444444444444444444444";

const binding: ReviewerOnchainBinding = {
  chainId: 11142220,
  contractAddress: CONTRACT,
  escrowPaymentId: "7",
  client: CLIENT,
  worker: WORKER,
  amount: "1000000",
  token: TOKEN,
  state: "Disputed",
};

function decision(overrides: Record<string, unknown> = {}) {
  return {
    onchain_payment_id: binding.escrowPaymentId,
    chain_id: binding.chainId,
    contract_address: binding.contractAddress,
    onchain_snapshot: {
      id: binding.escrowPaymentId,
      chainId: binding.chainId,
      contractAddress: binding.contractAddress,
      client: binding.client,
      worker: binding.worker,
      amount: binding.amount,
      token: binding.token,
      state: binding.state,
    },
    ...overrides,
  };
}

describe("reviewer escrow identity binding", () => {
  it("accepts only a numeric escrow payment ID and never an x402 UUID", () => {
    expect(normalizeEscrowPaymentId("7")).toBe("7");
    expect(normalizeEscrowPaymentId("0007")).toBe("7");
    expect(normalizeEscrowPaymentId("pay_550e8400-e29b-41d4-a716-446655440000")).toBeNull();
    expect(normalizeEscrowPaymentId("550e8400-e29b-41d4-a716-446655440000")).toBeNull();
    expect(normalizeEscrowPaymentId("7.0")).toBeNull();
    expect(normalizeEscrowPaymentId(undefined)).toBeNull();
  });

  it("rejects an incomplete binding before a decision can become executable", () => {
    const mismatches = getReviewerBindingMismatches(
      {
        onchain_payment_id: null,
        chain_id: null,
        contract_address: null,
        onchain_snapshot: null,
      },
      binding,
      { requireComplete: true },
    );

    expect(mismatches).toEqual(expect.arrayContaining([
      "escrow_payment_id is missing",
      "chain_id is missing",
      "contract_address is missing",
      "onchain_snapshot is missing",
    ]));
  });

  it.each([
    ["escrow_payment_id", { onchain_payment_id: "pay_not_a_number" }],
    ["chain_id", { chain_id: 42220 }],
    ["contract_address", { contract_address: "0x5555555555555555555555555555555555555555" }],
  ])("rejects a mismatched persisted %s", (field, override) => {
    expect(getReviewerBindingMismatches(decision(override), binding)).toContain(field);
  });

  it.each([
    ["escrow_payment_id", { id: "8" }],
    ["chain_id", { chainId: 42220 }],
    ["contract_address", { contractAddress: "0x5555555555555555555555555555555555555555" }],
    ["client", { client: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    ["worker", { worker: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    ["amount", { amount: "999999" }],
    ["token", { token: "0xcccccccccccccccccccccccccccccccccccccccc" }],
  ])("rejects a mismatched persisted snapshot %s", (field, snapshotOverride) => {
    const snapshot = {
      ...decision().onchain_snapshot,
      ...snapshotOverride,
    };

    expect(getReviewerBindingMismatches(decision({ onchain_snapshot: snapshot }), binding)).toContain(field);
  });

  it("accepts an exact chain-scoped binding", () => {
    expect(getReviewerBindingMismatches(decision(), binding)).toEqual([]);
  });

  it("resolves the deployed Celo Mainnet escrow (P3)", () => {
    expect(getEscrowContractAddress(42220)).toBe(
      "0xE42cF4620DE454bE0De5004255d25683e4F882c4",
    );
  });
});
