// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useProtectPaymentFlow — P4.2b orchestration tests (mocks only, no real tx).
//
// Uses the REAL low-level hooks (useCreatePayment / useTokenApproval /
// useFundPayment) with a mocked wagmi layer, proving:
//   - creation defaults to DEFAULT_NEW_PAYMENT_CHAIN_ID (Celo Mainnet)
//   - create → exact approve → fund order on Mainnet
//   - Mainnet writes retain the attribution suffix (simulate + write agree)
//   - failure never marks success
//   - retry of approve/fund never re-creates
//   - Sepolia regression (explicit CELO_CHAIN_ID still targets Sepolia/USDC)
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
import {
  getEscrowContractAddress,
  getEscrowContractConfig,
} from "@/lib/contracts/config";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

// Canonical values (resolved from the real lib — never magic literals).
const MAINNET_ID = DEFAULT_NEW_PAYMENT_CHAIN_ID;
const MAINNET_ESCROW = getEscrowContractAddress(MAINNET_ID);
const MAINNET_TOKEN = getPaymentTokenConfig(MAINNET_ID).address;
const SEPOLIA_ESCROW = getEscrowContractAddress(CELO_CHAIN_ID);
const SEPOLIA_TOKEN = getPaymentTokenConfig(CELO_CHAIN_ID).address;

const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const WORKER = "0x2222222222222222222222222222222222222222" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const CREATE_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const APPROVE_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const FUND_HASH = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const RAW_AMOUNT = 1_000_000n;
const CREATED_ID = 7n;

// ---------------------------------------------------------------------------
// Slot-multiplexed wagmi mocks.
//
// Each render calls useWriteContract / useWaitForTransactionReceipt exactly
// 3x in a stable order (create → approval → fund), so a rotating counter
// routes each call to its slot.
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

function setupWagmiLayer() {
  writeSlots = [0, 1, 2].map(() => ({
    // Settle immediately like a wallet that returned: invoke onSettled so
    // the hooks' duplicate-submission guard releases (a strictly-mocked
    // writeContract that never settles would latch in-flight forever).
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

  simulateContract = vi.fn(() => Promise.resolve({ request: {} }));
  wagmiMocks.usePublicClient.mockReturnValue({ simulateContract });

  // Allowance reads resolve immediately sufficient (RAW_AMOUNT) so the
  // allowance-visibility barrier passes without waiting: these tests cover
  // orchestration order/attribution/retry, while stale-allowance syncing is
  // covered in useProtectPaymentFlow-sync.test.tsx. Balance stays undefined
  // (never asserted here).
  wagmiMocks.useReadContract.mockImplementation((params: unknown) => ({
    data:
      (params as { functionName?: string } | undefined)?.functionName ===
      "allowance"
        ? RAW_AMOUNT
        : undefined,
    isLoading: false,
    refetch: vi.fn(),
  }));

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

/**
 * Craft a minimal transaction receipt whose logs decode to a PaymentCreated
 * event via the REAL parseEventLogs path (topics from encodeEventTopics,
 * data from encodeAbiParameters — this viem build has no encodeEventLog).
 */
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
// Harness
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

function ChainHarness({ chainId }: { chainId: number }) {
  const api = useProtectPaymentFlow(chainId);
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

async function mountChain(chainId: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ChainHarness chainId={chainId} />);
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

beforeEach(() => {
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
});

function writeCalls(slot: number) {
  return writeSlots[slot]!.writeContract.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProtectPaymentFlow — Mainnet default + write-through", () => {
  it("creation defaults to Mainnet with attribution on simulate + write", async () => {
    await mountDefault();
    expect(latest!.chainId).toBe(MAINNET_ID);

    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });

    expect(wagmiMocks.usePublicClient).toHaveBeenCalledWith({
      chainId: MAINNET_ID,
    });
    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeCalls(0)).toHaveLength(1);

    const sim = simulateContract.mock.calls[0]![0] as Record<string, unknown>;
    const written = writeCalls(0)[0]![0];
    const escrow = getEscrowContractConfig(MAINNET_ID).address;
    expect(sim).toMatchObject({
      address: escrow,
      chainId: MAINNET_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: escrow,
      chainId: MAINNET_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(sim.dataSuffix).toBe(written.dataSuffix);
    expect(latest!.phase).toBe("creating");
    expect(latest!.error).toBeNull();
  });

  it("create → exact approve → fund order on Mainnet, then done", async () => {
    await mountDefault();
    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });

    // Confirm create with a crafted PaymentCreated receipt.
    writeSlots[0]!.data = CREATE_HASH;
    receiptSlots[0] = {
      data: makeCreateReceipt(CREATED_ID, MAINNET_ESCROW, MAINNET_TOKEN),
      isLoading: false,
      isSuccess: true,
    };
    await rerender();

    expect(latest!.phase).toBe("approving");
    expect(latest!.createdPaymentId).toBe(CREATED_ID);
    expect(writeCalls(1)).toHaveLength(1);
    const approveWritten = writeCalls(1)[0]![0];
    expect(approveWritten).toMatchObject({
      address: MAINNET_TOKEN,
      chainId: MAINNET_ID,
      functionName: "approve",
      args: [MAINNET_ESCROW, RAW_AMOUNT],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(latest!.progressLabel).toBe("Approving USA₮…");

    // Confirm approve → fund fires with the created payment ID.
    writeSlots[1]!.data = APPROVE_HASH;
    receiptSlots[1] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();

    expect(latest!.phase).toBe("funding");
    expect(writeCalls(2)).toHaveLength(1);
    const fundWritten = writeCalls(2)[0]![0];
    expect(fundWritten).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: MAINNET_ID,
      functionName: "fundPayment",
      args: [CREATED_ID],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(latest!.progressLabel).toBe("Protecting funds…");

    // Confirm fund → done.
    writeSlots[2]!.data = FUND_HASH;
    receiptSlots[2] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();

    expect(latest!.phase).toBe("done");
    expect(latest!.error).toBeNull();
    expect(latest!.progressLabel).toBe("Payment protected");
  });

  it("create failure never marks success and retry re-creates", async () => {
    simulateContract.mockImplementation((params: { functionName: string }) =>
      params.functionName === "createPayment"
        ? Promise.reject(new Error("User rejected"))
        : Promise.resolve({ request: {} }),
    );
    await mountDefault();
    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });

    expect(latest!.phase).toBe("creating");
    expect(latest!.error).not.toBeNull();
    expect(writeCalls(0)).toHaveLength(0);
    expect(writeCalls(1)).toHaveLength(0);
    expect(writeCalls(2)).toHaveLength(0);

    // Retry while create never succeeded → re-create is correct here.
    simulateContract.mockImplementation(() => Promise.resolve({ request: {} }));
    await act(async () => {
      latest!.retry();
      await flush();
    });
    expect(writeCalls(0)).toHaveLength(1);
    expect(writeCalls(1)).toHaveLength(0);
  });

  it("approve failure retries approve without re-creating", async () => {
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
    expect(writeCalls(1)).toHaveLength(1);

    // Fail the approve simulation, then surface the error.
    simulateContract.mockImplementation((params: { functionName: string }) =>
      params.functionName === "approve"
        ? Promise.reject(new Error("User rejected"))
        : Promise.resolve({ request: {} }),
    );
    await act(async () => {
      latest!.retry();
      await flush();
    });
    await rerender();

    expect(latest!.phase).toBe("approving");
    expect(latest!.error).not.toBeNull();
    expect(writeCalls(0)).toHaveLength(1); // never re-created
    expect(writeCalls(2)).toHaveLength(0); // never funded early

    // Retry approves again — still no re-create.
    simulateContract.mockImplementation(() => Promise.resolve({ request: {} }));
    await act(async () => {
      latest!.retry();
      await flush();
    });
    expect(writeCalls(1)).toHaveLength(2);
    expect(writeCalls(0)).toHaveLength(1);
  });

  it("fund failure retries fund only", async () => {
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
    writeSlots[1]!.data = APPROVE_HASH;
    receiptSlots[1] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();
    expect(latest!.phase).toBe("funding");
    expect(writeCalls(2)).toHaveLength(1);

    simulateContract.mockImplementation((params: { functionName: string }) =>
      params.functionName === "fundPayment"
        ? Promise.reject(new Error("User rejected"))
        : Promise.resolve({ request: {} }),
    );
    await act(async () => {
      latest!.retry();
      await flush();
    });
    await rerender();

    expect(latest!.phase).toBe("funding");
    expect(latest!.error).not.toBeNull();
    expect(writeCalls(2)).toHaveLength(1); // failed attempt wrote nothing new

    simulateContract.mockImplementation(() => Promise.resolve({ request: {} }));
    await act(async () => {
      latest!.retry();
      await flush();
    });
    expect(writeCalls(2)).toHaveLength(2);
    expect(writeCalls(0)).toHaveLength(1);
    expect(writeCalls(1)).toHaveLength(1);
  });

  it("create success without a payment ID does not advance", async () => {
    await mountDefault();
    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });
    writeSlots[0]!.data = CREATE_HASH;
    receiptSlots[0] = { data: EMPTY_RECEIPT, isLoading: false, isSuccess: true };
    await rerender();

    expect(latest!.phase).toBe("creating");
    expect(latest!.createdPaymentId).toBeUndefined();
    expect(latest!.error).toMatch(/could not read its payment ID/i);
    expect(writeCalls(1)).toHaveLength(0);
    expect(writeCalls(2)).toHaveLength(0);
  });
});

describe("useProtectPaymentFlow — Sepolia regression", () => {
  it("explicit Sepolia chain targets the Sepolia escrow + USDC", async () => {
    setupWallet(CELO_CHAIN_ID);
    await mountChain(CELO_CHAIN_ID);
    expect(latest!.chainId).toBe(CELO_CHAIN_ID);

    await act(async () => {
      latest!.start(buildInput());
      await flush();
    });

    expect(wagmiMocks.usePublicClient).toHaveBeenCalledWith({
      chainId: CELO_CHAIN_ID,
    });
    const sim = simulateContract.mock.calls[0]![0] as Record<string, unknown>;
    const written = writeCalls(0)[0]![0];
    expect(sim).toMatchObject({
      address: SEPOLIA_ESCROW,
      chainId: CELO_CHAIN_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: SEPOLIA_ESCROW,
      chainId: CELO_CHAIN_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });

    // Sepolia approve targets the Sepolia (USDC) token, exact amount.
    writeSlots[0]!.data = CREATE_HASH;
    receiptSlots[0] = {
      data: makeCreateReceipt(CREATED_ID, SEPOLIA_ESCROW, SEPOLIA_TOKEN),
      isLoading: false,
      isSuccess: true,
    };
    await rerender();

    expect(latest!.phase).toBe("approving");
    expect(writeCalls(1)[0]![0]).toMatchObject({
      address: SEPOLIA_TOKEN,
      functionName: "approve",
      args: [SEPOLIA_ESCROW, RAW_AMOUNT],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
  });
});
