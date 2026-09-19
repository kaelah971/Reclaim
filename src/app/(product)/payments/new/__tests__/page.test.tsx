// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// /payments/new guided flow — page tests (mocks only, no real tx).
//
// Covers: Mainnet default (USA₮/Celo, never USDC), step transitions +
// validation errors, wrong-network Switch-to-Celo behavior, preflight
// contents, Protect wiring (exact params), Sepolia selection, progress /
// error / retry UI, and the "Payment protected" success + redirect.
// Orchestration order + retry-no-recreate are covered in
// src/hooks/payment/__tests__/useProtectPaymentFlow.test.tsx.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const walletMocks = vi.hoisted(() => ({
  requireWallet: vi.fn((action: () => void) => action()),
  requestNetworkSwitch: vi.fn(),
  wallet: {
    address: undefined as string | undefined,
    chainId: undefined as number | undefined,
    isConnected: false,
  },
}));
const flowMocks = vi.hoisted(() => ({
  useProtectPaymentFlow: vi.fn(),
  flow: {
    chainId: 0,
    phase: "idle" as string,
    createdPaymentId: undefined as bigint | undefined,
    start: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    isWorking: false,
    error: null as string | null,
    progressLabel: null as string | null,
    createTxHash: undefined as `0x${string}` | undefined,
    approveTxHash: undefined as `0x${string}` | undefined,
    fundTxHash: undefined as `0x${string}` | undefined,
    tokenBalance: undefined as bigint | undefined,
    isLoadingTokenBalance: false,
  },
}));
const balanceMocks = vi.hoisted(() => ({ useBalance: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerMocks.push }),
}));

vi.mock("@/hooks/wallet/useRequireWallet", () => ({
  useRequireWallet: () => ({
    requireWallet: walletMocks.requireWallet,
    requestNetworkSwitch: walletMocks.requestNetworkSwitch,
    wallet: walletMocks.wallet,
  }),
}));

vi.mock("@/hooks/payment/useProtectPaymentFlow", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/hooks/payment/useProtectPaymentFlow")>();
  return {
    ...orig,
    useProtectPaymentFlow: flowMocks.useProtectPaymentFlow,
  };
});

vi.mock("@/components/ui/WalletButton", () => ({
  default: () => <button type="button">Connect wallet</button>,
}));

vi.mock("wagmi", () => ({
  useBalance: balanceMocks.useBalance,
}));

import CreatePaymentPage from "../page";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";

const MAINNET_ID = DEFAULT_NEW_PAYMENT_CHAIN_ID;
const WORKER = "0x2222222222222222222222222222222222222222";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let root: Root | null = null;
let bump: (() => void) | null = null;

function Harness() {
  const [, setTick] = useState(0);
  useEffect(() => {
    bump = () => setTick((t) => t + 1);
  }, []);
  return <CreatePaymentPage />;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness />);
  });
  await act(async () => {});
}

async function rerender() {
  await act(async () => {
    bump!();
  });
  await act(async () => {});
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function findButton(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button "${label}" not found`);
  return found as HTMLButtonElement;
}

function queryButtons(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement[];
}

async function click(label: string) {
  const button = findButton(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {});
}

function setInput(id: string, value: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!el) throw new Error(`Input #${id} not found`);
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(id: string, value: string) {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (!el) throw new Error(`Select #${id} not found`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function completeStep1() {
  setInput("freelancer-wallet", WORKER);
  setInput("amount", "100");
  await click("Continue to terms");
}

async function completeStep2() {
  setInput("agreement-title", "Landing page");
  setInput("deliverable-description", "Design files");
  setInput("delivery-date", "2030-01-01");
  setSelect("how-should-the-money-be-released?", "buyer-approval");
  await click("Continue to review");
}

beforeEach(() => {
  vi.clearAllMocks();
  walletMocks.requireWallet.mockImplementation((action: () => void) => action());
  walletMocks.wallet.address = undefined;
  walletMocks.wallet.chainId = undefined;
  walletMocks.wallet.isConnected = false;
  Object.assign(flowMocks.flow, {
    chainId: MAINNET_ID,
    phase: "idle",
    createdPaymentId: undefined,
    isWorking: false,
    error: null,
    progressLabel: null,
    createTxHash: undefined,
    approveTxHash: undefined,
    fundTxHash: undefined,
    tokenBalance: undefined,
    isLoadingTokenBalance: false,
  });
  flowMocks.useProtectPaymentFlow.mockImplementation(
    (chainId: number = MAINNET_ID) => ({ ...flowMocks.flow, chainId }),
  );
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/payments/new — Mainnet default", () => {
  it("creates the flow on the canonical new-payment chain", async () => {
    await mount();
    expect(flowMocks.useProtectPaymentFlow).toHaveBeenCalledWith(MAINNET_ID);
  });

  it("shows USA₮ and Celo — never USDC — on Mainnet", async () => {
    await mount();
    const text = bodyText();
    expect(text).toContain("USA₮");
    expect(text).toContain("Celo");
    expect(text).not.toContain("USDC");
    expect(text).not.toContain("Send payment");
  });

  it("primary action says Protect payment", async () => {
    await mount();
    await completeStep1();
    await completeStep2();
    expect(queryButtons("Protect payment").length).toBeGreaterThan(0);
    expect(bodyText()).not.toContain("Send payment");
  });
});

describe("/payments/new — step transitions + validation", () => {
  it("blocks step 1 with errors until worker + amount are valid", async () => {
    await mount();
    await click("Continue to terms");
    expect(bodyText()).toContain("freelancer");
    expect(bodyText()).not.toContain("Describe the work");

    setInput("freelancer-wallet", "0x123");
    setInput("amount", "0");
    await click("Continue to terms");
    expect(bodyText()).not.toContain("Describe the work");

    setInput("freelancer-wallet", WORKER);
    setInput("amount", "100");
    await click("Continue to terms");
    expect(bodyText()).toContain("Describe the work");
  });

  it("blocks step 2 until terms are complete", async () => {
    await mount();
    await completeStep1();
    await click("Continue to review");
    expect(bodyText()).not.toContain("What happens next?");

    setInput("agreement-title", "Landing page");
    setInput("deliverable-description", "Design files");
    setInput("delivery-date", "2020-01-01");
    await click("Continue to review");
    expect(bodyText()).toMatch(/future/);

    setInput("delivery-date", "2030-01-01");
    setSelect("how-should-the-money-be-released?", "buyer-approval");
    await click("Continue to review");
    expect(bodyText()).toContain("What happens next?");
  });
});

describe("/payments/new — preflight", () => {
  it("summarises the protection + the 6 next steps", async () => {
    await mount();
    await completeStep1();
    await completeStep2();
    const text = bodyText();
    expect(text).toContain("You are protecting");
    expect(text).toContain("100");
    expect(text).toContain("USA₮");
    expect(text).toContain(WORKER);
    expect(text).toContain("Terms summary");
    expect(text).toContain("What happens next?");
    expect(text).toContain("Funds are locked in the protection contract");
    expect(text).toContain("You release after you review");
    expect(text).toContain("dispute path stays available");
  });
});

describe("/payments/new — network guards", () => {
  it("wrong wallet network shows Switch to Celo and blocks Protect", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = CELO_CHAIN_ID;
    await mount();
    await completeStep1();
    await completeStep2();

    expect(bodyText()).toContain("Your wallet is on Celo Sepolia");
    const protect = findButton("Protect payment");
    expect(protect.disabled).toBe(true);

    await click("Switch to Celo");
    expect(walletMocks.requestNetworkSwitch).toHaveBeenCalledWith(MAINNET_ID);
    expect(flowMocks.flow.start).not.toHaveBeenCalled();
  });

  it("Protect on the right network starts with exact raw params", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = MAINNET_ID;
    await mount();
    await completeStep1();
    await completeStep2();
    await click("Protect payment");

    expect(flowMocks.flow.start).toHaveBeenCalledTimes(1);
    const input = (
      flowMocks.flow.start as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({
      worker: WORKER,
      amount: 100_000_000n,
      rawAmount: 100_000_000n,
      agreementLabel: "Landing page",
      releaseRule: "buyer-approval",
    });
  });

  it("insufficient USA₮ blocks with a pre-tx error", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = MAINNET_ID;
    flowMocks.flow.tokenBalance = 1n;
    await mount();
    setInput("freelancer-wallet", WORKER);
    setInput("amount", "100");
    await rerender();
    expect(bodyText()).toContain("balance is less than");
    await click("Continue to terms");

    await completeStep2();
    await click("Protect payment");
    expect(flowMocks.flow.start).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Add funds before protecting this payment");
  });

  it("zero CELO warns (determinable) without blocking", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = MAINNET_ID;
    balanceMocks.useBalance.mockReturnValue({ data: { value: 0n } });
    await mount();
    expect(bodyText()).toContain("no CELO");
    expect(findButton("Continue to terms").disabled).toBe(false);
  });
});

describe("/payments/new — Sepolia preserved", () => {
  it("explicit Sepolia selection shows USDC and re-targets the flow", async () => {
    await mount();
    await click("Celo Sepolia · Test");
    expect(flowMocks.flow.reset).toHaveBeenCalled();
    expect(bodyText()).toContain("USDC");
    const lastCall = flowMocks.useProtectPaymentFlow.mock.calls.at(-1) as
      | unknown[]
      | undefined;
    expect(lastCall?.[0]).toBe(CELO_CHAIN_ID);
  });
});

describe("/payments/new — progress, error, success", () => {
  it("shows honest progress while working", async () => {
    await mount();
    await completeStep1();
    await completeStep2();
    flowMocks.flow.phase = "approving";
    flowMocks.flow.isWorking = true;
    flowMocks.flow.progressLabel = "Approving USA₮…";
    await rerender();
    expect(bodyText()).toContain("Approving USA₮…");
  });

  it("shows step errors with retry (no false success)", async () => {
    await mount();
    await completeStep1();
    await completeStep2();
    flowMocks.flow.phase = "approving";
    flowMocks.flow.isWorking = false;
    flowMocks.flow.error = "Approval was rejected in your wallet.";
    await rerender();
    expect(bodyText()).toContain("Approval was rejected");
    expect(bodyText()).not.toContain("Payment protected");
    await click("Try again");
    expect(flowMocks.flow.retry).toHaveBeenCalledTimes(1);
  });

  it("success shows Payment protected + payment ID and redirects", async () => {
    await mount();
    await completeStep1();
    await completeStep2();
    flowMocks.flow.phase = "done";
    flowMocks.flow.createdPaymentId = 9n;
    await rerender();
    const text = bodyText();
    expect(text).toContain("Payment protected");
    expect(text).toContain("Payment ID 9");
    // P4.5F: creation success preserves explicit chain (Mainnet default).
    expect(routerMocks.push).toHaveBeenCalledWith("/payments/9?chainId=42220");
  });
});

describe("/payments/new — switch target passthrough", () => {
  it("passes the selected Sepolia chain when the wallet is on another network", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = MAINNET_ID;
    await mount();
    await click("Celo Sepolia · Test");
    await click("Switch to Celo Sepolia");
    expect(walletMocks.requestNetworkSwitch).toHaveBeenCalledWith(
      CELO_CHAIN_ID,
    );
  });

  it("step-3 switch button passes the selected Mainnet chain", async () => {
    walletMocks.wallet.isConnected = true;
    walletMocks.wallet.address = "0x1111111111111111111111111111111111111111";
    walletMocks.wallet.chainId = MAINNET_ID;
    await mount();
    await completeStep1();
    await completeStep2();
    // Simulate the wallet switching networks after render (the submitError
    // "Switch to" path guards this race): the rendered Protect button stays
    // enabled while the click-time guard sees the mismatch.
    walletMocks.wallet.chainId = CELO_CHAIN_ID;
    await click("Protect payment");
    expect(bodyText()).toContain("Switch to Celo to protect this payment.");
    const switches = queryButtons("Switch to Celo");
    expect(switches.length).toBeGreaterThan(0);
    for (const button of switches) {
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await act(async () => {});
    }
    expect(walletMocks.requestNetworkSwitch).toHaveBeenCalled();
    for (const call of walletMocks.requestNetworkSwitch.mock.calls) {
      expect(call[0]).toBe(MAINNET_ID);
    }
  });
});
