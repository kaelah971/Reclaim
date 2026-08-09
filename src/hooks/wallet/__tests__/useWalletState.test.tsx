// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useWalletState — authoritative provider-chain resolution tests
//
// The DIRECT EIP-1193 provider read (provider.request eth_chainId) is the
// single source of chain truth once connected. The hydrated/store chainId
// and connector.getChainId() are never the final truth. Cases covered:
//   1) store 42220 + connector.getChainId 42220 + provider eth_chainId
//      11142220 => UI resolves Celo Sepolia
//   2) store 11142220 + provider eth_chainId 42220 => UI resolves Mainnet
//   3) provider chainChanged => UI updates immediately
//   4) unresolved provider never exposes a stale chain
//   6) already-Sepolia provider reconciles without any wallet switch
//   7) Celo Mainnet remains supported (x402 facilitator flows valid)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getChainName, isSupportedChain, CELO_CHAIN_ID } from "@/lib/web3/chains";
import { toHex } from "viem";

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

interface FakeProvider {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  isMetaMask: boolean;
  emit: (event: "chainChanged", value: string) => void;
}

function makeProvider(initialChainId: number): FakeProvider {
  const listeners = new Map<string, Set<(value: string) => void>>();
  const provider: FakeProvider = {
    isMetaMask: true,
    request: vi.fn(async () => toHex(initialChainId)),
    on: vi.fn((event: string, handler: (value: string) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    removeListener: vi.fn((event: string, handler: (value: string) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: (event: "chainChanged", value: string) => {
      listeners.get(event)?.forEach((handler) => handler(value));
    },
  };
  return provider;
}

function setupWagmiMocks(options: {
  storeChainId?: number;
  connectorGetChainId?: number;
  providerChainId?: number;
  providerRejects?: boolean;
  isReconnecting?: boolean;
}) {
  const provider = makeProvider(options.providerChainId ?? CELO_SEPOLIA_ID);
  if (options.providerRejects) {
    provider.request.mockRejectedValue(new Error("provider unavailable"));
  }

  const connector = {
    getChainId: vi.fn(async () => options.connectorGetChainId ?? CELO_SEPOLIA_ID),
    getProvider: vi.fn(async () => provider),
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

  return { connector, provider };
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
  // Flush the async provider eth_chainId resolution.
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

describe("useWalletState — authoritative provider chain resolution", () => {
  it("1) resolves Sepolia when store AND connector.getChainId are 42220 but the provider eth_chainId is 11142220", async () => {
    const { provider } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      connectorGetChainId: CELO_MAINNET_ID,
      providerChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    expect(provider.request).toHaveBeenCalledWith({ method: "eth_chainId" });
    expect(latest!.chainId).toBe(CELO_SEPOLIA_ID);
    expect(getChainName(latest!.chainId)).toBe("Celo Sepolia");
    expect(latest!.chainSupported).toBe(true);
  });

  it("2) resolves Mainnet when the provider eth_chainId is 42220 despite store 11142220", async () => {
    setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      providerChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    expect(latest!.chainId).toBe(CELO_MAINNET_ID);
    expect(getChainName(latest!.chainId)).toBe("Celo Mainnet");
    expect(latest!.chainSupported).toBe(true);
  });

  it("3) updates the UI immediately when the provider emits chainChanged to 11142220", async () => {
    const { provider } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      providerChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    expect(latest!.chainId).toBe(CELO_MAINNET_ID);

    await act(async () => {
      provider.emit("chainChanged", toHex(CELO_SEPOLIA_ID));
    });

    expect(latest!.chainId).toBe(CELO_SEPOLIA_ID);
    expect(getChainName(latest!.chainId)).toBe("Celo Sepolia");
  });

  it("4) never exposes a stale chain while the provider chain is unresolved", async () => {
    setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      providerRejects: true,
    });
    await mountHarness();

    expect(latest!.chainId).toBeUndefined();
    expect(latest!.chainSupported).toBe(false);
    expect(getChainName(latest!.chainId)).toBe("Unknown network");
  });

  it("4b) does not expose the hydrated chain while wagmi is still reconnecting", async () => {
    setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      providerChainId: CELO_SEPOLIA_ID,
      isReconnecting: true,
    });
    await mountHarness();

    expect(latest!.isReconnecting).toBe(true);
    expect(latest!.chainId).toBeUndefined();
  });

  it("6) already-Sepolia provider resolves without asking the wallet to switch", async () => {
    const { connector, provider } = setupWagmiMocks({
      storeChainId: CELO_MAINNET_ID,
      connectorGetChainId: CELO_MAINNET_ID,
      providerChainId: CELO_SEPOLIA_ID,
    });
    await mountHarness();

    expect(latest!.chainId).toBe(CELO_SEPOLIA_ID);
    expect(provider.request).toHaveBeenCalledTimes(1); // one direct read, no switch involved
    expect(connector.getChainId).toHaveBeenCalledTimes(0); // connector read NOT used for truth
  });

  it("7) keeps Celo Mainnet supported when the provider reports 42220 (x402 facilitator)", async () => {
    setupWagmiMocks({
      storeChainId: CELO_SEPOLIA_ID,
      providerChainId: CELO_MAINNET_ID,
    });
    await mountHarness();

    expect(isSupportedChain(CELO_MAINNET_ID)).toBe(true);
    expect(isSupportedChain(CELO_SEPOLIA_ID)).toBe(true);
    expect(latest!.chainId).toBe(CELO_MAINNET_ID);
    expect(latest!.chainSupported).toBe(true);
    expect(CELO_CHAIN_ID).toBe(CELO_SEPOLIA_ID); // escrow chain unchanged
  });
});

describe("remaining action gates consume the shared resolved chain", () => {
  const createPaymentPath = resolve(__dirname, "..", "..", "contracts", "useCreatePayment.ts");
  const tokenApprovalPath = resolve(__dirname, "..", "..", "contracts", "useTokenApproval.ts");
  const walletStatePath = resolve(__dirname, "..", "useWalletState.ts");
  const providerChainPath = resolve(__dirname, "..", "useProviderWalletChain.ts");

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

  it("useWalletState resolves the chain from the shared provider resolver, not the store", () => {
    const source = readFileSync(walletStatePath, "utf-8");
    expect(source).toContain("useProviderWalletChain");
    expect(source).toContain("resolvedChainId = !isConnected || isReconnecting ? undefined : providerChainId");
  });

  it("useProviderWalletChain reads eth_chainId directly from the EIP-1193 provider", () => {
    const source = readFileSync(providerChainPath, "utf-8");
    expect(source).toContain("getProvider");
    expect(source).toContain('method: "eth_chainId"');
    expect(source).toContain("chainChanged");
    expect(source).toContain("removeListener");
  });
});
