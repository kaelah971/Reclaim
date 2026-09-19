// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.1 — PolicyConfirmationCard + CommandBox tests (mocks only).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import PolicyConfirmationCard from "../PolicyConfirmationCard";
import CommandBox from "../CommandBox";
import type { PaymentPolicy } from "@/lib/command/paymentIntent";

const POLICY: PaymentPolicy = {
  worker: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  amountHuman: "50",
  amountRaw: "50000000",
  asset: "USA₮",
  chainId: 42220,
  title: "Logo design",
  deliverableSummary: "Logo design",
  deliveryFormat: "",
  deadlineDate: "2026-09-25",
  deadlineUnix: 1789852800,
  evidenceExpectation: "SVG + PNG",
  releaseMode: "manual",
  releaseRule: "manual",
  deliverables: ["SVG + PNG"],
  evidenceRequirements: ["SVG + PNG"],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mountCard(props: Parameters<typeof PolicyConfirmationCard>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PolicyConfirmationCard {...props} />);
  });
  await act(async () => {});
}

async function mountBox(props: Parameters<typeof CommandBox>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CommandBox {...props} />);
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

describe("P6.1 confirmation card", () => {
  it("renders correct values (payment/purpose/deadline/release/evidence/network)", async () => {
    await mountCard({
      policy: POLICY,
      deadlineLabel: "Friday",
      onProtect: () => {},
      onEdit: () => {},
    });
    const t = text();
    expect(t).toContain("50 USA₮");
    expect(t).toContain("0x85522bdE267d05bf8CE8813F97c75417b7894A33");
    expect(t).toContain("Logo design");
    expect(t).toContain("SVG + PNG");
    expect(t).toContain("Friday");
    expect(t).toContain("Client approval required");
    expect(t).toContain("Celo");
  });

  it("Protect requires explicit click (never auto-executes)", async () => {
    const onProtect = vi.fn();
    await mountCard({
      policy: POLICY,
      onProtect,
      onEdit: () => {},
    });
    // Render alone never protects.
    expect(onProtect).not.toHaveBeenCalled();
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const protect = buttons.find((b) => b.textContent?.includes("Protect 50 USA₮"));
    expect(protect).toBeTruthy();
    await act(async () => {
      protect!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onProtect).toHaveBeenCalledTimes(1);
  });

  it("Edit details preserves the extracted draft", async () => {
    const onEdit = vi.fn();
    await mountCard({ policy: POLICY, onProtect: () => {}, onEdit });
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const edit = buttons.find((b) => b.textContent?.includes("Edit details"));
    expect(edit).toBeTruthy();
    await act(async () => {
      edit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
    // Card still shows the draft values (nothing lost).
    expect(text()).toContain("50 USA₮");
  });
});

describe("P6.1 command box", () => {
  it("asks the primary question with scoped examples", async () => {
    await mountBox({
      onSubmit: () => {},
      isWorking: false,
      error: null,
      boundaryMessage: null,
    });
    const t = text();
    expect(t).toContain("What do you want Reclaim to handle?");
    expect(t).toContain("Protect 50 USA₮ for a logo design.");
  });

  it("shows the domain boundary for out-of-domain prompts", async () => {
    await mountBox({
      onSubmit: () => {},
      isWorking: false,
      error: null,
      boundaryMessage:
        "Reclaim handles protected work payments and their release conditions.",
    });
    expect(text()).toContain("protected work payments");
  });
});
