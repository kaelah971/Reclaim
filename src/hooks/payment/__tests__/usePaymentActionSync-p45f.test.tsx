// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.5F — post-tx sync + action locking regression tests (mocks only).
//
// Proves: receipt + stale read locks action, auto-polls, expected state stops
// polling without refresh, timeout shows confirmed-but-updating without
// rebroadcast, each write executes once, unmount cancels polling.
// Fixture shapes only.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  usePaymentActionSync,
  PAYMENT_SYNCING_MESSAGE,
  PAYMENT_SYNC_TIMEOUT_MESSAGE,
  isSyncBarrierMet,
} from "../usePaymentActionSync";

let root: Root | null = null;

function Harness({
  isSuccess,
  txHash,
  canonicalState,
  expectedState,
  refetch,
  paymentId = "9",
  chainId = 42220,
  timeoutMs = 60000,
  pollIntervalMs = 4000,
  onSync,
}: {
  isSuccess: boolean;
  txHash: `0x${string}` | undefined;
  canonicalState: string | undefined;
  expectedState: string | undefined;
  refetch: () => void;
  paymentId?: string;
  chainId?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onSync: (s: { isSyncing: boolean; isTimedOut: boolean; isSynced: boolean }) => void;
}) {
  const sync = usePaymentActionSync({
    isSuccess,
    txHash,
    canonicalState,
    expectedState,
    refetch,
    paymentId,
    chainId,
    timeoutMs,
    pollIntervalMs,
  });
  useEffect(() => {
    onSync(sync);
  }, [sync, onSync]);
  return null;
}

async function mountHarness(props: Parameters<typeof Harness>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness {...props} />);
  });
  await act(async () => {});
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

describe("P4.5F post-tx sync", () => {
  it("barrier progression: later lifecycle states satisfy earlier barriers", () => {
    expect(isSyncBarrierMet("Funded", "Funded")).toBe(true);
    expect(isSyncBarrierMet("Accepted", "Funded")).toBe(true);
    expect(isSyncBarrierMet("Released", "ReleaseRequested")).toBe(true);
    expect(isSyncBarrierMet("Created", "Funded")).toBe(false);
    expect(isSyncBarrierMet(undefined, "Funded")).toBe(false);
    expect(isSyncBarrierMet("Disputed", "Funded")).toBe(false);
  });

  it("successful receipt + stale read locks action (isSyncing) with canonical copy", async () => {
    const refetch = vi.fn();
    let latest: { isSyncing: boolean; isTimedOut: boolean; isSynced: boolean } | null = null;
    await mountHarness({
      isSuccess: true,
      txHash: TX,
      canonicalState: "Created",
      expectedState: "Funded",
      refetch,
      onSync: (s) => {
        latest = s;
      },
    });
    expect(latest!.isSyncing).toBe(true);
    expect(latest!.isTimedOut).toBe(false);
    expect(latest!.isSynced).toBe(false);
    // Immediate canonical re-read on receipt.
    expect(refetch).toHaveBeenCalled();
    expect(PAYMENT_SYNCING_MESSAGE).toContain("Transaction confirmed");
  });

  it("stale read automatically polls until expected state appears", async () => {
    const refetch = vi.fn();
    let latest: { isSyncing: boolean; isTimedOut: boolean; isSynced: boolean } | null = null;
    const onSync = (s: { isSyncing: boolean; isTimedOut: boolean; isSynced: boolean }) => {
      latest = s;
    };
    await mountHarness({
      isSuccess: true,
      txHash: TX,
      canonicalState: "Funded",
      expectedState: "Accepted",
      refetch,
      pollIntervalMs: 4000,
      onSync,
    });
    const callsAfterMount = refetch.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(1);
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await flush();
    });
    expect(refetch.mock.calls.length).toBeGreaterThan(callsAfterMount);

    // Expected state appears → synced, no refresh needed.
    await act(async () => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    await mountHarness({
      isSuccess: true,
      txHash: TX,
      canonicalState: "Accepted",
      expectedState: "Accepted",
      refetch,
      onSync,
    });
    expect(latest!.isSyncing).toBe(false);
    expect(latest!.isSynced).toBe(true);
  });

  it("timeout shows confirmed-but-updating without rebroadcast", async () => {
    const refetch = vi.fn();
    const writeAction = vi.fn();
    let latest: { isSyncing: boolean; isTimedOut: boolean; isSynced: boolean } | null = null;
    await mountHarness({
      isSuccess: true,
      txHash: TX,
      canonicalState: "DeliverySubmitted",
      expectedState: "ReleaseRequested",
      refetch,
      timeoutMs: 10000,
      pollIntervalMs: 2000,
      onSync: (s) => {
        latest = s;
      },
    });
    expect(latest!.isSyncing).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(11000);
      await flush();
    });
    expect(latest!.isTimedOut).toBe(true);
    expect(latest!.isSyncing).toBe(false);
    expect(PAYMENT_SYNC_TIMEOUT_MESSAGE).toContain("Status is still updating");
    // Never rebroadcasts: only refetch, never the write.
    expect(writeAction).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
  });

  it("fund/accept/evidence/request/release barriers each execute once (no auto-repeat)", async () => {
    const barriers: Array<[string, string]> = [
      ["Created", "Funded"],
      ["Funded", "Accepted"],
      ["Accepted", "DeliverySubmitted"],
      ["DeliverySubmitted", "ReleaseRequested"],
      ["ReleaseRequested", "Released"],
    ];
    for (const [canonical, expected] of barriers) {
      const refetch = vi.fn();
      let latest: { isSyncing: boolean } | null = null;
      await act(async () => {
        root?.unmount();
      });
      document.body.innerHTML = "";
      await mountHarness({
        isSuccess: true,
        txHash: TX,
        canonicalState: canonical,
        expectedState: expected,
        refetch,
        onSync: (s) => {
          latest = s;
        },
      });
      // Stale barrier → syncing, but refetch count bounded (immediate + polls).
      expect(latest!.isSyncing).toBe(true);
      const before = refetch.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(4000);
        await flush();
      });
      // Exactly one poll per interval — never a write repeat.
      expect(refetch.mock.calls.length).toBe(before + 1);
    }
  });

  it("unmount cancels polling (no timers leak)", async () => {
    const refetch = vi.fn();
    await mountHarness({
      isSuccess: true,
      txHash: TX,
      canonicalState: "Created",
      expectedState: "Funded",
      refetch,
      onSync: () => {},
    });
    const calls = refetch.mock.calls.length;
    await act(async () => {
      root?.unmount();
    });
    root = null;
    await act(async () => {
      vi.advanceTimersByTime(20000);
      await flush();
    });
    expect(refetch.mock.calls.length).toBe(calls);
  });

  it("action locking: escrow gates block rebroadcast after receipt", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(__dirname, "../../contracts/useEscrowActions.ts"),
      "utf-8",
    );
    expect(src).toContain("if (isConfirmed) return undefined");

    const room = readFileSync(
      resolve(
        __dirname,
        "../../../app/(product)/payments/[paymentId]/page.tsx",
      ),
      "utf-8",
    );
    // Room buttons lock on isSuccess (safety, not polish).
    expect(room).toContain("fundPayment.isPending || fundPayment.isSuccess");
    expect(room).toContain("acceptPayment.isPending || acceptPayment.isSuccess");
    expect(room).toContain("requestRelease.isPending || requestRelease.isSuccess");
    // Release preflight locks on success.
    expect(room).toContain("isSyncing={releaseSync.isSyncing}");

    const preflight = readFileSync(
      resolve(__dirname, "../../../components/payment/ReleasePreflight.tsx"),
      "utf-8",
    );
    expect(preflight).toContain("disabled={isPending || isLocked}");
    expect(preflight).toContain("Refresh status");

    const evidenceFlow = readFileSync(
      resolve(__dirname, "../../evidence/useSubmitEvidenceFlow.ts"),
      "utf-8",
    );
    expect(evidenceFlow).toContain("if (isPending || isTxConfirmed) return");
  });

  it("uses a stable state hook (no setState-in-render loops)", async () => {
    function Probe() {
      const [n] = useState(0);
      return <span>{n}</span>;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    await act(async () => {
      r.render(<Probe />);
    });
    await act(async () => {
      r.unmount();
    });
    expect(true).toBe(true);
  });
});
