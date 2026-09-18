// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// FreelancerLanding — safe anonymous view (mocks only, no tx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PaymentData } from "@/lib/contracts/types";

vi.mock("@/components/ui/WalletButton", () => ({
  default: () => <button type="button">Connect wallet</button>,
}));

import FreelancerLanding, { WORKER_STEPS } from "../FreelancerLanding";

let root: Root | null = null;

async function mount(props: Parameters<typeof FreelancerLanding>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FreelancerLanding {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function makePayment(overrides: Partial<PaymentData> = {}): PaymentData {
  return {
    id: 9n,
    client: "0x1111111111111111111111111111111111111111",
    worker: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    amount: 100_000_000n,
    agreementLabel: "Landing page",
    deliverableSummary: "Design files",
    deliveryFormat: "Figma",
    releaseRule: "buyer-approval",
    evidenceExpectation: "Screenshots",
    termsHash: "0xabc",
    evidenceReference: "",
    disputeReference: "",
    deliveryDeadline: 0n,
    autoReleaseSeconds: 0n,
    disputeWindowSeconds: 0n,
    state: "Funded",
    createdAt: 1n,
    fundedAt: 2n,
    acceptedAt: 0n,
    deliveryAt: 0n,
    releaseRequestedAt: 0n,
    releasedAt: 0n,
    ...overrides,
  } as PaymentData;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("FreelancerLanding — public safe details", () => {
  it("shows Protected payment + amount/token + network + shortened parties + status", async () => {
    await mount({
      payment: makePayment({ state: "Funded" }),
      amountLabel: "100",
      tokenSymbol: "USAT",
      networkName: "Celo Mainnet",
    });
    const text = bodyText();
    expect(text).toContain("Protected payment");
    expect(text).toContain("100");
    expect(text).toContain("USAT");
    expect(text).toContain("Celo Mainnet");
    // Shortened addresses (never full raw exposure as primary display).
    expect(text).toContain("0x1111…1111");
    expect(text).toContain("0x2222…2222");
    expect(text).toContain("Protected");
  });

  it("shows human terms + exact protection sentence", async () => {
    await mount({
      payment: makePayment({
        state: "Funded",
        deliverableSummary: "Design files",
        releaseRule: "buyer-approval",
      }),
      amountLabel: "100",
      tokenSymbol: "USAT",
      networkName: "Celo Mainnet",
    });
    const text = bodyText();
    expect(text).toContain("Design files");
    expect(text).toContain("buyer-approval");
    expect(text).toContain(
      "Your payment is protected in the Reclaim contract.",
    );
  });

  it("renders a 5-step worker explainer + Connect wallet", async () => {
    await mount({
      payment: makePayment({ state: "Funded" }),
      amountLabel: "100",
      tokenSymbol: "USAT",
      networkName: "Celo Mainnet",
    });
    expect(WORKER_STEPS.length).toBe(5);
    const text = bodyText();
    for (const step of WORKER_STEPS) {
      expect(text).toContain(step);
    }
    expect(text).toContain("Connect wallet");
  });

  it("NEVER claims guaranteed funds", async () => {
    await mount({
      payment: makePayment({ state: "Funded" }),
      amountLabel: "100",
      tokenSymbol: "USAT",
      networkName: "Celo Mainnet",
    });
    expect(bodyText().toLowerCase()).not.toContain("guarantee");
    expect(bodyText()).not.toContain("you will be paid");
    expect(bodyText().toLowerCase()).not.toContain("risk-free");
  });

  it("Created does NOT read protected", async () => {
    await mount({
      payment: makePayment({ state: "Created" }),
      amountLabel: "100",
      tokenSymbol: "USAT",
      networkName: "Celo Mainnet",
    });
    const text = bodyText();
    expect(text).toContain("Payment agreement");
    expect(text).not.toContain("Protected payment");
    expect(text).not.toContain(
      "Your payment is protected in the Reclaim contract.",
    );
  });
});
