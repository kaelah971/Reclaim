// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WorkerGasNotice — CELO fee readiness (mocks only, no tx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const balanceMocks = vi.hoisted(() => ({ useBalance: vi.fn() }));

vi.mock("wagmi", () => ({
  useBalance: balanceMocks.useBalance,
}));

import WorkerGasNotice from "../WorkerGasNotice";

let root: Root | null = null;
let bump: (() => void) | null = null;

function Harness(props: { chainId: number; address?: `0x${string}` }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    bump = () => setTick((t) => t + 1);
  }, []);
  return <WorkerGasNotice {...props} />;
}

async function mount(props: { chainId: number; address?: `0x${string}` }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  balanceMocks.useBalance.mockReturnValue({ data: undefined });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  bump = null;
  document.body.innerHTML = "";
});

describe("WorkerGasNotice", () => {
  it("always states CELO is used for transaction fees", async () => {
    await mount({ chainId: 42220 });
    expect(bodyText()).toContain("CELO is used for transaction fees.");
  });

  it("warns when CELO balance is zero (actionable, no faucet)", async () => {
    balanceMocks.useBalance.mockReturnValue({ data: { value: 0n } });
    await mount({
      chainId: 42220,
      address: "0x2222222222222222222222222222222222222222",
    });
    const text = bodyText();
    expect(text).toContain("no CELO");
    expect(text).toContain("Add a small amount of CELO");
    expect(text.toLowerCase()).not.toContain("faucet");
  });

  it("never promises exact gas", async () => {
    balanceMocks.useBalance.mockReturnValue({ data: { value: 0n } });
    await mount({ chainId: 42220 });
    expect(bodyText().toLowerCase()).not.toContain("exact");
    expect(bodyText()).not.toContain("will cost");
  });

  it("stays silent when balance is undeterminable", async () => {
    balanceMocks.useBalance.mockReturnValue({ data: undefined });
    await mount({ chainId: 42220 });
    expect(bodyText()).toContain("CELO is used for transaction fees.");
    expect(bodyText()).not.toContain("no CELO");
  });
});
