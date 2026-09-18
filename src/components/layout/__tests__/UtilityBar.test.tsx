// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// UtilityBar — P4.5D Mainnet-first production strip.
//
// - Presents "Celo" (Mainnet-first short label, matches product "On Celo"
//   copy), never "Celo Sepolia" as the production default.
// - Supporting copy is USA₮-accurate for the primary path via the canonical
//   CELO_MAINNET_ESCROW_TOKEN_CONFIG.name (not a hardcoded display string).
// - Static claims: no wallet dependency, so a connected wallet header state
//   cannot rewrite them.
// - Responsive classes preserved (jsdom class-level sanity only — no
//   browser available).
// - Sepolia/USDC support untouched: verified via canonical chain/token
//   config (explicit-Sepolia path) + existing product coverage.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import UtilityBar from "../UtilityBar";
import { CELO_MAINNET_ESCROW_TOKEN_CONFIG } from "@/lib/web3/tokens";
import { getChainName } from "@/lib/web3/chains";
import { getEscrowTokenConfig } from "@/lib/web3/tokens";

let root: Root | null = null;

async function mountBar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<UtilityBar />);
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

function barText(): string {
  return document.body.textContent ?? "";
}

describe("UtilityBar production presentation (P4.5D)", () => {
  it("presents Celo Mainnet-first, never Sepolia as the production default", async () => {
    await mountBar();
    const text = barText();
    expect(text).toContain("Celo");
    expect(text).not.toContain("Celo Sepolia");
    expect(text).not.toContain("Sepolia");
  });

  it("uses USA₮-accurate supporting copy for the primary path (no USDC)", async () => {
    await mountBar();
    const text = barText();
    expect(text).toContain(CELO_MAINNET_ESCROW_TOKEN_CONFIG.name);
    expect(CELO_MAINNET_ESCROW_TOKEN_CONFIG.name).toBe("USA₮");
    expect(text).toContain("terms, evidence and receipts");
    expect(text).not.toContain("USDC");
  });

  it("keeps static claims (no wallet dependency to rewrite)", async () => {
    await mountBar();
    const first = barText();
    // Remount from a clean DOM: claims must render identically with no
    // wallet state involved.
    document.body.innerHTML = "";
    // NOTE: root was attached to the cleared container; reset it so the
    // second mount starts clean (mirrors afterEach cleanup).
    root = null;
    await mountBar();
    const second = barText();
    expect(first).toBe(second);
    expect(first).not.toMatch(/0x[a-fA-F0-9]{6,}/);
  });

  it("preserves responsive classes (desktop + ~390px mobile sanity, jsdom only)", async () => {
    await mountBar();
    const inner = document.body.querySelector(".bg-utility > div");
    expect(inner).not.toBeNull();
    expect(inner!.className).toContain("flex");
    expect(inner!.className).toContain("max-w-[1440px]");
    expect(inner!.className).toContain("px-4");
    expect(inner!.className).toContain("md:px-6");
    // Supporting copy hides on small screens instead of breaking layout.
    const supporting = Array.from(document.body.querySelectorAll("span")).find(
      (s) => (s.textContent ?? "").includes("terms, evidence and receipts"),
    );
    expect(supporting).toBeDefined();
    expect(supporting!.className).toContain("hidden");
    expect(supporting!.className).toContain("sm:inline");
  });
});

describe("UtilityBar Sepolia support untouched", () => {
  it("explicit Sepolia still resolves Celo Sepolia + USDC via canonical config", () => {
    expect(getChainName(11142220)).toBe("Celo Sepolia");
    expect(getEscrowTokenConfig(11142220).symbol).toBe("USDC");
  });
});
