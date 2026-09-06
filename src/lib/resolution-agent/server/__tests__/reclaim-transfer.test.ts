import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDataSuffix } from "@celo/attribution-tags";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "celo_b7de8bf7e64e");

  return {
    createPublicClient: vi.fn(),
    createWalletClient: vi.fn(),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    createWalletClient: mocks.createWalletClient,
  };
});

import { encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CeloReclaimTransferClient } from "../reclaim-transfer";

const PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const FROM = privateKeyToAccount(PRIVATE_KEY).address;
const TO = "0x2222222222222222222222222222222222222222" as const;
const AMOUNT = 123_456n;
const NONCE = 17;
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");

describe("CeloReclaimTransferClient attribution", () => {
  beforeEach(() => {
    mocks.createPublicClient.mockReturnValue({
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 20n }),
      getTransactionCount: vi.fn().mockResolvedValue(NONCE),
    });
    mocks.createWalletClient.mockReturnValue({
      sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
    });
  });

  it("adds attribution while preserving the ERC-20 transfer transaction fields", async () => {
    const client = new CeloReclaimTransferClient("http://127.0.0.1:8545");

    const result = await client.transferUsdc({
      privateKey: PRIVATE_KEY,
      from: FROM,
      to: TO,
      amountAtomic: AMOUNT,
      storedNonce: NONCE,
    });

    const walletClient = mocks.createWalletClient.mock.results[0]?.value;
    const transferData = encodeFunctionData({
      abi: [
        {
          name: "transfer",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "transfer",
      args: [TO, AMOUNT],
    });
    const request = walletClient.sendTransaction.mock.calls[0][0];

    expect(result).toEqual({
      txHash: TX_HASH,
      nonce: NONCE,
      transferAmount: AMOUNT,
    });
    expect(request).toMatchObject({
      to: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      data: transferData,
      value: 0n,
      gas: 200_000n,
      maxFeePerGas: 20n,
      maxPriorityFeePerGas: 10n,
      nonce: NONCE,
      feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
      chain: celo,
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
  });
});
