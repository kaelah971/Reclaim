// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.2 — useDeliveryEvaluation hook: manual never fetches, assisted does.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useDeliveryEvaluation,
  type DeliveryEvaluationStatus,
} from "../useDeliveryEvaluation";
import type { DeliveryEvaluation } from "@/lib/review/deliveryEvaluation";

const EVALUATION: DeliveryEvaluation = {
  paymentId: "9",
  chainId: 42220,
  recommendation: "ready_for_review",
  summary: "All good.",
  requirements: [
    { requirement: "Logo", status: "satisfied", evidence: "delivery text present" },
  ],
  deadlineStatus: "on_time",
  concerns: [],
  confidence: "high",
  evaluatedAt: new Date().toISOString(),
};

let root: Root | null = null;
let latest: {
  status: DeliveryEvaluationStatus;
  evaluation: DeliveryEvaluation | null;
} | null = null;
let bump: (() => void) | null = null;

function Harness(props: {
  enabled: boolean;
  signMessage: (m: string) => Promise<string>;
}) {
  const api = useDeliveryEvaluation({
    paymentId: "9",
    chainId: 42220,
    walletAddress: "0x1111111111111111111111111111111111111111",
    isConnected: true,
    enabled: props.enabled,
    signMessage: props.signMessage,
  });
  const [, setTick] = useState(0);
  useEffect(() => {
    latest = api;
    bump = () => setTick((t) => t + 1);
  }, [api]);
  return null;
}

async function mountHarness(props: {
  enabled: boolean;
  signMessage: (m: string) => Promise<string>;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness {...props} />);
  });
  await act(async () => {});
}

beforeEach(() => {
  latest = null;
  bump = null;
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("P6.2 delivery evaluation hook", () => {
  it("manual mode (disabled) never fetches — stays idle", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness({ enabled: false, signMessage: async () => "0xsig" });
    expect(latest!.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("agent_assisted mode fetches via challenge + signature + evaluation", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/evidence/challenge")) {
        return {
          ok: true,
          json: () => Promise.resolve({ challengeId: "0xabc", message: "sign me" }),
        };
      }
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            available: true,
            role: "client",
            releaseMode: "agent_assisted",
            evaluation: EVALUATION,
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "0xsig");
    await mountHarness({ enabled: true, signMessage });
    expect(signMessage).toHaveBeenCalledWith("sign me");
    expect(latest!.status).toBe("ready");
    expect(latest!.evaluation?.recommendation).toBe("ready_for_review");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("existing release still requires explicit wallet action (hook never signs alone)", async () => {
    // The hook only signs a read-only challenge message; it exposes no
    // release/approve action. Source-assert the boundary.
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve(__dirname, "../useDeliveryEvaluation.ts"), "utf-8");
    expect(src).not.toContain("approveRelease");
    expect(src).not.toContain("writeContract");
    expect(src).not.toContain("simulateContract");
  });
});
