// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WalletAccountMenu — ChainDiagnostics dev-gating tests
//
// The troubleshooting widget must only render while the dev-only
// CHAIN_DIAGNOSTICS_ENABLED flag is on (never in production). The flag is
// mocked via a hoisted getter so it can be flipped between tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toHex } from "viem";

const diagMock = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/web3/devDiagnostics", () => ({
  get CHAIN_DIAGNOSTICS_ENABLED() {
    return diagMock.enabled;
  },
}));

const wagmiMocks = vi.hoisted(() => ({
  useChainId: vi.fn(),
  useConnection: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useChainId: wagmiMocks.useChainId,
  useConnection: wagmiMocks.useConnection,
}));

vi.mock("@/providers/WalletGateProvider", () => ({
  useWalletGate: () => ({ requestNetworkSwitch: vi.fn() }),
}));

import WalletAccountMenu from "../WalletAccountMenu";

const ADDRESS = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const CELO_SEPOLIA_ID = 11142220;

let root: Root | null = null;

function makeWallet() {
  return {
    address: ADDRESS,
    shortAddress: "0x76D7…7486",
    chainId: CELO_SEPOLIA_ID,
    chainSupported: true,
    disconnect: vi.fn(),
  };
}

function setupWagmi() {
  const provider = {
    request: vi.fn(async () => toHex(CELO_SEPOLIA_ID)),
    on: vi.fn(),
    removeListener: vi.fn(),
    name: "injected",
  };
  const connector = {
    getProvider: vi.fn(async () => provider),
    getChainId: vi.fn(async () => CELO_SEPOLIA_ID),
  };
  wagmiMocks.useChainId.mockReturnValue(CELO_SEPOLIA_ID);
  wagmiMocks.useConnection.mockReturnValue({
    address: ADDRESS,
    chainId: CELO_SEPOLIA_ID,
    connector,
    isReconnecting: false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: "connected",
  });
  return { connector, provider };
}

async function mountMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <WalletAccountMenu wallet={makeWallet()} onClose={vi.fn()} />,
    );
  });
  await act(async () => {});
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("WalletAccountMenu — ChainDiagnostics gating", () => {
  it("does not render ChainDiagnostics when CHAIN_DIAGNOSTICS_ENABLED is false", async () => {
    diagMock.enabled = false;
    setupWagmi();
    await mountMenu();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("eth_chainId");
    expect(text).not.toContain("connector.getChainId");
  });

  it("renders ChainDiagnostics when CHAIN_DIAGNOSTICS_ENABLED is true", async () => {
    diagMock.enabled = true;
    setupWagmi();
    await mountMenu();

    const text = document.body.textContent ?? "";
    expect(text).toContain("provider.eth_chainId");
    expect(text).toContain("store: 11142220");
    expect(text).toContain("account: 11142220");
    expect(text).toContain("connector.getChainId: 11142220");
  });
});
