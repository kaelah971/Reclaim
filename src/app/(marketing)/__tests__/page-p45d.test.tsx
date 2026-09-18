// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Landing page — P4.5D Mainnet-first production presentation.
//
// - Homepage never presents "Celo Sepolia" as the production default.
// - Static production example uses USA₮ (canonical
//   CELO_MAINNET_ESCROW_TOKEN_CONFIG.name) with a "Celo" network label,
//   never USDC.
// - Primary-path hero/headline copy is free of USDC. (The x402 paid-action
//   section below the hero intentionally stays USDC: the x402 facilitator
//   settles in USDC on Sepolia, separate from the Mainnet USA₮ escrow —
//   see src/lib/web3/tokens.ts + p2dPaymentSafety "keeps x402 on USDC".)
// - /payments/new default chain is still 42220 via existing config import
//   (no product change).
// - Sepolia/USDC still renders when explicitly selected: the touched
//   marketing components are static (no Sepolia-selected branch), so this
//   asserts the canonical explicit-Sepolia chain/token path + points to
//   existing product coverage (explicitChain, useProtectPaymentFlow,
//   WalletGateProvider, receipt-p44b-chain).
// - No Payment #1 hardcoding in the static preview.
// - Keeps the single dominant "Protect a payment" CTA, the Example badge +
//   non-interactive preview, and the beginner 3-step mechanism copy.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LandingPage from "../page";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";
import {
  CELO_MAINNET_ESCROW_TOKEN_CONFIG,
  getEscrowTokenConfig,
} from "@/lib/web3/tokens";
import { getChainName } from "@/lib/web3/chains";

let root: Root | null = null;

async function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LandingPage />);
  });
  await act(async () => {});
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

function hero(): HTMLElement {
  const el = document.body.querySelector('[data-testid="hero"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function preview(): HTMLElement {
  const el = document.body.querySelector('[data-testid="hero-preview"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("landing page P4.5D production default", () => {
  it("never presents Celo Sepolia as the production default", async () => {
    await mountPage();
    expect(document.body.textContent ?? "").not.toContain("Celo Sepolia");
    expect(hero().textContent ?? "").not.toContain("Sepolia");
    expect(preview().textContent ?? "").not.toContain("Sepolia");
  });

  it("production example uses USA₮ (not USDC) with a Celo network label", async () => {
    await mountPage();
    expect(CELO_MAINNET_ESCROW_TOKEN_CONFIG.name).toBe("USA₮");
    const card = preview();
    const text = card.textContent ?? "";
    expect(text).toContain(`100.00 ${CELO_MAINNET_ESCROW_TOKEN_CONFIG.name}`);
    expect(text).toContain("Celo");
    expect(text).toContain("Network");
    expect(text).not.toContain("USDC");
    // Agreement proof-card above the preview agrees with the example.
    expect(hero().textContent ?? "").toContain(
      `100.00 ${CELO_MAINNET_ESCROW_TOKEN_CONFIG.name}`,
    );
  });

  it("keeps primary-path hero/headline copy free of USDC", async () => {
    await mountPage();
    const text = hero().textContent ?? "";
    expect(text).not.toContain("USDC");
    expect(hero().querySelector("h1")?.textContent).toContain(
      "Protected stablecoin payments for freelance work.",
    );
  });

  it("keeps no Payment #1 hardcoding in the static preview", async () => {
    await mountPage();
    const card = preview();
    expect(card.innerHTML).not.toContain("/payments/1");
    expect(card.textContent ?? "").not.toMatch(/payment\s*#\s*1/i);
    expect(card.textContent ?? "").not.toContain("#1");
  });
});

describe("landing page P4.5D product defaults untouched", () => {
  it("/payments/new default chain is still 42220 (existing config, no product change)", async () => {
    expect(DEFAULT_NEW_PAYMENT_CHAIN_ID).toBe(42220);
    expect(CELO_MAINNET_ESCROW_TOKEN_CONFIG.chainId).toBe(42220);
  });

  it("explicit Sepolia still resolves Celo Sepolia + USDC (chain-driven flows untouched)", async () => {
    expect(getChainName(11142220)).toBe("Celo Sepolia");
    expect(getEscrowTokenConfig(11142220).symbol).toBe("USDC");
  });
});

describe("landing page P4.5D preserves locked marketing hierarchy", () => {
  it("keeps the single dominant Protect CTA, Example badge, and 3-step copy", async () => {
    await mountPage();
    const buttons = Array.from(hero().querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes("Protect a payment"),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].className).toContain("bg-primary");
    expect(buttons[0].closest("a")?.getAttribute("href")).toBe("/payments/new");

    const previewText = preview().textContent ?? "";
    expect(previewText).toContain("Example");
    expect(previewText).toMatch(/preview/i);
    expect(preview().querySelector("button")).toBeNull();

    const heroText = hero().textContent ?? "";
    expect(heroText).toContain("Pay with proof.");
    expect(heroText).toContain("1. Protect the payment");
    expect(heroText).toContain("2. Freelancer delivers");
    expect(heroText).toContain("3. Release when the work is done");
  });
});
