// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ReleasePreflight — client release confirmation (P4.4a, mocks only).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import ReleasePreflight from "../ReleasePreflight";

const PREFLIGHT_PATH = resolve(__dirname, "..", "ReleasePreflight.tsx");
function preflightSource(): string {
  return readFileSync(PREFLIGHT_PATH, "utf-8");
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof ReleasePreflight>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReleasePreflight {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return container?.textContent ?? "";
}

function clickButton(text: string) {
  const buttons = Array.from(container?.querySelectorAll("button") ?? []);
  const target = buttons.find((b) => b.textContent?.includes(text));
  if (!target) throw new Error(`button "${text}" not found`);
  target.click();
}

const BASE = {
  amountLabel: "100",
  tokenSymbol: "USAT",
  workerAddress: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  networkName: "Celo Mainnet",
  targetChainId: 42220,
  chainId: 42220,
  canonicalState: "ReleaseRequested",
  isWrongNetwork: false,
  isEligible: true,
  isPending: false,
  isSuccess: false,
  error: null as string | null,
  txHash: undefined as `0x${string}` | undefined,
  onRequestSwitch: vi.fn(),
  onRelease: vi.fn(),
  onRefresh: vi.fn(),
  onDismissError: vi.fn(),
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ReleasePreflight — preflight content", () => {
  it("shows 'Release payment' with exact amount/worker/network + calm irreversibility note", async () => {
    await mount({ ...BASE });
    const text = bodyText();
    expect(text).toContain("Release payment");
    expect(text).toContain("100");
    expect(text).toContain("USAT");
    expect(text).toContain("0x85522bdE267d05bf8CE8813F97c75417b7894A33");
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("cannot be undone");
    expect(text).toContain("Take a moment");
  });

  it("wrong network renders a switch targeting the payment chain (42220)", async () => {
    const onRequestSwitch = vi.fn();
    await mount({ ...BASE, isWrongNetwork: true, onRequestSwitch });
    expect(bodyText()).toContain("Switch to");
    expect(bodyText()).toContain("Celo Mainnet");
    await act(async () => {
      clickButton("Switch to");
    });
    expect(onRequestSwitch).toHaveBeenCalledTimes(1);
    expect(onRequestSwitch).toHaveBeenCalledWith(42220);
  });

  it("ineligible (non-client) shows no release action", async () => {
    const onRelease = vi.fn();
    await mount({ ...BASE, isEligible: false, onRelease });
    expect(bodyText()).toContain("Only the client");
    expect(container?.querySelectorAll("button").length).toBeGreaterThan(0);
    // No "Release payment" action button when ineligible.
    const buttons = Array.from(container?.querySelectorAll("button") ?? []).map(
      (b) => b.textContent ?? "",
    );
    expect(buttons.some((t) => t === "Release payment")).toBe(false);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("release action calls onRelease (existing hook path)", async () => {
    const onRelease = vi.fn();
    await mount({ ...BASE, onRelease });
    await act(async () => {
      clickButton("Release payment");
    });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe("ReleasePreflight — error/retry UX", () => {
  it("pending without hash waits for signature; with hash confirms", async () => {
    await mount({ ...BASE, isPending: true });
    expect(bodyText()).toContain("Waiting for signature");
    await act(async () => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    await mount({
      ...BASE,
      isPending: true,
      txHash: "0xdeadbeef1234" as `0x${string}`,
    });
    expect(bodyText()).toContain("Confirming release");
    expect(bodyText()).toContain("0xdeadbeef1234");
  });

  it("simulation/tx failure renders the error with retry + dismiss", async () => {
    const onRelease = vi.fn();
    const onDismissError = vi.fn();
    await mount({
      ...BASE,
      error: "Simulation failed: caller is not the client.",
      onRelease,
      onDismissError,
    });
    expect(bodyText()).toContain("Simulation failed");
    await act(async () => {
      clickButton("Try again");
    });
    expect(onRelease).toHaveBeenCalledTimes(1);
    await act(async () => {
      clickButton("Dismiss");
    });
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("confirmed-receipt-but-stale-read is authoritative-refresh, never rebroadcast, never fake Released", async () => {
    const onRelease = vi.fn();
    const onRefresh = vi.fn();
    await mount({
      ...BASE,
      isSuccess: true,
      txHash: "0xabc123" as `0x${string}`,
      canonicalState: "ReleaseRequested",
      onRelease,
      onRefresh,
    });
    const text = bodyText();
    expect(text).toContain("confirmed");
    expect(text).toContain("Refresh payment data");
    expect(text).toContain("View on Celo Explorer");
    expect(text).toContain("Do not resubmit");
    // Never fakes settlement and never auto-rebroadcasts.
    expect(text).not.toContain("Payment released");
    expect(onRelease).not.toHaveBeenCalled();
    await act(async () => {
      clickButton("Refresh payment data");
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });
});

describe("ReleasePreflight — chain + safety source guards", () => {
  it("targets the payment chain explorer for both networks (Sepolia regression)", () => {
    const src = preflightSource();
    expect(src).toContain("CELO_MAINNET_CHAIN_ID");
    expect(src).toContain("getCeloMainnetExplorerTxUrl");
    expect(src).toContain("getCeloExplorerTxUrl");
  });

  it("never presents optimistic settlement and never writes directly", () => {
    const src = preflightSource();
    expect(src).not.toContain("Payment released");
    expect(src).not.toContain("writeContract(");
    expect(src).not.toContain("simulateContract");
    // Stale reads refresh canonical state instead of rebroadcasting.
    expect(src).toContain('canonicalState !== "Released"');
    expect(src).toContain("Do not resubmit");
  });

  it("renders a Mainnet explorer link (celoscan) for 42220", async () => {
    await mount({
      ...BASE,
      isSuccess: true,
      txHash: "0xabc123" as `0x${string}`,
      canonicalState: "ReleaseRequested",
      chainId: 42220,
    });
    const link = container?.querySelector('a[href*="celoscan.io"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("0xabc123");
  });

  it("renders a Sepolia explorer link (non-celoscan) for 11142220", async () => {
    await act(async () => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    await mount({
      ...BASE,
      networkName: "Celo Sepolia",
      targetChainId: 11142220,
      chainId: 11142220,
      isSuccess: true,
      txHash: "0xabc123" as `0x${string}`,
      canonicalState: "ReleaseRequested",
    });
    const link = container?.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("0xabc123");
    expect(link?.getAttribute("href")).not.toContain("celoscan.io");
  });
});
