// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toDataSuffix } from "@celo/attribution-tags";

const mocks = vi.hoisted(() => {
  return {
    usePublicClient: vi.fn(),
    useReadContract: vi.fn(),
    useWriteContract: vi.fn(),
    useWaitForTransactionReceipt: vi.fn(),
    useWalletState: vi.fn(),
    getEscrowContractAddress: vi.fn(),
    getEscrowChainId: vi.fn(),
    getPaymentTokenConfig: vi.fn(),
  };
});

const attributionMock = vi.hoisted(() => ({
  getAttributionDataSuffix: vi.fn(),
}));

vi.mock("wagmi", () => ({
  usePublicClient: mocks.usePublicClient,
  useReadContract: mocks.useReadContract,
  useWriteContract: mocks.useWriteContract,
  useWaitForTransactionReceipt: mocks.useWaitForTransactionReceipt,
}));

vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: mocks.useWalletState,
}));

vi.mock("@/lib/contracts/config", () => ({
  getEscrowContractAddress: mocks.getEscrowContractAddress,
  getEscrowChainId: mocks.getEscrowChainId,
}));

vi.mock("@/lib/web3/tokens", () => ({
  getPaymentTokenConfig: mocks.getPaymentTokenConfig,
}));

vi.mock("@/lib/contracts/attribution", () => attributionMock);

import { useTokenApproval } from "../useTokenApproval";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const ESCROW = "0x3333333333333333333333333333333333333333" as const;
const AMOUNT = 12_345n;
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");

let latestApi: ReturnType<typeof useTokenApproval> | null = null;
let root: Root | null = null;

function Harness() {
  const api = useTokenApproval();

  useEffect(() => {
    latestApi = api;
  }, [api]);

  return null;
}

beforeEach(() => {
  latestApi = null;
  attributionMock.getAttributionDataSuffix.mockReturnValue(
    toDataSuffix("celo_b7de8bf7e64e"),
  );
  mocks.useWalletState.mockReturnValue({
    address: ACCOUNT,
    chainId: 11142220,
  });
  mocks.getEscrowContractAddress.mockReturnValue(ESCROW);
  mocks.getEscrowChainId.mockReturnValue(11142220);
  mocks.getPaymentTokenConfig.mockReturnValue({ address: TOKEN });
  mocks.usePublicClient.mockReturnValue({
    simulateContract: vi.fn(() => Promise.resolve({ request: {} })),
  });
  mocks.useReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  });
  mocks.useWriteContract.mockReturnValue({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  mocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: false,
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  vi.clearAllMocks();
});

describe("useTokenApproval attribution", () => {
  it("forwards one captured suffix without changing approval arguments", async () => {
    const publicClient = {
      simulateContract: vi.fn(() => Promise.resolve({ request: {} })),
    };
    const writeContract = vi.fn();
    mocks.usePublicClient.mockReturnValue(publicClient);
    mocks.useWriteContract.mockReturnValue({
      writeContract,
      data: undefined,
      isPending: false,
      error: null,
      reset: vi.fn(),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<Harness />);
    });

    await act(async () => {
      latestApi!.approve(AMOUNT);
      await Promise.resolve();
    });

    expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(attributionMock.getAttributionDataSuffix).toHaveBeenCalledTimes(1);

    const simulated = (
      publicClient.simulateContract.mock.calls as unknown as Array<
        [Record<string, unknown>]
      >
    )[0]![0];
    const written = (
      writeContract.mock.calls as unknown as Array<[Record<string, unknown>]>
    )[0]![0];

    expect(simulated).toMatchObject({
      address: TOKEN,
      functionName: "approve",
      args: [ESCROW, AMOUNT],
      account: ACCOUNT,
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: TOKEN,
      functionName: "approve",
      args: [ESCROW, AMOUNT],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(simulated.dataSuffix).toBe(written.dataSuffix);
  });
});
