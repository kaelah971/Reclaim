// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useWalletState — live chain reconciliation tests
//
// The wagmi connection chainId can be a stale hydrated value (e.g. 42220
// persisted from a previous Celo Mainnet session). useWalletState must
// resolve the LIVE connector chain (eth_chainId) and present that as
// authoritative. Cases covered:
//   a) hydrated 42220    + live connector 11142220 => UI resolves Sepolia
//   b) hydrated 11142220 + live connector 42220    => UI resolves Mainnet
//   c) reconnecting state is not presented as authoritative
//   d) Celo Mainnet remains supported (x402 facilitator flows stay valid)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getChainName, isSupportedChain, CELO_CHAIN_ID } from "@/lib/web3/chains";

const wagmiMocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
  useDisconnect: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: wagmiMocks.useConnection,
  useDisconnect: wagmiMocks.useDisconnect,
}));

import { useWalletState } from "../useWalletState";

const CELO_SEPOLIA_ID = 11142220;
const CELO_MAINNET_ID = 42220;

type WalletApi = ReturnType<typeof useWalletState>;

let latest: WalletApi | null = null;
let root: Root | null = null;

function setupWagmiMocks(
  options: {
    storeChainId?: number;
    isReconnecting?: boolean;
    liveChainId?: number;
    liveChainRejects?: boolean;
  } = {},
) {
  const connector = {
    getChainId: vi.fn(() =>
      options.liveChainRejects
        ? Promise.reject(new Error("provider unavailable"))
        : Promise.resolve(options.liveChainId ?? CELO_SEPOLIA_ID),
    ),
  };

  wagmiMocks.useConnection.mockReturnValue({
    address: "0x1111111111111111111111111111111111111111",
    chainId: options.storeChainId ?? CELO_SEPOLIA_ID,
    connector,
    isReconnecting: options.isReconnecting ?? false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: options.isReconnecting ? "reconnecting" : "connected",
  });

  wagmiMocks.useDisconnect.mockReturnValue({ mutate: vi.fn() });

  return { connector };
}

function Harness() {
  const wallet = useWalletState();
  useEffect(() => {
    latest = wallet;
  }, [wallet]);
  return null;
}

async function mountHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness />);
  });
  // Flush the async connector.getChainId() reconciliation.
  await act(async () => {});
}

beforeEach(() => {
  latest = null;
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("useWalletState — live chain reconciliation", () => {
  it("a) resolves Sepolia when live connector is 11142220 despite hydrated 42220", async () => {
    const { connector } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    expect(connector.getChainId).toHaveBeenCalled();
    expect(latest!.chainId).toBe(CELO_SEPOLIA_ID);
    expect(getChainName(latest!.chainId)).toBe("Celo Sepolia");
    expect(latest!.chainSupported).toBe(true);
  });

  it("b) resolves Mainnet when live connector is 42220 despite hydrated 11142220", async () => {
    const { connector } = setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    expect(connector.getChainId).toHaveBeenCalled();
    expect(latest!.chainId).toBe(CELO_MAINNET_ID);
    expect(getChainName(latest!.chainId)).toBe("Celo Mainnet");
    expect(latest!.chainSupported).toBe(true);
  });

  it("c) does not present the hydrated chain as authoritative while reconnecting", async () => {
    setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      isReconnecting: true,
      liveChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    expect(latest!.isReconnecting).toBe(true);
    expect(latest!.chainId).toBeUndefined();
    expect(latest!.chainSupported).toBe(false);
    expect(getChainName(latest!.chainId)).toBe("Unknown network");
  });

  it("d) keeps Celo Mainnet supported when the live connector reports 42220 (x402 facilitator)", async () => {
    setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      liveChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    expect(isSupportedChain(CELO_MAINNET_ID)).toBe(true);
    expect(isSupportedChain(CELO_SEPOLIA_ID)).toBe(true);
    expect(latest!.chainId).toBe(CELO_MAINNET_ID);
    expect(latest!.chainSupported).toBe(true);
  });
});

describe("remaining action gates use the reconciled chain", () => {
  const createPaymentPath = resolve(__dirname, "..", "..", "contracts", "useCreatePayment.ts");
  const tokenApprovalPath = resolve(__dirname, "..", "..", "contracts", "useTokenApproval.ts");

  it("useCreatePayment gates on useWalletState chainId, not useAccount", () => {
    const source = readFileSync(createPaymentPath, "utf-8");
    expect(source).toContain("useWalletState");
    expect(source).not.toContain("useAccount");
    expect(source).toContain("wallet.chainId !== getEscrowChainId()");
  });

  it("useTokenApproval gates on useWalletState chainId, not useAccount", () => {
    const source = readFileSync(tokenApprovalPath, "utf-8");
    expect(source).toContain("useWalletState");
    expect(source).not.toContain("useAccount");
    expect(source).toContain("wallet.chainId !== getEscrowChainId()");
  });

  it("escrow chain constants remain on Celo Sepolia", () => {
    expect(CELO_CHAIN_ID).toBe(CELO_SEPOLIA_ID);
  });
});
