// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SharePaymentLink — canonical URL + copy behavior (mocks only, no tx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  buildPaymentSharePath,
  buildPaymentShareUrl,
} from "../SharePaymentLink";
import SharePaymentLink from "../SharePaymentLink";
import { CELO_CHAIN_ID, CELO_MAINNET_CHAIN_ID } from "@/lib/web3/chains";

describe("buildPaymentSharePath — canonical + chainId", () => {
  it("builds canonical mainnet URL with validated chainId", () => {
    expect(buildPaymentSharePath("9", CELO_MAINNET_CHAIN_ID)).toBe(
      `/payments/9?chainId=${CELO_MAINNET_CHAIN_ID}`,
    );
    expect(CELO_MAINNET_CHAIN_ID).toBe(42220);
  });

  it("builds canonical Sepolia URL (regression)", () => {
    expect(buildPaymentSharePath("42", CELO_CHAIN_ID)).toBe(
      `/payments/42?chainId=${CELO_CHAIN_ID}`,
    );
  });

  it("fails closed on malformed paymentId", () => {
    expect(buildPaymentSharePath("", 42220)).toBeNull();
    expect(buildPaymentSharePath("abc", 42220)).toBeNull();
    expect(buildPaymentSharePath("-1", 42220)).toBeNull();
    expect(buildPaymentSharePath("1.5", 42220)).toBeNull();
    expect(buildPaymentSharePath("0x123", 42220)).toBeNull();
    expect(buildPaymentSharePath("9;drop", 42220)).toBeNull();
  });

  it("fails closed on unsupported chainId", () => {
    expect(buildPaymentSharePath("9", 1)).toBeNull();
    expect(buildPaymentSharePath("9", 999999)).toBeNull();
    expect(buildPaymentSharePath("9", 0)).toBeNull();
    expect(buildPaymentSharePath("9", Number.NaN)).toBeNull();
  });
});

describe("buildPaymentShareUrl — origin + no secrets", () => {
  it("prefixes origin without hardcoding hostname", () => {
    const url = buildPaymentShareUrl("https://example.com", "9", 42220);
    expect(url).toBe("https://example.com/payments/9?chainId=42220");
  });

  it("strips trailing slash from origin", () => {
    expect(buildPaymentShareUrl("https://example.com/", "9", 42220)).toBe(
      "https://example.com/payments/9?chainId=42220",
    );
  });

  it("contains only paymentId + chainId (no secrets)", () => {
    const url = buildPaymentShareUrl("https://example.com", "9", 42220)!;
    expect(url).toContain("/payments/9");
    expect(url).toContain("chainId=42220");
    // No addresses, tokens, or secrets in the URL.
    expect(url).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(url.toLowerCase()).not.toContain("secret");
    expect(url.toLowerCase()).not.toContain("token=");
    expect(url.toLowerCase()).not.toContain("private");
    // Only allowed query key is chainId.
    const query = url.split("?")[1] ?? "";
    const keys = query.split("&").map((p) => p.split("=")[0]);
    expect(keys).toEqual(["chainId"]);
  });

  it("returns null for invalid input", () => {
    expect(buildPaymentShareUrl("https://example.com", "bad", 42220)).toBeNull();
    expect(buildPaymentShareUrl("https://example.com", "9", 1)).toBeNull();
    expect(buildPaymentShareUrl("", "9", 42220)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Component copy behavior (uses window.location.origin, no hardcoded host)
// ---------------------------------------------------------------------------

let root: Root | null = null;
let bump: (() => void) | null = null;

function Harness(props: { paymentId: string; chainId: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    bump = () => setTick((t) => t + 1);
  }, []);
  return <SharePaymentLink paymentId={props.paymentId} chainId={props.chainId} />;
}

async function mount(props: { paymentId: string; chainId: number }) {
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
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  bump = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("SharePaymentLink component", () => {
  it("renders Share with freelancer button with canonical path", async () => {
    await mount({ paymentId: "9", chainId: 42220 });
    expect(bodyText()).toContain("Share with freelancer");
    expect(bodyText()).toContain("/payments/9?chainId=42220");
  });

  it("copies absolute URL built from current origin", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await mount({ paymentId: "7", chainId: 42220 });
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Share with freelancer"),
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain(window.location.origin);
    expect(copied).toContain("/payments/7?chainId=42220");
    expect(bodyText()).toContain("Link copied");
  });

  it("fails closed (renders nothing) for unsupported chain", async () => {
    await mount({ paymentId: "9", chainId: 1 });
    expect(bodyText().trim()).toBe("");
  });

  it("does not hardcode a hostname in source", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "SharePaymentLink.tsx"),
      "utf-8",
    );
    expect(src).toContain("window.location.origin");
    expect(src).not.toContain("example.com");
    expect(src).not.toContain("vercel.app");
  });
});
