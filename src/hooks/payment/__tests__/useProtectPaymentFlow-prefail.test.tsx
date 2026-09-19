// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.4C — preflight failure never latches "creating" (mocks only, no real tx).
//
// Uses the REAL hooks (useCreatePayment / useProtectPaymentFlow) with a
// mocked wagmi layer (same harness pattern as useProtectPaymentFlow.test.tsx),
// proving:
//   - createPayment returns false + sets a friendly error on an oversize
//     evidence expectation, broadcasting nothing (no simulate, no write)
//   - createPayment returns true once validation passes and simulation starts
//   - flow.start with oversize evidence stays "idle" (progressLabel null —
//     no stuck "Creating your agreement…" spinner) and broadcasts nothing
//   - start-after-fix proceeds fresh (Protect stays retryable, zero tx before)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toDataSuffix } from "@celo/attribution-tags";

const wagmiMocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
  usePublicClient: vi.fn(),
  useReadContract: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}));

const walletMocks = vi.hoisted(() => ({
  useWalletState: vi.fn(),
}));

const attributionMock = vi.hoisted(() => ({
  getAttributionDataSuffix: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: wagmiMocks.useAccount,
  usePublicClient: wagmiMocks.usePublicClient,
  useReadContract: wagmiMocks.useReadContract,
  useWriteContract: wagmiMocks.useWriteContract,
  useWaitForTransactionReceipt: wagmiMocks.useWaitForTransactionReceipt,
}));

vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: walletMocks.useWalletState,
}));

vi.mock("@/lib/contracts/attribution", () => attributionMock);

import { useCreatePayment } from "../../contracts/useCreatePayment";
import {
  useProtectPaymentFlow,
  type UseProtectPaymentFlowReturn,
} from "../useProtectPaymentFlow";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";

const MAINNET_ID = DEFAULT_NEW_PAYMENT_CHAIN_ID;
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const WORKER = "0x2222222222222222222222222222222222222222" as const;
// 43 UTF-8 bytes — the exact generic guidance that used to wedge the flow.
const OVERSIZED_EVIDENCE = "Delivery note / files / links as applicable";
const RAW_AMOUNT = 1_000_000n;

let simulateContract: ReturnType<typeof vi.fn>;
let writeContract: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let root: Root | null = null;
let latestCreate: ReturnType<typeof useCreatePayment> | null = null;
let latestFlow: UseProtectPaymentFlowReturn | null = null;

function CreateHarness() {
  const api = useCreatePayment(MAINNET_ID);
  useEffect(() => {
    latestCreate = api;
  }, [api]);
  return null;
}

function FlowHarness() {
  const api = useProtectPaymentFlow(MAINNET_ID);
  useEffect(() => {
    latestFlow = api;
  }, [api]);
  return null;
}

async function mount(el: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
  await act(async () => {});
}

async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function buildCreateParams(overrides: Record<string, unknown> = {}) {
  return {
    worker: WORKER,
    amount: RAW_AMOUNT,
    agreementLabel: "Test",
    deliverableSummary: "Summary",
    deliveryFormat: "URL",
    deliveryDeadline: Math.floor(Date.now() / 1000) + 86400,
    releaseRule: "buyer-approval",
    autoReleaseSeconds: 0,
    disputeWindowSeconds: 86400,
    evidenceExpectation: "Link",
    ...overrides,
  };
}

function buildFlowInput(overrides: Record<string, unknown> = {}) {
  return {
    ...buildCreateParams(overrides),
    rawAmount: RAW_AMOUNT,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  latestCreate = null;
  latestFlow = null;
  attributionMock.getAttributionDataSuffix.mockReturnValue(ATTRIBUTION_SUFFIX);

  walletMocks.useWalletState.mockReturnValue({
    address: ACCOUNT,
    chainId: MAINNET_ID,
    isConnected: true,
    isConnecting: false,
    isReconnecting: false,
  });
  const connector = {
    getChainId: vi.fn(() => Promise.resolve(MAINNET_ID)),
  };
  wagmiMocks.useAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: MAINNET_ID,
    connector,
    isReconnecting: false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: "connected",
  });

  simulateContract = vi.fn(() => Promise.resolve({ request: {} }));
  wagmiMocks.usePublicClient.mockReturnValue({ simulateContract });
  wagmiMocks.useReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  });
  writeContract = vi.fn();
  wagmiMocks.useWriteContract.mockReturnValue({
    writeContract,
    data: undefined,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    data: undefined,
    isLoading: false,
    isSuccess: false,
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P6.4C createPayment preflight boolean", () => {
  it("returns false + friendly error on oversize evidence, broadcasting nothing", async () => {
    await mount(<CreateHarness />);
    expect(latestCreate).not.toBeNull();

    let ok: boolean | undefined;
    await act(async () => {
      ok = latestCreate!.createPayment(
        buildCreateParams({ evidenceExpectation: OVERSIZED_EVIDENCE }),
      );
      await flush();
    });

    expect(ok).toBe(false);
    expect(latestCreate!.error).toMatch(/too long to store on-chain/i);
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("returns true once validation passes and simulation is kicked off", async () => {
    await mount(<CreateHarness />);
    expect(latestCreate).not.toBeNull();

    let ok: boolean | undefined;
    await act(async () => {
      ok = latestCreate!.createPayment(buildCreateParams());
      await flush();
    });

    expect(ok).toBe(true);
    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(latestCreate!.error).toBeNull();
  });
});

describe("P6.4C flow preflight never latches creating", () => {
  it("oversize start stays idle with no spinner and no broadcast, then proceeds after fix", async () => {
    await mount(<FlowHarness />);
    expect(latestFlow).not.toBeNull();
    expect(latestFlow!.phase).toBe("idle");

    await act(async () => {
      latestFlow!.start(buildFlowInput({ evidenceExpectation: OVERSIZED_EVIDENCE }));
      await flush();
    });

    // Preflight failure: started stays false → idle, no progress label
    // (spinner/info Notice gone), zero broadcasts.
    expect(latestFlow!.phase).toBe("idle");
    expect(latestFlow!.progressLabel).toBeNull();
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();

    // Fix the note and Protect again — proceeds fresh, no stuck latch.
    await act(async () => {
      latestFlow!.start(buildFlowInput({ evidenceExpectation: "Figma link" }));
      await flush();
    });

    expect(latestFlow!.phase).toBe("creating");
    expect(latestFlow!.progressLabel).toBe("Creating your agreement…");
    expect(simulateContract).toHaveBeenCalledTimes(1);
  });
});
