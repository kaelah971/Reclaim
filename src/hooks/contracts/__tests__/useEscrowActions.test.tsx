// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useEscrowActions — live-chain hardening tests
//
// Escrow writes must never be gated only on the hydrated/store chainId
// (which can be stale — e.g. persisted from a previous Celo Mainnet
// session). The live connector chain (eth_chainId from the wallet provider)
// is authoritative. Cases covered:
//   a) stale store 42220 + wagmi still reconnecting  => blocked (reconnecting)
//   b) stale store 42220 + live connector 11142220   => escrow write allowed
//   c) store 11142220   + live connector 42220       => blocked (switch chain)
//   d) live connector 11142220 => simulate/write chain target stays 11142220
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toDataSuffix } from "@celo/attribution-tags";
import { getEscrowContractConfig } from "@/lib/contracts/config";

vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_CELO_ATTRIBUTION_TAG", "celo_b7de8bf7e64e");
});

const wagmiMocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
  usePublicClient: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: wagmiMocks.useAccount,
  usePublicClient: wagmiMocks.usePublicClient,
  useWriteContract: wagmiMocks.useWriteContract,
  useWaitForTransactionReceipt: wagmiMocks.useWaitForTransactionReceipt,
}));

import {
  useSubmitEvidenceHash,
  ESCROW_RECONNECTING_ERROR,
  ESCROW_SWITCH_CHAIN_ERROR,
} from "../useEscrowActions";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const REFERENCE =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const PAYMENT_ID = 1n;

const CELO_SEPOLIA_ID = 11142220;
const CELO_MAINNET_ID = 42220;
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");

interface WagmiHarnessMocks {
  connector: { getChainId: ReturnType<typeof vi.fn> };
  simulateContract: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
}

function setupWagmiMocks(
  options: {
    storeChainId?: number;
    isReconnecting?: boolean;
    liveChainId?: number;
    liveChainRejects?: boolean;
  } = {},
): WagmiHarnessMocks {
  const connector = {
    getChainId: vi.fn(() =>
      options.liveChainRejects
        ? Promise.reject(new Error("provider unavailable"))
        : Promise.resolve(options.liveChainId ?? CELO_SEPOLIA_ID),
    ),
  };

  wagmiMocks.useAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: options.storeChainId ?? CELO_SEPOLIA_ID,
    connector,
    isReconnecting: options.isReconnecting ?? false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: options.isReconnecting ? "reconnecting" : "connected",
  });

  const simulateContract = vi.fn(() => Promise.resolve({ request: {} }));
  wagmiMocks.usePublicClient.mockReturnValue({ simulateContract });

  const writeContract = vi.fn();
  wagmiMocks.useWriteContract.mockReturnValue({
    writeContract,
    data: undefined,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });

  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: false,
  });

  return { connector, simulateContract, writeContract };
}

let latestApi: ReturnType<typeof useSubmitEvidenceHash> | null = null;
let refresh: (() => void) | null = null;
let root: Root | null = null;

function Harness() {
  const api = useSubmitEvidenceHash();
  const [, force] = useState(0);
  useEffect(() => {
    latestApi = api;
    refresh = () => force((v) => v + 1);
  }, [api]);
  return null;
}

async function mountHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness />);
  });
  await act(async () => {});
}

beforeEach(() => {
  latestApi = null;
  refresh = null;
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("useSubmitEvidenceHash — live-chain hardening", () => {
  it("a) blocks the write when wagmi is still reconnecting, even with a stale store chainId 42220", async () => {
    const { simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      isReconnecting: true,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });

    expect(latestApi!.error).toBe(ESCROW_RECONNECTING_ERROR);
    expect(latestApi!.isPending).toBe(false);
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("b) allows the write when the LIVE connector chain is 11142220 even if the store chainId is stale 42220", async () => {
    const { connector, simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      isReconnecting: false,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });

    expect(connector.getChainId).toHaveBeenCalled();
    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(latestApi!.error).toBeNull();
  });

  it("c) blocks the write when the LIVE connector chain is 42220 even if the store chainId is 11142220", async () => {
    const { connector, simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      isReconnecting: false,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });

    expect(connector.getChainId).toHaveBeenCalled();
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
    expect(latestApi!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);
  });

  it("d) keeps chain target 11142220 on the canonical escrow for simulate and write when the live connector chain is 11142220", async () => {
    const { simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });

    const expected = getEscrowContractConfig();
    expect(expected.chainId).toBe(CELO_SEPOLIA_ID);
    expect(expected.address).toBe(
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
    );

    expect(simulateContract.mock.calls[0][0]).toMatchObject({
      chainId: CELO_SEPOLIA_ID,
      address: expected.address,
      functionName: "submitEvidenceHash",
      args: [PAYMENT_ID, REFERENCE],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(writeContract.mock.calls[0][0]).toMatchObject({
      chainId: CELO_SEPOLIA_ID,
      address: expected.address,
      functionName: "submitEvidenceHash",
      args: [PAYMENT_ID, REFERENCE],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(simulateContract.mock.calls[0][0].dataSuffix).toBe(
      writeContract.mock.calls[0][0].dataSuffix,
    );
  });
});

// ---------------------------------------------------------------------------
// Stale-error lifecycle regression tests
// ---------------------------------------------------------------------------

describe("useSubmitEvidenceHash — stale chain error lifecycle", () => {
  function setLiveChain(connector: { getChainId: ReturnType<typeof vi.fn> }, liveChainId: number, storeChainId: number) {
    connector.getChainId.mockImplementation(() => Promise.resolve(liveChainId));
    wagmiMocks.useAccount.mockReturnValue({
      address: ACCOUNT,
      chainId: storeChainId,
      connector,
      isReconnecting: false,
      isConnected: true,
      isConnecting: false,
      isDisconnected: false,
      status: "connected",
    });
  }

  it("clears a previous mismatch error once live connector validation confirms 11142220", async () => {
    const { connector, simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      isReconnecting: false,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    // First attempt while the LIVE chain is 42220 — blocked with chain error.
    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });
    expect(latestApi!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);
    expect(writeContract).not.toHaveBeenCalled();

    // Wallet switches to Celo Sepolia: live connector + wagmi chainId update.
    setLiveChain(connector, CELO_SEPOLIA_ID, CELO_SEPOLIA_ID);
    await act(async () => {
      refresh!();
    });
    await act(async () => {});

    // The stale chain error must no longer be rendered.
    expect(latestApi!.error).toBeNull();
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("keeps the error and blocks the write when the LIVE chain is still 42220", async () => {
    const { connector, simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      isReconnecting: false,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });

    // Reconciliation watcher re-runs but the live chain is still mainnet.
    setLiveChain(connector, CELO_MAINNET_ID, CELO_MAINNET_ID);
    await act(async () => {
      refresh!();
    });
    await act(async () => {});

    expect(latestApi!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();

    // A fresh attempt must still be blocked.
    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });
    expect(latestApi!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("proceeds to the wallet write path when the LIVE chain is 11142220", async () => {
    const { simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      isReconnecting: false,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });
    await act(async () => {});

    expect(latestApi!.error).toBeNull();
    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0][0]).toMatchObject({
      chainId: CELO_SEPOLIA_ID,
      functionName: "submitEvidenceHash",
      args: [PAYMENT_ID, REFERENCE],
    });
  });

  it("clears a prior transient error when a new submission attempt starts", async () => {
    const { connector, simulateContract, writeContract } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      isReconnecting: false,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    // Attempt 1 fails on live chain.
    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });
    expect(latestApi!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);

    // Chain becomes correct; attempt 2 must start clean and reach the wallet.
    setLiveChain(connector, CELO_SEPOLIA_ID, CELO_SEPOLIA_ID);
    await act(async () => {
      refresh!();
    });
    await act(async () => {
      latestApi!.action(PAYMENT_ID, REFERENCE);
    });
    await act(async () => {});

    expect(latestApi!.error).toBeNull();
    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
});
