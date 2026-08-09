// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SwitchToSepoliaButton — real Sepolia switch action tests
//
//   5) provider really on Mainnet => functional "Switch to Celo Sepolia"
//      button is rendered and clicking calls switchChain({ 11142220 })
//   6) provider already on Sepolia => no button, no wallet switch request
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toHex } from "viem";

const wagmiMocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
  useSwitchChain: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: wagmiMocks.useConnection,
  useSwitchChain: wagmiMocks.useSwitchChain,
}));

vi.mock("@/components/ui/Button", () => ({
  default: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

import SwitchToSepoliaButton from "../SwitchToSepoliaButton";

const CELO_SEPOLIA_ID = 11142220;
const CELO_MAINNET_ID = 42220;

let root: Root | null = null;

function makeProvider(initialChainId: number) {
  const listeners = new Map<string, Set<(value: string) => void>>();
  return {
    request: vi.fn(async () => toHex(initialChainId)),
    on: vi.fn((event: string, handler: (value: string) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    removeListener: vi.fn(() => {}),
    emit: (event: string, value: string) => {
      listeners.get(event)?.forEach((handler) => handler(value));
    },
  };
}

function setupMocks(options: { providerChainId: number }) {
  const provider = makeProvider(options.providerChainId);
  const connector = {
    getProvider: vi.fn(async () => provider),
    getChainId: vi.fn(async () => options.providerChainId),
  };
  wagmiMocks.useConnection.mockReturnValue({
    address: "0x1111111111111111111111111111111111111111",
    chainId: options.providerChainId,
    connector,
    isReconnecting: false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: "connected",
  });
  const switchChain = vi.fn((_args: unknown, callbacks?: { onSuccess?: () => void }) => {
    callbacks?.onSuccess?.();
  });
  wagmiMocks.useSwitchChain.mockReturnValue({
    switchChain,
    isPending: false,
    error: null,
  });
  return { connector, provider, switchChain };
}

async function mountHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SwitchToSepoliaButton />);
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("SwitchToSepoliaButton", () => {
  it("5) renders a functional switch button when the provider is really on Mainnet", async () => {
    const { switchChain } = setupMocks({ providerChainId: CELO_MAINNET_ID });
    await mountHarness();

    const button = document.body.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Switch to Celo Sepolia");

    await act(async () => {
      button!.click();
    });

    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(switchChain.mock.calls[0][0]).toEqual({ chainId: CELO_SEPOLIA_ID });
  });

  it("5b) after the provider switches (chainChanged to Sepolia) the button reconciles away", async () => {
    const { provider, switchChain } = setupMocks({ providerChainId: CELO_MAINNET_ID });
    await mountHarness();

    const button = document.body.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      provider.emit("chainChanged", toHex(CELO_SEPOLIA_ID));
    });
    await act(async () => {});

    // Provider is now on Sepolia — no button, and no further switch was requested.
    expect(document.body.querySelector("button")).toBeNull();
    expect(switchChain).toHaveBeenCalledTimes(0);
  });

  it("6) provider already on Sepolia => no button rendered and no wallet switch requested", async () => {
    const { switchChain } = setupMocks({ providerChainId: CELO_SEPOLIA_ID });
    await mountHarness();

    expect(document.body.querySelector("button")).toBeNull();
    expect(switchChain).not.toHaveBeenCalled();
  });
});
