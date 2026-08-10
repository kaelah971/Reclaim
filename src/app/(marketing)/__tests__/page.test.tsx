// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Landing page (marketing) — hero demo entry point tests
//
// The hero CTA row must offer exactly one entry point to the completed live
// demo case (/payments/1) plus a muted caption clarifying it is a finished
// on-chain proof, not an interactive fresh case.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
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

describe("landing page hero demo entry point", () => {
  it("renders the demo link to the completed live case at /payments/1", async () => {
    await mountPage();

    const link = document.body.querySelector('a[href="/payments/1"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Explore the live demo case");
  });

  it("renders the completed-proof caption under the hero CTAs", async () => {
    await mountPage();

    const text = document.body.textContent ?? "";
    expect(text).toContain("The live demo is a completed on-chain proof");
    expect(text).toContain("released on Celo Sepolia");
    expect(text).toContain("end-to-end");
  });
});

describe("landing page supporting content", () => {
  it("keeps the detailed documentation sections off the landing page", async () => {
    await mountPage();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("How it works");
    expect(text).not.toContain("One shared Payment Room");
    expect(text).not.toContain(
      "AI prepares the case. People decide. The contract settles.",
    );
  });
});
