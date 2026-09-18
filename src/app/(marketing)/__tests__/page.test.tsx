// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Landing page (marketing) — P4.2a single dominant primary CTA (AskBots R1)
//
// Hero hierarchy:
//   1. Exactly ONE visually dominant primary CTA ("Protect a payment" ->
//      /payments/new) rendered with the primary Button style.
//   2. "See how it works" and "Explore the live demo case" are visually
//      subordinate text links — no primary/secondary button styling.
//   3. Beginner hero language: "Protected stablecoin payments for freelance
//      work." + "Pay with proof." + a plain 3-step mechanism, with no
//      protocol jargon (on-chain / Celo Sepolia / x402 / escrow) in the hero.
//   4. The payment preview is a labelled static example ("Example" badge +
//      "Preview" caption): zero interactive elements and zero CTAs to
//      /payments/new — i.e. no duplicated primary CTA.
//   5. The closing section repeats the action only as a quiet text link, so
//      the hero keeps the single dominant primary CTA page-wide.
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

function protectPaymentButtons(scope: ParentNode = document.body): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button")).filter((b) =>
    (b.textContent ?? "").includes("Protect a payment"),
  ) as HTMLButtonElement[];
}

describe("landing page hero messaging", () => {
  it("leads with protected stablecoin payments for freelance work", async () => {
    await mountPage();

    const h1 = hero().querySelector("h1");
    expect(h1?.textContent).toContain(
      "Protected stablecoin payments for freelance work.",
    );
  });

  it("supports with 'Pay with proof.' and the plain 3-step mechanism", async () => {
    await mountPage();

    const text = hero().textContent ?? "";
    expect(text).toContain("Pay with proof.");
    expect(text).toContain("1. Protect the payment");
    expect(text).toContain("2. Freelancer delivers");
    expect(text).toContain("3. Release when the work is done");
  });

  it("keeps protocol jargon out of the hero", async () => {
    await mountPage();

    const text = hero().textContent ?? "";
    for (const jargon of ["on-chain", "Celo Sepolia", "x402", "escrow"]) {
      expect(text).not.toContain(jargon);
    }
  });
});

describe("landing page hero CTA hierarchy", () => {
  it("renders exactly one dominant 'Protect a payment' primary CTA routing to /payments/new", async () => {
    await mountPage();

    const buttons = protectPaymentButtons(hero());
    expect(buttons).toHaveLength(1);
    const cta = buttons[0];
    // Primary Button style (espresso): Button variant="primary" => bg-primary.
    expect(cta.className).toContain("bg-primary");
    const link = cta.closest("a");
    expect(link?.getAttribute("href")).toBe("/payments/new");
  });

  it("demotes secondary links to subordinate text links without button styling", async () => {
    await mountPage();

    const section = hero();
    for (const href of ["/how-it-works", "/payments/1"]) {
      const link = section.querySelector(`a[href="${href}"]`);
      expect(link).not.toBeNull();
      // A text link, not a button in disguise.
      expect(link!.querySelector("button")).toBeNull();
      const cls = link!.className ?? "";
      expect(cls).not.toMatch(/bg-primary|bg-surface|bg-page|shadow-|h-1[12]/);
      expect(cls).not.toContain("rounded-[--radius-button]");
    }
    expect(section.textContent).toContain("See how it works");
    expect(section.textContent).toContain("Explore the live demo case");
  });

  it("keeps the single dominant primary CTA page-wide (closing repeat is a quiet text link)", async () => {
    await mountPage();

    // Exactly one button-styled "Protect a payment" on the whole page.
    expect(protectPaymentButtons()).toHaveLength(1);

    const finalCta = document.body.querySelector('[data-testid="final-cta"]');
    expect(finalCta).not.toBeNull();
    const repeat = finalCta!.querySelector('a[href="/payments/new"]');
    expect(repeat).not.toBeNull();
    expect(repeat!.textContent).toContain("Protect a payment");
    expect(repeat!.querySelector("button")).toBeNull();
    expect(repeat!.className).not.toContain("bg-primary");
  });
});

describe("landing page static preview card", () => {
  it("is labelled as an example/preview", async () => {
    await mountPage();

    const text = preview().textContent ?? "";
    expect(text).toContain("Example");
    expect(text).toMatch(/preview/i);
  });

  it("is non-interactive: no form controls, buttons, or labels", async () => {
    await mountPage();

    const card = preview();
    expect(card.querySelector("button")).toBeNull();
    expect(card.querySelector("input")).toBeNull();
    expect(card.querySelector("select")).toBeNull();
    expect(card.querySelector("textarea")).toBeNull();
    expect(card.querySelector("label")).toBeNull();
  });

  it("contains no duplicated primary CTA", async () => {
    await mountPage();

    const card = preview();
    expect(card.querySelector('a[href="/payments/new"]')).toBeNull();
    expect(card.innerHTML).not.toContain("bg-primary");
  });
});

describe("landing page supporting content", () => {
  it("keeps the detailed documentation sections off the landing page", async () => {
    await mountPage();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("One shared Payment Room");
    expect(text).not.toContain(
      "AI prepares the case. People decide. The contract settles.",
    );
  });
});
