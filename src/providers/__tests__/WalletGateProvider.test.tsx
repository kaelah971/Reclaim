// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WalletGateProvider — stale gate auto-dismiss logic + switch-target tests
//
// shouldAutoDismissSwitchGate: pure gate-dismiss rules (unchanged).
// resolveSwitchTarget: fail-closed target resolution — omitted/unsupported
//   IDs fall back to the Sepolia default; explicit Mainnet passes through.
// Provider + WalletDialog integration (mocked wagmi, no real tx): the
//   default switch targets Sepolia, 42220 targets the Mainnet escrow chain
//   and the dialog shows it, unsupported IDs fall back to Sepolia.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const wagmiMocks = vi.hoisted(() => ({
  useConnect: vi.fn(),
  useConnectors: vi.fn(),
  useSwitchChain: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnect: wagmiMocks.useConnect,
  useConnectors: wagmiMocks.useConnectors,
  useSwitchChain: wagmiMocks.useSwitchChain,
}));

const walletStateMocks = vi.hoisted(() => ({
  wallet: {
    address: "0x1111111111111111111111111111111111111111",
    shortAddress: "0x1111…1111",
    connectionState: "connected",
    isConnected: true,
    isConnecting: false,
    isReconnecting: false,
    chainId: 1,
    chainSupported: false,
    disconnect: vi.fn(),
  },
}));

vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: () => walletStateMocks.wallet,
}));

import WalletGateProvider, {
  resolveSwitchTarget,
  useWalletGate,
  type WalletGateContextValue,
} from "../WalletGateProvider";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  CELO_NETWORK_NAME,
  getChainName,
} from "@/lib/web3/chains";

/**
 * Determines whether the switch-network gate should auto-dismiss.
 *
 * The gate should close when:
 *   - The gate is currently showing the switch dialog (mode === "switch")
 *   - The wallet has become connected on a supported chain
 *
 * Returns true when the gate should auto-close. When true, the pending
 * action must be cleared (user must explicitly retry).
 */
function shouldAutoDismissSwitchGate(
  mode: "connect" | "switch" | null,
  isConnected: boolean,
  chainSupported: boolean,
): boolean {
  if (mode !== "switch") return false;
  return isConnected && chainSupported;
}

describe("shouldAutoDismissSwitchGate", () => {
  it("returns false when not in switch mode", () => {
    expect(shouldAutoDismissSwitchGate(null, true, true)).toBe(false);
    expect(shouldAutoDismissSwitchGate("connect", true, true)).toBe(false);
  });

  it("returns false when wallet is not connected", () => {
    expect(shouldAutoDismissSwitchGate("switch", false, false)).toBe(false);
    expect(shouldAutoDismissSwitchGate("switch", false, true)).toBe(false);
  });

  it("returns false when chain is unsupported", () => {
    // Stale gate — chainSupported still false
    expect(shouldAutoDismissSwitchGate("switch", true, false)).toBe(false);
  });

  it("returns true when chain becomes supported after stale gate", () => {
    // Gate is open, wallet connected, chain now supported
    expect(shouldAutoDismissSwitchGate("switch", true, true)).toBe(true);
  });

  it("returns true re-actively when chain resolves", () => {
    // Simulate: stale state (chain undefined → false)
    const stale = shouldAutoDismissSwitchGate("switch", true, false);
    expect(stale).toBe(false);

    // After hydration: chain resolves to valid (chainSupported → true)
    const resolved = shouldAutoDismissSwitchGate("switch", true, true);
    expect(resolved).toBe(true);
  });
});

describe("resolveSwitchTarget", () => {
  it("defaults to the Sepolia escrow chain when omitted", () => {
    expect(resolveSwitchTarget()).toBe(CELO_CHAIN_ID);
    expect(resolveSwitchTarget(undefined)).toBe(CELO_CHAIN_ID);
  });

  it("passes Celo Mainnet (42220) through for the Mainnet escrow chain", () => {
    expect(resolveSwitchTarget(CELO_MAINNET_CHAIN_ID)).toBe(42220);
  });

  it("passes an explicit Sepolia ID through unchanged", () => {
    expect(resolveSwitchTarget(CELO_CHAIN_ID)).toBe(CELO_CHAIN_ID);
  });

  it("ignores unsupported chain IDs and falls back to default (never throws)", () => {
    expect(() => resolveSwitchTarget(1)).not.toThrow();
    expect(resolveSwitchTarget(1)).toBe(CELO_CHAIN_ID);
    expect(resolveSwitchTarget(8453)).toBe(CELO_CHAIN_ID);
    expect(resolveSwitchTarget(137)).toBe(CELO_CHAIN_ID);
  });
});

describe("WalletGateProvider — switch target integration", () => {
  let root: Root | null = null;
  let gate: WalletGateContextValue | null = null;

  function Harness() {
    gate = useWalletGate();
    return null;
  }

  async function mountProvider() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <WalletGateProvider>
          <Harness />
        </WalletGateProvider>,
      );
    });
    await act(async () => {});
  }

  function findButton(label: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Button "${label}" not found`);
    return found as HTMLButtonElement;
  }

  beforeEach(() => {
    gate = null;
    vi.clearAllMocks();
    wagmiMocks.useConnectors.mockReturnValue([]);
    wagmiMocks.useConnect.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    wagmiMocks.useSwitchChain.mockReturnValue({
      mutate: wagmiMocks.switchChain,
      isPending: false,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    gate = null;
    document.body.innerHTML = "";
  });

  it("default switch targets Sepolia and the dialog shows it", async () => {
    await mountProvider();
    await act(async () => {
      gate!.requestNetworkSwitch();
    });

    const text = document.body.textContent ?? "";
    expect(text).toContain(CELO_NETWORK_NAME);
    expect(text).toContain(String(CELO_CHAIN_ID));

    await act(async () => {
      findButton(`Switch to ${CELO_NETWORK_NAME}`).click();
    });
    expect(wagmiMocks.switchChain).toHaveBeenCalledTimes(1);
    expect(wagmiMocks.switchChain.mock.calls[0]![0]).toEqual({
      chainId: CELO_CHAIN_ID,
    });
  });

  it("passing 42220 targets the Mainnet escrow chain and the dialog shows it", async () => {
    expect(getChainName(CELO_MAINNET_CHAIN_ID)).toBe("Celo Mainnet");
    await mountProvider();
    await act(async () => {
      gate!.requestNetworkSwitch(CELO_MAINNET_CHAIN_ID);
    });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("42220");

    await act(async () => {
      findButton("Switch to Celo Mainnet").click();
    });
    expect(wagmiMocks.switchChain).toHaveBeenCalledTimes(1);
    expect(wagmiMocks.switchChain.mock.calls[0]![0]).toEqual({
      chainId: 42220,
    });
  });

  it("unsupported chain IDs fall back to Sepolia and never throw into the UI", async () => {
    await mountProvider();
    let threw: unknown = null;
    await act(async () => {
      try {
        gate!.requestNetworkSwitch(1);
      } catch (error) {
        threw = error;
      }
    });
    expect(threw).toBeNull();

    const text = document.body.textContent ?? "";
    expect(text).toContain(CELO_NETWORK_NAME);
    expect(text).toContain(String(CELO_CHAIN_ID));

    await act(async () => {
      findButton(`Switch to ${CELO_NETWORK_NAME}`).click();
    });
    expect(wagmiMocks.switchChain).toHaveBeenCalledTimes(1);
    expect(wagmiMocks.switchChain.mock.calls[0]![0]).toEqual({
      chainId: CELO_CHAIN_ID,
    });
  });
});
