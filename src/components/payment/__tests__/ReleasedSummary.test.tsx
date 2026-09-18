// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ReleasedSummary — canonical settlement summary (P4.4a, mocks only).
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import ReleasedSummary from "../ReleasedSummary";

const SUMMARY_PATH = resolve(__dirname, "..", "ReleasedSummary.tsx");
function summarySource(): string {
  return readFileSync(SUMMARY_PATH, "utf-8");
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof ReleasedSummary>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReleasedSummary {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return container?.textContent ?? "";
}

const BASE = {
  amountLabel: "100",
  tokenSymbol: "USAT",
  workerAddress: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  networkName: "Celo Mainnet",
  paymentId: "7",
  chainId: 42220,
  txHash: "0xrelease123" as `0x${string}` | undefined,
  releasedAtLabel: "2026-09-18T00:00:00.000Z",
  receiptHref: "/receipts/7",
  receiptLabel: "View receipt",
  sharePaymentId: "7",
  shareChainId: 42220,
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("ReleasedSummary — client settlement", () => {
  it("shows 'Payment released' + amount/token/freelancer/network/id/tx/explorer/time + receipt + copy", async () => {
    await mount({ ...BASE, role: "client" });
    const text = bodyText();
    expect(text).toContain("Payment released");
    expect(text).toContain("100");
    expect(text).toContain("USAT");
    expect(text).toContain("0x85522bdE267d05bf8CE8813F97c75417b7894A33");
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("7");
    expect(text).toContain("0xrelease123");
    expect(text).toContain("View on Celo Explorer");
    expect(text).toContain("2026-09-18");
    expect(text).toContain("View receipt");
    expect(text).toContain("Copy payment link");
  });

  it("receipt links to the settlement route and explorer links the tx", async () => {
    await mount({ ...BASE, role: "client" });
    const receipt = container?.querySelector('a[href="/receipts/7"]');
    expect(receipt).not.toBeNull();
    expect(receipt?.textContent).toContain("View receipt");
    const explorer = container?.querySelector('a[href*="0xrelease123"]');
    expect(explorer).not.toBeNull();
    expect(explorer?.getAttribute("href")).toContain("celoscan.io");
  });

  it("renders no release action after Released", async () => {
    await mount({ ...BASE, role: "client" });
    const text = bodyText();
    expect(text).not.toContain("Release payment");
    expect(text).not.toContain("Approve release");
    const src = summarySource();
    expect(src).not.toContain("approveRelease.action");
    expect(src).not.toContain("Release payment");
    expect(src).not.toContain("Approve release");
  });
});

describe("ReleasedSummary — worker settlement", () => {
  it("shows 'Payment received' with the same canonical settlement data", async () => {
    await mount({ ...BASE, role: "worker" });
    const text = bodyText();
    expect(text).toContain("Payment received");
    expect(text).not.toContain("Payment released");
    expect(text).toContain("100");
    expect(text).toContain("USAT");
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("7");
    expect(text).toContain("0xrelease123");
    expect(text).toContain("View receipt");
  });

  it("derives from canonical props (never local tx state)", () => {
    const src = summarySource();
    expect(src).toContain("canonical");
    expect(src).not.toContain("isSuccess");
    expect(src).not.toContain("useApproveRelease");
  });
});

describe("ReleasedSummary — chains (Sepolia regression)", () => {
  it("renders Sepolia settlement without celoscan", async () => {
    await mount({
      ...BASE,
      role: "client",
      tokenSymbol: "USDC",
      networkName: "Celo Sepolia",
      chainId: 11142220,
      shareChainId: 11142220,
    });
    const text = bodyText();
    expect(text).toContain("Payment released");
    expect(text).toContain("USDC");
    expect(text).toContain("Celo Sepolia");
    const explorer = container?.querySelector('a[href*="0xrelease123"]');
    expect(explorer).not.toBeNull();
    expect(explorer?.getAttribute("href")).not.toContain("celoscan.io");
  });

  it("is chain-aware for both explorers in source", () => {
    const src = summarySource();
    expect(src).toContain("CELO_MAINNET_CHAIN_ID");
    expect(src).toContain("getCeloMainnetExplorerTxUrl");
    expect(src).toContain("getCeloExplorerTxUrl");
  });
});
