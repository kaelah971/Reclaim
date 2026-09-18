// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// MarketingHeader — single primary CTA hierarchy (P4.2a AskBots R1)
//
// The header keeps exactly ONE visually dominant primary CTA ("Protect a
// payment" -> /payments/new, gold on the espresso header) while preserving
// every marketing nav link. The wallet control stays visually subordinate
// (no primary styling) so it never competes with the primary action.
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

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/ui/WalletButton", () => ({
  default: () => <button type="button">Connect wallet</button>,
}));

import MarketingHeader from "../MarketingHeader";
import { navigation, primaryCta } from "@/lib/tokens";

let root: Root | null = null;

async function mountHeader() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MarketingHeader />);
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

function header(): HTMLElement {
  const el = document.body.querySelector("header");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("MarketingHeader CTA hierarchy", () => {
  it("renders a single dominant primary CTA to /payments/new", async () => {
    await mountHeader();

    const ctas = Array.from(
      header().querySelectorAll('a[href="/payments/new"]'),
    );
    expect(ctas).toHaveLength(1);
    expect(ctas[0].textContent).toContain(primaryCta);
    // Dominant gold styling on the espresso header — the one primary action.
    expect(ctas[0].className).toContain("bg-gold");
  });

  it("keeps the wallet control visually subordinate to the primary CTA", async () => {
    await mountHeader();

    const wallet = Array.from(header().querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Connect wallet"),
    );
    expect(wallet).toBeDefined();
    expect(wallet!.className).not.toContain("bg-gold");
    expect(wallet!.className).not.toContain("bg-primary");
  });

  it("preserves every marketing nav link", async () => {
    await mountHeader();

    for (const item of navigation.marketing) {
      const link = header().querySelector(`nav a[href="${item.href}"]`);
      expect(link).not.toBeNull();
      expect(link!.textContent).toContain(item.label);
    }
  });
});
