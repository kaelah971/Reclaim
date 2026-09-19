// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.2 — DeliveryReviewCard UX tests (mocks only).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import DeliveryReviewCard from "../DeliveryReviewCard";
import type { DeliveryEvaluation } from "@/lib/review/deliveryEvaluation";

const EVALUATION: DeliveryEvaluation = {
  paymentId: "9",
  chainId: 42220,
  recommendation: "ready_for_review",
  summary: "The worker submitted evidence matching 2 of 3 agreed requirements.",
  requirements: [
    { requirement: "SVG + PNG requested", status: "satisfied", evidence: "file hash present" },
    { requirement: "Delivery evidence submitted", status: "satisfied", evidence: "delivery text present" },
    { requirement: "Logo source files", status: "unclear", evidence: "not clearly evidenced" },
  ],
  deadlineStatus: "on_time",
  concerns: ["PNG export not clearly evidenced."],
  confidence: "medium",
  evaluatedAt: new Date().toISOString(),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof DeliveryReviewCard>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DeliveryReviewCard {...props} />);
  });
  await act(async () => {});
}

function text(): string {
  return container?.textContent ?? "";
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("P6.2 client review card", () => {
  it("shows recommendation + checks + summary + actions", async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof window.HTMLElement.prototype.scrollIntoView;
    await mount({
      status: "ready",
      evaluation: { ...EVALUATION, recommendation: "ready_for_review", requirements: EVALUATION.requirements.map((r) => ({ ...r, status: "satisfied" as const })) },
      role: "client",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    const t = text();
    expect(t).toContain("Reclaim reviewed this delivery");
    expect(t).toContain("Ready for review");
    expect(t).toContain("What Reclaim checked");
    expect(t).toContain("SVG + PNG requested");
    expect(t).toContain("Submitted before deadline");
    expect(t).toContain("View delivery evidence");
    expect(t).toContain("Release payment");
  });

  it("needs_attention emphasizes human inspection", async () => {
    await mount({
      status: "ready",
      evaluation: { ...EVALUATION, recommendation: "needs_attention" },
      role: "client",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    const t = text();
    expect(t).toContain("Needs attention");
    expect(t).toContain("inspect the delivery evidence");
    expect(t).toContain("PNG export not clearly evidenced");
  });

  it("low confidence emphasizes inspection even when satisfied", async () => {
    await mount({
      status: "ready",
      evaluation: {
        ...EVALUATION,
        recommendation: "ready_for_review",
        requirements: EVALUATION.requirements.map((r) => ({ ...r, status: "satisfied" as const })),
        confidence: "low",
      },
      role: "client",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    expect(text()).toContain("inspect the delivery evidence");
  });

  it("actions scroll — never broadcast, never approveRelease", async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof window.HTMLElement.prototype.scrollIntoView;
    const evidence = document.createElement("div");
    evidence.id = "delivery-evidence";
    document.body.appendChild(evidence);
    const release = document.createElement("div");
    release.id = "release-payment";
    document.body.appendChild(release);
    await mount({
      status: "ready",
      evaluation: { ...EVALUATION, recommendation: "ready_for_review", requirements: [] },
      role: "client",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const view = buttons.find((b) => b.textContent?.includes("View delivery evidence"));
    await act(async () => {
      view!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(scrollSpy).toHaveBeenCalled();
    const src = readFileSync(resolve(__dirname, "../DeliveryReviewCard.tsx"), "utf-8");
    expect(src).not.toContain("approveRelease");
    expect(src).not.toContain("writeContract");
    expect(src).not.toContain("onRelease");
  });

  it("honest loading / unavailable / error states (never fabricated)", async () => {
    await mount({
      status: "loading",
      evaluation: null,
      role: "client",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    expect(text()).toContain("checking your delivery");

    await act(async () => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    await mount({
      status: "unavailable",
      evaluation: null,
      role: "client",
      error: null,
      unavailableMessage: "Custom unavailable.",
      onRetry: () => {},
    });
    expect(text()).toContain("Custom unavailable.");
  });
});

describe("P6.2 worker limited view", () => {
  it("shows safe status without internals", async () => {
    await mount({
      status: "ready",
      evaluation: { ...EVALUATION, recommendation: "needs_attention" },
      role: "worker",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    const t = text();
    expect(t).toContain("Reclaim found something that may need clarification.");
    expect(t).not.toContain("What Reclaim checked");
    expect(t).not.toContain("Things to check");
    expect(t).not.toContain("confidence");
    expect(t).not.toContain("View delivery evidence");
    expect(t).not.toContain("Release payment");
  });

  it("ready worker delivery shows the ready headline", async () => {
    await mount({
      status: "ready",
      evaluation: { ...EVALUATION, recommendation: "ready_for_review" },
      role: "worker",
      error: null,
      unavailableMessage: null,
      onRetry: () => {},
    });
    expect(text()).toContain("Delivery ready for client review");
  });
});
