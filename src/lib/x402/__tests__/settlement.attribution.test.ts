import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDataSuffix } from "@celo/attribution-tags";

const testConfig = vi.hoisted(() => {
  const privateKey =
    "0x0000000000000000000000000000000000000000000000000000000000000001";
  vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "celo_b7de8bf7e64e");
  vi.stubEnv("X402_RELAYER_PRIVATE_KEY", privateKey);
  vi.stubEnv("X402_PAY_TO_ADDRESS", "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA");
  vi.stubEnv("X402_USDC_ADDRESS", "0x1111111111111111111111111111111111111111");
  return { privateKey };
});

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    createWalletClient: mocks.createWalletClient,
  };
});

import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settlePayment } from "../settlement";
import type { PaymentDetails } from "../types";

const BUYER = "0x2222222222222222222222222222222222222222" as const;
const PAY_TO = "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA" as const;
const USDC = "0x1111111111111111111111111111111111111111" as const;
const AMOUNT = 10_000n;
const NONCE = 7n;
const DEADLINE = 2_000_000_000n;
const SIGNATURE = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");

function padTopic(address: string): `0x${string}` {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

describe("x402 settlement attribution", () => {
  beforeEach(() => {
    const transferTopic = keccak256(toHex("Transfer(address,address,uint256)"));
    mocks.createPublicClient.mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 123n,
        blockHash: `0x${"b".repeat(64)}`,
        logs: [
          {
            address: USDC,
            topics: [transferTopic, padTopic(BUYER), padTopic(PAY_TO)],
            data: `0x${AMOUNT.toString(16).padStart(64, "0")}`,
          },
        ],
      }),
    });
    mocks.createWalletClient.mockReturnValue({
      writeContract: vi.fn().mockResolvedValue(TX_HASH),
    });
  });

  it("adds attribution without changing the signed Permit2 arguments", async () => {
    const relayer = privateKeyToAccount(testConfig.privateKey as `0x${string}`);
    const payment: PaymentDetails = {
      from: BUYER,
      to: PAY_TO,
      token: USDC,
      amount: AMOUNT.toString(),
      signature: SIGNATURE,
      nonce: NONCE.toString(),
      deadline: DEADLINE.toString(),
      spender: relayer.address,
    };

    const receipt = await settlePayment(payment);
    const walletClient = mocks.createWalletClient.mock.results[0]?.value;
    const request = walletClient.writeContract.mock.calls[0][0];

    expect(receipt.txHash).toBe(TX_HASH);
    expect(request).toMatchObject({
      address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      functionName: "permitTransferFrom",
      chain: expect.objectContaining({ id: 11142220 }),
      gas: undefined,
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(request.args).toEqual([
      {
        permitted: { token: USDC, amount: AMOUNT },
        nonce: NONCE,
        deadline: DEADLINE,
      },
      { to: PAY_TO, requestedAmount: AMOUNT },
      BUYER,
      SIGNATURE,
    ]);
  });
});
