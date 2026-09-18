// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useProtectPaymentFlow — allowance-visibility barrier tests (mocks only).
//
// Uses the REAL low-level hooks with a mocked wagmi layer (slot-multiplexed
// writes/receipts, same as useProtectPaymentFlow.test.tsx) but routes
// useReadContract by functionName so `allowance` returns a scripted sequence
// (stale RPC → fresh) while `balanceOf` stays fixed. Proves the bounded
// approve→fund barrier: fund never simulates against stale 0 allowance.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toDataSuffix } from "@celo/attribution-tags";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";

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

import {
  useProtectPaymentFlow,
  type UseProtectPaymentFlowReturn,
} from "../useProtectPaymentFlow";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";
import { getEscrowContractAddress } from "@/lib/contracts/config";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

const MAINNET_ID = DEFAULT_NEW_PAYMENT_CHAIN_ID;
const MAINNET_ESCROW = getEscrowContractAddress(MAINNET_ID);
const MAINNET_TOKEN = getPaymentTokenConfig(MAINNET_ID).address;

const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const WORKER = "0x2222222222222222222222222222222222222222" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const CREATE_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const APPROVE_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const FUND_HASH = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
// Raw amount matches the scripted sufficient allowance (10000n) so the
// observed-allowance gate (allowance >= requiredAmount) is meaningful.
const RAW_AMOUNT = 10_000n;
const SUFFICIENT = 10_000n;
const STALE = 0n;
const BALANCE = 100_000n;
const CREATED_ID = 7n;

const SYNC_TIMEOUT_MESSAGE =
  "Your approval is confirmed on-chain, but the network has not caught up yet. Wait a moment and retry — your approval will not be sent again.";

// ---------------------------------------------------------------------------
// Slot-multiplexed wagmi mocks + scripted allowance.
// ---------------------------------------------------------------------------

interface WriteSlot {
  writeContract: ReturnType<typeof vi.fn>;
  data: `0x${string}` | undefined;
}
interface ReceiptSlot {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
}

let writeSlots: WriteSlot[];
let receiptSlots: ReceiptSlot[];
let writeCallIndex = 0;
let receiptCallIndex = 0;
let simulateContract: ReturnType<typeof vi.fn>;

let allowanceScript: bigint[] = [];
let allowanceIndex = 0;
let currentAllowance: bigint | undefined = undefined;
let refetchAllowanceMock: ReturnType<typeof vi.fn>;

function setAllowanceScript(script: bigint[]) {
  allowanceScript = [...script];
  allowanceIndex = 0;
  currentAllowance = script[0];
}

function setupWagmiLayer() {
  writeSlots = [0, 1, 2].map(() => ({
    writeContract: vi.fn(
      (
        _params: unknown,
        callbacks?: { onSettled?: (...args: unknown[]) => void },
      ) => {
        callbacks?.onSettled?.(undefined, undefined);
      },
    ),
    data: undefined,
  }));
  receiptSlots = [0, 1, 2].map(() => ({
    data: undefined,
    isLoading: false,
    isSuccess: false,
  }));
  writeCallIndex = 0;
  receiptCallIndex = 0;

  allowanceScript = [];
  allowanceIndex = 0;
  currentAllowance = undefined;

  refetchAllowanceMock = vi.fn(() => {
    if (allowanceScript.length === 0) {
      return Promise.resolve({ data: currentAllowance });
    }
    if (allowanceIndex + 1 < allowanceScript.length) {
      allowanceIndex += 1;
      currentAllowance = allowanceScript[allowanceIndex];
    } else {
      currentAllowance = allowanceScript[allowanceScript.length - 1];
    }
    return Promise.resolve({ data: currentAllowance });
  });

  simulateContract = vi.fn(() => Promise.resolve({ request: {} }));
  wagmiMocks.usePublicClient.mockReturnValue({ simulateContract });

  wagmiMocks.useReadContract.mockImplementation(
    (params: { functionName?: string }) => {
      if (params?.functionName === "allowance") {
        return {
          data: currentAllowance,
          isLoading: false,
          refetch: refetchAllowanceMock,
        };
      }
      return {
        data: BALANCE,
        isLoading: false,
        refetch: vi.fn(),
      };
    },
  );

  wagmiMocks.useWriteContract.mockImplementation(() => {
    const slot = writeSlots[writeCallIndex++ % 3]!;
    return {
      writeContract: slot.writeContract,
      data: slot.data,
      isPending: false,
      error: null,
      reset: vi.fn(),
    };
  });

  wagmiMocks.useWaitForTransactionReceipt.mockImplementation(() => {
    const slot = receiptSlots[receiptCallIndex++ % 3]!;
    return {
      data: slot.data,
      isLoading: slot.isLoading,
      isSuccess: slot.isSuccess,
    };
  });
}

function setupWallet(walletChainId: number) {
  walletMocks.useWalletState.mockReturnValue({
    address: ACCOUNT,
    chainId: walletChainId,
    isConnected: true,
    isConnecting: false,
    isReconnecting: false,
  });
  const connector = { getChainId: vi.fn(() => Promise.resolve(walletChainId)) };
  wagmiMocks.useAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: walletChainId,
    connector,
    isReconnecting: false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: "connected",
  });
}

function makeCreateReceipt(
  paymentId: bigint,
  escrow: `0x${string}`,
  token: `0x${string}`,
) {
  const topics = encodeEventTopics({
    abi: protectedPaymentEscrowABI,
    eventName: "PaymentCreated",
    args: { paymentId, client: ACCOUNT, worker: WORKER },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("uint256 amount, address token, bytes32 termsHash"),
    [RAW_AMOUNT, token, ZERO_HASH],
  );
  return {
    logs: [
      {
        address: escrow,
        topics,
        data,
        blockNumber: 1n,
        blockHash: ZERO_HASH,
        transactionHash: CREATE_HASH,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
      },
    ],
  };
}

const EMPTY_RECEIPT = { logs: [] };

function buildInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    worker: WORKER,
    amount: RAW_AMOUNT,
    rawAmount: RAW_AMOUNT,
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

// ---------------------------------------------------------------------------
// Harness (copied pattern: real low-level hooks, react-dom roots).
// ---------------------------------------------------------------------------

let root: Root | null = null;
let latest: UseProtectPaymentFlowReturn | null = null;
let bump: (() => void) | null = null;

function DefaultHarness() {
  const api = useProtectPaymentFlow();
  const [, setTick] = useState(0);
  useEffect(() => {
    latest = api;
    bump = () => setTick((t) => t + 1);
  }, [api]);
  return null;
}

async function mountDefault() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DefaultHarness />);
  });
  await act(async () => {});
}

async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function rerender() {
  await act(async () => {
    bump!();
    await flush();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flush();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  latest = null;
  bump = null;
  attributionMock.getAttributionDataSuffix.mockReturnValue(ATTRIBUTION_SUFFIX);
  setupWagmiLayer();
  setupWallet(MAINNET_ID);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});

function writeCalls(slot: number) {
  return writeSlots[slot]!.writeContract.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
}

async function startAndApprove() {
  await mountDefault();
  await act(async () => {
    latest!.start(buildInput());
    await flush();
  });
  writeSlots[0]!.data = CREATE_HASH;
  receiptSlots[0] = {
    data: makeCreateReceipt(CREATED_ID, MAINNET_ESCROW, MAINNET_TOKEN),
    isLoading: false,
    isSuccess: true,
  };
  await rerender();
  expect(latest!.phase).toBe("approving");
  expect(writeCalls(1)).toHaveLength(1);
  writeSlots[1]!.data = APPROVE_HASH;
  receiptSlots[1] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
  await rerender();
  expect(latest!.phase).toBe("funding");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProtectPaymentFlow — allowance-visibility barrier", () => {
  it("stale-then-fresh: fund fires ONLY after sufficient allowance is observed", async () => {
    setAllowanceScript([STALE, STALE, SUFFICIENT]);
    await startAndApprove();

    // Approval confirmed but RPC still stale: fund must NOT fire yet.
    expect(writeCalls(2)).toHaveLength(0);
    expect(latest!.isSyncingAllowance).toBe(true);

    // First poll cycle (immediate refetch already consumed one STALE;
    // 4s interval surfaces SUFFICIENT).
    await advance(4000);
    await rerender();

    expect(writeCalls(2)).toHaveLength(1);
    expect(latest!.isSyncingAllowance).toBe(false);
    const fundWritten = writeCalls(2)[0]![0];
    expect(fundWritten).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: MAINNET_ID,
      functionName: "fundPayment",
      args: [CREATED_ID],
    });

    expect(writeCalls(0)).toHaveLength(1);
    expect(writeCalls(1)).toHaveLength(1);

    // Confirm fund → done.
    writeSlots[2]!.data = FUND_HASH;
    receiptSlots[2] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();
    expect(latest!.phase).toBe("done");
    expect(latest!.error).toBeNull();
  });

  it("already-sufficient: fund fires promptly without waiting", async () => {
    setAllowanceScript([SUFFICIENT]);
    await startAndApprove();

    expect(writeCalls(2)).toHaveLength(1);
    expect(latest!.isSyncingAllowance).toBe(false);
    expect(latest!.error).toBeNull();

    writeSlots[2]!.data = FUND_HASH;
    receiptSlots[2] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();
    expect(latest!.phase).toBe("done");
  });

  it("timeout: stuck allowance surfaces honest sync error and never funds", async () => {
    setAllowanceScript([STALE]);
    await startAndApprove();

    expect(writeCalls(2)).toHaveLength(0);
    expect(latest!.error).toBeNull();

    await advance(61_000);
    await rerender();

    expect(latest!.phase).toBe("funding");
    expect(latest!.error).toBe(SYNC_TIMEOUT_MESSAGE);
    expect(writeCalls(2)).toHaveLength(0);
    expect(writeCalls(0)).toHaveLength(1);
    expect(writeCalls(1)).toHaveLength(1);
    expect(latest!.phase).not.toBe("done");
    expect(latest!.isSyncingAllowance).toBe(false);
  });

  it("post-timeout retry: with fresh allowance, retry fires fund-only once", async () => {
    setAllowanceScript([STALE]);
    await startAndApprove();
    await advance(61_000);
    await rerender();
    expect(latest!.error).toBe(SYNC_TIMEOUT_MESSAGE);
    expect(writeCalls(2)).toHaveLength(0);

    // RPC has now caught up.
    setAllowanceScript([SUFFICIENT]);
    await act(async () => {
      latest!.retry();
      await flush();
    });
    await rerender();

    expect(writeCalls(2)).toHaveLength(1);
    expect(writeCalls(0)).toHaveLength(1);
    expect(writeCalls(1)).toHaveLength(1);

    writeSlots[2]!.data = FUND_HASH;
    receiptSlots[2] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();
    expect(latest!.phase).toBe("done");
    expect(latest!.error).toBeNull();
  });

  it("attribution unchanged: approve + fund carry the mocked dataSuffix", async () => {
    setAllowanceScript([SUFFICIENT]);
    await mountDefault();
    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });

    writeSlots[0]!.data = CREATE_HASH;
    receiptSlots[0] = {
      data: makeCreateReceipt(CREATED_ID, MAINNET_ESCROW, MAINNET_TOKEN),
      isLoading: false,
      isSuccess: true,
    };
    await rerender();

    const approveWritten = writeCalls(1)[0]![0];
    expect(approveWritten).toMatchObject({
      address: MAINNET_TOKEN,
      chainId: MAINNET_ID,
      functionName: "approve",
      args: [MAINNET_ESCROW, RAW_AMOUNT],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });

    writeSlots[1]!.data = APPROVE_HASH;
    receiptSlots[1] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();

    expect(writeCalls(2)).toHaveLength(1);
    const fundWritten = writeCalls(2)[0]![0];
    expect(fundWritten).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: MAINNET_ID,
      functionName: "fundPayment",
      args: [CREATED_ID],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(approveWritten.dataSuffix).toBe(ATTRIBUTION_SUFFIX);
    expect(fundWritten.dataSuffix).toBe(ATTRIBUTION_SUFFIX);
  });
});
