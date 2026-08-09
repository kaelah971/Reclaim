// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AgentReadyState — Review case packet-state tests (RA1R.8C)
//
//   packet exists   => "Case prepared for human review" + prominent
//                      "Review case" button linking to the review surface
//   packet absent   => existing "assessing the case" state remains
//   navigation      => plain <a> link; no mutation/signing/API call
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/ui/Button", () => ({
  default: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

import AgentReadyState from "../AgentReadyState";

let root: Root | null = null;

async function mount(props: Parameters<typeof AgentReadyState>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AgentReadyState {...props} />);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

const BASE = {
  status: "active",
  toolExecutions: [],
  evidenceRequests: [],
};

describe("AgentReadyState — review packet state", () => {
  it("shows 'Review case' and links to /payments/1/review when a packet exists", async () => {
    await mount({ ...BASE, hasReviewPacket: true, reviewHref: "/payments/1/review" });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Case prepared for human review");
    expect(text).toContain("Review case");

    const link = document.body.querySelector("a[href='/payments/1/review']");
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Review case");
  });

  it("keeps the existing assessing state when no packet exists", async () => {
    await mount(BASE);

    const text = document.body.textContent ?? "";
    expect(text).toContain("The agent is still assessing the case.");
    expect(text).not.toContain("Review case");
    expect(document.body.querySelector("a")).toBeNull();
  });

  it("the Review case control performs plain navigation only (no mutation)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount({ ...BASE, hasReviewPacket: true, reviewHref: "/payments/1/review" });

    // The rendered control is an anchor — clicking it navigates; no network
    // call or wallet action is performed by the component.
    expect(fetchMock).not.toHaveBeenCalled();
    const link = document.body.querySelector("a") as HTMLAnchorElement;
    expect(link.href.endsWith("/payments/1/review")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("status ready_for_human_review still renders the prepared panel without a packet prop", async () => {
    await mount({ ...BASE, status: "ready_for_human_review" });
    expect(document.body.textContent ?? "").toContain("Case prepared for human review");
  });
});
