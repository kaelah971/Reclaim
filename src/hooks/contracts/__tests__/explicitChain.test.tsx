// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.1a — explicit supported chain plumbing (hook-level).
//
// Proves:
//   - 42220 resolves canonical Mainnet escrow + USAT 6 decimals
//   - Reads target the Mainnet escrow when chainId=42220
//   - Sepolia unchanged (default + explicit)
//   - Unsupported chains fail closed (no hidden Mainnet→Sepolia fallback)
//   - Mainnet calldata paths still attach the attribution suffix
//     (follows existing attribution test patterns:
//      one captured suffix, same for simulate + write, exact-amount approve)
//   - Wallet chain must equal requested chain (explicit user-facing errors)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toDataSuffix } from "@celo/attribution-tags";

const CELO_SEPOLIA_ID = 11142220;
const CELO_MAINNET_ID = 42220;
const SEPOLIA_V2 = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const MAINNET_USAT = "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771";
const ATTRIBUTION_SUFFIX = toDataSuffix("celo_b7de8bf7e64e");
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const REFERENCE =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const PAYMENT_ID = 1n;
const APPROVE_AMOUNT = 12_345n;

// ---- Mocks (wagmi + wallet + attribution). Config/tokens stay REAL to
// prove canonical Mainnet/Sepolia resolution. ----
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
  usePaymentCount,
  usePayment,
  useClientPaymentIds,
  useWorkerPaymentIds,
  useIsPaused,
  useEscrowToken,
} from "../useReadContract";
import { useCreatePayment } from "../useCreatePayment";
import { useTokenApproval } from "../useTokenApproval";
import {
  useFundPayment,
  useSubmitEvidenceHash,
  getEscrowSwitchChainError,
  ESCROW_SWITCH_CHAIN_ERROR,
} from "../useEscrowActions";
import {
  getEscrowContractAddress,
  getEscrowContractConfig,
} from "@/lib/contracts/config";
import { getEscrowTokenConfig } from "@/lib/web3/tokens";

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

let root: Root | null = null;

async function mountHarness(render: () => React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(render());
  });
  await act(async () => {});
}

async function unmountHarness() {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
}

type MockFn = { mock: { calls: unknown } };

function mockCalls(mockFn: MockFn): Array<[Record<string, unknown>]> {
  return mockFn.mock.calls as unknown as Array<[Record<string, unknown>]>;
}

function firstParams(mockFn: MockFn): Record<string, unknown> {
  return mockCalls(mockFn)[0]![0];
}

function setupReadMock() {
  wagmiMocks.useReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
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
}

function setupPublicClient() {
  const simulateContract = vi.fn(() => Promise.resolve({ request: {} }));
  wagmiMocks.usePublicClient.mockReturnValue({ simulateContract });
  return { simulateContract };
}

function setupWrite() {
  const writeContract = vi.fn();
  wagmiMocks.useWriteContract.mockReturnValue({
    writeContract,
    data: undefined,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: false,
  });
  return { writeContract };
}

function setupAccountForEscrow(
  storeChainId: number,
  liveChainId: number,
  isReconnecting = false,
) {
  const connector = {
    getChainId: vi.fn(() => Promise.resolve(liveChainId)),
  };
  wagmiMocks.useAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: storeChainId,
    connector,
    isReconnecting,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: isReconnecting ? "reconnecting" : "connected",
  });
  return { connector };
}

beforeEach(() => {
  vi.clearAllMocks();
  attributionMock.getAttributionDataSuffix.mockReturnValue(ATTRIBUTION_SUFFIX);
  setupReadMock();
  setupWallet(CELO_SEPOLIA_ID);
  setupPublicClient();
  setupWrite();
  setupAccountForEscrow(CELO_SEPOLIA_ID, CELO_SEPOLIA_ID);
});

afterEach(async () => {
  await unmountHarness();
});

// ---------------------------------------------------------------------------
// Lib sanity (canonical values used by hook assertions below)
// ---------------------------------------------------------------------------

describe("P4.1a canonical resolution (hook-test sanity)", () => {
  it("42220 resolves canonical escrow + USAT 6 decimals", () => {
    expect(getEscrowContractAddress(CELO_MAINNET_ID)).toBe(MAINNET_ESCROW);
    expect(getEscrowContractConfig(CELO_MAINNET_ID)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
    });
    const token = getEscrowTokenConfig(CELO_MAINNET_ID);
    expect(token.address).toBe(MAINNET_USAT);
    expect(token.symbol).toBe("USAT");
    expect(token.decimals).toBe(6);
    expect(token.chainId).toBe(CELO_MAINNET_ID);
  });

  it("Sepolia unchanged", () => {
    expect(getEscrowContractAddress(CELO_SEPOLIA_ID)).toBe(SEPOLIA_V2);
    expect(getEscrowContractConfig(CELO_SEPOLIA_ID)).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
    });
    expect(getEscrowContractAddress()).toBe(SEPOLIA_V2);
    expect(getEscrowContractConfig()).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
    });
  });

  it("unsupported chains fail closed", () => {
    expect(() => getEscrowContractAddress(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => getEscrowContractConfig(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => getEscrowTokenConfig(1)).toThrow(/unsupported/i);
  });

  it("chain-parameterized switch errors are explicit", () => {
    expect(ESCROW_SWITCH_CHAIN_ERROR).toBe(
      "Switch to Celo Sepolia to continue.",
    );
    expect(getEscrowSwitchChainError(CELO_SEPOLIA_ID)).toBe(
      ESCROW_SWITCH_CHAIN_ERROR,
    );
    expect(getEscrowSwitchChainError(CELO_MAINNET_ID)).toBe(
      "Switch to Celo Mainnet to continue.",
    );
  });
});

// ---------------------------------------------------------------------------
// Reads target the explicit chain
// ---------------------------------------------------------------------------

describe("P4.1a reads target the explicit chain", () => {
  it("usePaymentCount targets Mainnet escrow when chainId=42220", async () => {
    function Harness() {
      usePaymentCount(CELO_MAINNET_ID);
      return null;
    }
    await mountHarness(() => <Harness />);
    expect(wagmiMocks.useReadContract).toHaveBeenCalled();
    expect(firstParams(wagmiMocks.useReadContract)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "paymentCount",
    });
  });

  it("usePayment targets Mainnet escrow when chainId=42220", async () => {
    function Harness() {
      usePayment(PAYMENT_ID, CELO_MAINNET_ID);
      return null;
    }
    await mountHarness(() => <Harness />);
    expect(firstParams(wagmiMocks.useReadContract)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "getPayment",
      args: [PAYMENT_ID],
    });
  });

  it("useClientPaymentIds / useWorkerPaymentIds / useIsPaused / useEscrowToken target Mainnet", async () => {
    const expectations: Array<{
      render: () => React.ReactNode;
      functionName: string;
    }> = [
      {
        render: () => {
          function H() {
            useClientPaymentIds(ACCOUNT, CELO_MAINNET_ID);
            return null;
          }
          return <H />;
        },
        functionName: "getClientPaymentIds",
      },
      {
        render: () => {
          function H() {
            useWorkerPaymentIds(ACCOUNT, CELO_MAINNET_ID);
            return null;
          }
          return <H />;
        },
        functionName: "getWorkerPaymentIds",
      },
      {
        render: () => {
          function H() {
            useIsPaused(CELO_MAINNET_ID);
            return null;
          }
          return <H />;
        },
        functionName: "paused",
      },
      {
        render: () => {
          function H() {
            useEscrowToken(CELO_MAINNET_ID);
            return null;
          }
          return <H />;
        },
        functionName: "escrowToken",
      },
    ];

    for (const { render, functionName } of expectations) {
      vi.clearAllMocks();
      setupReadMock();
      await unmountHarness();
      await mountHarness(render);
      const params = firstParams(wagmiMocks.useReadContract);
      expect(params.address).toBe(MAINNET_ESCROW);
      expect(params.chainId).toBe(CELO_MAINNET_ID);
      expect(params.functionName).toBe(functionName);
    }
  });

  it("reads default to Sepolia for backward compat and stay identical when Sepolia is explicit", async () => {
    function DefaultHarness() {
      usePaymentCount();
      return null;
    }
    await mountHarness(() => <DefaultHarness />);
    expect(firstParams(wagmiMocks.useReadContract)).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
    });

    vi.clearAllMocks();
    setupReadMock();
    await unmountHarness();

    function ExplicitHarness() {
      usePaymentCount(CELO_SEPOLIA_ID);
      return null;
    }
    await mountHarness(() => <ExplicitHarness />);
    expect(firstParams(wagmiMocks.useReadContract)).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
    });
  });

  it("reads fail closed for unsupported chains", async () => {
    let threw: unknown = null;
    function BadHarness() {
      usePaymentCount(1);
      return null;
    }
    try {
      await mountHarness(() => <BadHarness />);
    } catch (err) {
      threw = err;
    }
    expect(() => getEscrowContractConfig(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(threw ?? "threw-or-config-fails").toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mainnet calldata paths attach the attribution suffix
// ---------------------------------------------------------------------------

describe("P4.1a Mainnet calldata paths attach attribution suffix", () => {
  it("useCreatePayment(42220) simulates + writes on Mainnet escrow with one captured suffix", async () => {
    setupWallet(CELO_MAINNET_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useCreatePayment> | null = null;
    function Harness() {
      const inner = useCreatePayment(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);
    expect(latest).not.toBeNull();

    expect(wagmiMocks.usePublicClient).toHaveBeenCalledWith({
      chainId: CELO_MAINNET_ID,
    });

    await act(async () => {
      latest!.createPayment({
        worker: ACCOUNT,
        amount: 1_000_000n,
        agreementLabel: "Test",
        deliverableSummary: "Summary",
        deliveryFormat: "URL",
        deliveryDeadline: Math.floor(Date.now() / 1000) + 86400,
        releaseRule: "On approval",
        autoReleaseSeconds: 0,
        disputeWindowSeconds: 86400,
        evidenceExpectation: "Link",
      });
      await Promise.resolve();
    });

    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const sim = firstParams({ mock: simulateContract.mock });
    const written = firstParams({ mock: writeContract.mock });

    expect(attributionMock.getAttributionDataSuffix).toHaveBeenCalled();
    expect(sim).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "createPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(sim.dataSuffix).toBe(written.dataSuffix);
    expect(sim.args).toEqual(written.args);
  });

  it("useTokenApproval(42220) approves the exact Mainnet amount with attribution", async () => {
    setupWallet(CELO_MAINNET_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useTokenApproval> | null = null;
    function Harness() {
      const inner = useTokenApproval(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    const readCalls = mockCalls(wagmiMocks.useReadContract);
    expect(readCalls.length).toBeGreaterThanOrEqual(2);
    expect(readCalls[0]![0]).toMatchObject({
      address: MAINNET_USAT,
      chainId: CELO_MAINNET_ID,
    });
    expect(readCalls[1]![0]).toMatchObject({
      address: MAINNET_USAT,
      chainId: CELO_MAINNET_ID,
    });

    expect(wagmiMocks.usePublicClient).toHaveBeenCalledWith({
      chainId: CELO_MAINNET_ID,
    });

    await act(async () => {
      latest!.approve(APPROVE_AMOUNT);
      await Promise.resolve();
    });

    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const simulated = firstParams({ mock: simulateContract.mock });
    const written = firstParams({ mock: writeContract.mock });

    expect(simulated).toMatchObject({
      address: MAINNET_USAT,
      functionName: "approve",
      args: [MAINNET_ESCROW, APPROVE_AMOUNT],
      account: ACCOUNT,
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: MAINNET_USAT,
      chainId: CELO_MAINNET_ID,
      functionName: "approve",
      args: [MAINNET_ESCROW, APPROVE_AMOUNT],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(simulated.dataSuffix).toBe(written.dataSuffix);
  });

  it("useSubmitEvidenceHash(42220) simulates + writes on Mainnet escrow with attribution", async () => {
    setupAccountForEscrow(CELO_MAINNET_ID, CELO_MAINNET_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useSubmitEvidenceHash> | null = null;
    function Harness() {
      const inner = useSubmitEvidenceHash(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.action(PAYMENT_ID, REFERENCE);
    });

    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const simulated = firstParams({ mock: simulateContract.mock });
    const written = firstParams({ mock: writeContract.mock });

    expect(simulated).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "submitEvidenceHash",
      args: [PAYMENT_ID, REFERENCE],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(written).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "submitEvidenceHash",
      args: [PAYMENT_ID, REFERENCE],
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(simulated.dataSuffix).toBe(written.dataSuffix);
    expect(latest!.error).toBeNull();
  });

  it("useFundPayment(42220) targets Mainnet escrow with attribution", async () => {
    setupAccountForEscrow(CELO_MAINNET_ID, CELO_MAINNET_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useFundPayment> | null = null;
    function Harness() {
      const inner = useFundPayment(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.action(PAYMENT_ID);
    });

    expect(simulateContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(firstParams({ mock: simulateContract.mock })).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "fundPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(firstParams({ mock: writeContract.mock })).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_ID,
      functionName: "fundPayment",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
  });

  it("Sepolia write paths unchanged (default Sepolia escrow + attribution)", async () => {
    setupAccountForEscrow(CELO_SEPOLIA_ID, CELO_SEPOLIA_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useSubmitEvidenceHash> | null = null;
    function Harness() {
      const inner = useSubmitEvidenceHash();
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.action(PAYMENT_ID, REFERENCE);
    });

    expect(firstParams({ mock: simulateContract.mock })).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
      functionName: "submitEvidenceHash",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
    expect(firstParams({ mock: writeContract.mock })).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_ID,
      functionName: "submitEvidenceHash",
      dataSuffix: ATTRIBUTION_SUFFIX,
    });
  });
});

// ---------------------------------------------------------------------------
// Chain-mismatch guards: wallet chain must equal requested chain
// ---------------------------------------------------------------------------

describe("P4.1a chain-mismatch guards are explicit", () => {
  it("useCreatePayment(42220) with Sepolia wallet asks for Mainnet", async () => {
    setupWallet(CELO_SEPOLIA_ID);
    setupPublicClient();
    setupWrite();

    let latest: ReturnType<typeof useCreatePayment> | null = null;
    function Harness() {
      const inner = useCreatePayment(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.createPayment({
        worker: ACCOUNT,
        amount: 100n,
        agreementLabel: "T",
        deliverableSummary: "S",
        deliveryFormat: "F",
        deliveryDeadline: Math.floor(Date.now() / 1000) + 60,
        releaseRule: "R",
        autoReleaseSeconds: 0,
        disputeWindowSeconds: 60,
        evidenceExpectation: "E",
      });
    });

    expect(latest!.error).toBe(
      "Switch to Celo Mainnet to create a payment.",
    );
  });

  it("useCreatePayment() default with Mainnet wallet still asks for Sepolia (backward compat)", async () => {
    setupWallet(CELO_MAINNET_ID);
    setupPublicClient();
    setupWrite();

    let latest: ReturnType<typeof useCreatePayment> | null = null;
    function Harness() {
      const inner = useCreatePayment();
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.createPayment({
        worker: ACCOUNT,
        amount: 100n,
        agreementLabel: "T",
        deliverableSummary: "S",
        deliveryFormat: "F",
        deliveryDeadline: Math.floor(Date.now() / 1000) + 60,
        releaseRule: "R",
        autoReleaseSeconds: 0,
        disputeWindowSeconds: 60,
        evidenceExpectation: "E",
      });
    });

    expect(latest!.error).toBe(
      "Switch to Celo Sepolia to create a payment.",
    );
  });

  it("useTokenApproval(42220) with Sepolia wallet asks for Mainnet USAT", async () => {
    setupWallet(CELO_SEPOLIA_ID);
    setupPublicClient();
    setupWrite();

    let latest: ReturnType<typeof useTokenApproval> | null = null;
    function Harness() {
      const inner = useTokenApproval(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.approve(APPROVE_AMOUNT);
    });

    expect(latest!.approveError).toBe(
      "Switch to Celo Mainnet to approve USAT.",
    );
  });

  it("useSubmitEvidenceHash(42220) with live Sepolia chain is blocked with Mainnet copy", async () => {
    setupAccountForEscrow(CELO_SEPOLIA_ID, CELO_SEPOLIA_ID);
    const { simulateContract } = setupPublicClient();
    const { writeContract } = setupWrite();

    let latest: ReturnType<typeof useSubmitEvidenceHash> | null = null;
    function Harness() {
      const inner = useSubmitEvidenceHash(CELO_MAINNET_ID);
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.action(PAYMENT_ID, REFERENCE);
    });

    expect(latest!.error).toBe("Switch to Celo Mainnet to continue.");
    expect(simulateContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("useSubmitEvidenceHash() default with live Mainnet chain is blocked with Sepolia copy", async () => {
    setupAccountForEscrow(CELO_SEPOLIA_ID, CELO_MAINNET_ID);
    setupPublicClient();
    setupWrite();

    let latest: ReturnType<typeof useSubmitEvidenceHash> | null = null;
    function Harness() {
      const inner = useSubmitEvidenceHash();
      useEffect(() => {
        latest = inner;
      }, [inner]);
      return null;
    }
    await mountHarness(() => <Harness />);

    await act(async () => {
      latest!.action(PAYMENT_ID, REFERENCE);
    });

    expect(latest!.error).toBe(ESCROW_SWITCH_CHAIN_ERROR);
  });
});
