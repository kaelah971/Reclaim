// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useProviderWalletChain — listener lifecycle regression tests
//
// Catches the RA1R.6O crash: MetaMask's EventEmitter removeListener reads
// instance state via `this` (this._events). Unbinding/copying the method
// and invoking it detached crashes. All tests use a context-dependent
// provider whose methods throw when `this` is lost, exactly like MetaMask.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toHex } from "viem";

const wagmiMocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: wagmiMocks.useConnection,
}));

import { useProviderWalletChain } from "../useProviderWalletChain";

const CELO_SEPOLIA_ID = 11142220;
const CELO_MAINNET_ID = 42220;

/** Provider whose methods REQUIRE `this` — mirrors MetaMask's EventEmitter
 *  (which reads this._events). Detached invocation throws a TypeError. */
class ContextualProvider {
  private listeners = new Map<string, Set<(value: string) => void>>();

  request = vi.fn(async () => toHex(CELO_MAINNET_ID));

  on(event: string, handler: (value: string) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  removeListener(event: string, handler: (value: string) => void): void {
    // Same class of crash as MetaMask's `this._events` access when `this`
    // is lost: `this.listeners` on undefined throws.
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, value: string): void {
    this.listeners.get(event)?.forEach((handler) => handler(value));
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

let latest: number | undefined;
let refresh: (() => void) | null = null;
let root: Root | null = null;

function Harness() {
  const chainId = useProviderWalletChain();
  const [, force] = useState(0);
  useEffect(() => {
    latest = chainId;
    refresh = () => force((v) => v + 1);
  }, [chainId]);
  return null;
}

async function mountHarness(node: ReactNode = <Harness />) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {});
}

function setup(options: { connector?: ReturnType<typeof makeConnector> } = {}) {
  const connector = options.connector ?? makeConnector(new ContextualProvider());
  wagmiMocks.useConnection.mockReturnValue({
    address: "0x1111111111111111111111111111111111111111",
    chainId: CELO_MAINNET_ID,
    connector,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    isReconnecting: false,
    status: "connected",
  });
  return { connector };
}

function makeConnector(provider: ContextualProvider) {
  return {
    getProvider: vi.fn(async () => provider),
    getChainId: vi.fn(async () => CELO_MAINNET_ID),
  };
}

beforeEach(() => {
  latest = undefined;
  refresh = null;
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("useProviderWalletChain — listener lifecycle", () => {
  it("subscribes on mount and cleans up the SAME provider instance without throwing", async () => {
    const provider = new ContextualProvider();
    setup({ connector: makeConnector(provider) });
    await mountHarness();

    expect(provider.listenerCount("chainChanged")).toBe(1);
    expect(latest).toBe(CELO_MAINNET_ID);

    // Cleanup must not throw (detached removeListener would crash) and must
    // actually remove the listener.
    await act(async () => {
      root!.unmount();
    });
    expect(provider.listenerCount("chainChanged")).toBe(0);
  });

  it("provider replacement cleans the listener from the OLD provider instance", async () => {
    const oldProvider = new ContextualProvider();
    setup({ connector: makeConnector(oldProvider) });
    await mountHarness();

    expect(oldProvider.listenerCount("chainChanged")).toBe(1);

    const newProvider = new ContextualProvider();
    setup({ connector: makeConnector(newProvider) });
    await act(async () => {
      refresh!();
    });
    await act(async () => {});

    expect(oldProvider.listenerCount("chainChanged")).toBe(0);
    expect(newProvider.listenerCount("chainChanged")).toBe(1);
  });

  it("React Strict Mode repeated mount/cleanup does not throw or leak listeners", async () => {
    const provider = new ContextualProvider();
    setup({ connector: makeConnector(provider) });
    await mountHarness(<StrictMode><Harness /></StrictMode>);

    // StrictMode runs setup → cleanup → setup; exactly one live listener
    // must remain and no cleanup may have thrown.
    expect(provider.listenerCount("chainChanged")).toBe(1);
    expect(latest).toBe(CELO_MAINNET_ID);
  });

  it("network change Mainnet→Sepolia updates the resolved chain immediately", async () => {
    const provider = new ContextualProvider();
    setup({ connector: makeConnector(provider) });
    await mountHarness();

    expect(latest).toBe(CELO_MAINNET_ID);

    await act(async () => {
      provider.emit("chainChanged", toHex(CELO_SEPOLIA_ID));
    });

    expect(latest).toBe(CELO_SEPOLIA_ID);
    expect(provider.listenerCount("chainChanged")).toBe(1);
  });

  it("obsolete async provider resolution after cleanup cannot install a leaked listener", async () => {
    let resolveProvider!: (provider: ContextualProvider) => void;
    const provider = new ContextualProvider();
    const connector = {
      getProvider: vi.fn(
        () =>
          new Promise<ContextualProvider>((resolve) => {
            resolveProvider = resolve;
          }),
      ),
      getChainId: vi.fn(async () => CELO_MAINNET_ID),
    };
    setup({ connector });
    await mountHarness();

    // Unmount BEFORE the provider lookup resolves.
    await act(async () => {
      root!.unmount();
    });

    // The obsolete effect must not subscribe after cleanup.
    await act(async () => {
      resolveProvider(provider);
    });
    await act(async () => {});

    expect(provider.listenerCount("chainChanged")).toBe(0);
  });
});
