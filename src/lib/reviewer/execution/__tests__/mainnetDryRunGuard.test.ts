// ---------------------------------------------------------------------------
// P4.1b executor mainnet dry-run guard (mocked chain + DB, no real RPC).
//
// - Sepolia dry-run behavior is unchanged (DRY_RUN cancellation).
// - Mainnet dry-run is explicitly refused (DRY_RUN_REFUSED_ON_MAINNET).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  getSupabaseClient: vi.fn(),
  parsePaymentData: vi.fn(),
  getAttributionDataSuffix: vi.fn(() => undefined),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    createWalletClient: mocks.createWalletClient,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock("@/lib/contracts/types", () => ({
  parsePaymentData: mocks.parsePaymentData,
}));

vi.mock("@/lib/contracts/attribution", () => ({
  getAttributionDataSuffix: mocks.getAttributionDataSuffix,
}));

import {
  executeDisputeResolution,
  isDryRunRefusedOnMainnet,
} from "@/lib/reviewer/execution/executor";

const PAYMENT_IDENTIFIER = "pay_guard_case";
const DECISION_ID = "550e8400-e29b-41d4-a716-446655440001";
const SEPOLIA_CONTRACT = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_CONTRACT = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const CLIENT = "0x1111111111111111111111111111111111111111";
const WORKER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

function makeBuilder(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    payload: undefined,
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
    catch(reject: (reason: unknown) => unknown) {
      return Promise.resolve(result).catch(reject);
    },
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  for (const method of ["select", "insert", "update", "eq", "in"]) {
    builder[method] = vi.fn((payload?: unknown) => {
      if (method === "update" || method === "insert") builder.payload = payload;
      return builder;
    });
  }
  return builder;
}

function makeDecision(chainId: number, contract: string) {
  return {
    id: DECISION_ID,
    payment_identifier: PAYMENT_IDENTIFIER,
    reviewer_address: CLIENT,
    decision: "release_to_worker",
    rationale: "Guard test.",
    client_amount: null,
    worker_amount: null,
    decision_status: "ready_for_execution",
    onchain_payment_id: "7",
    chain_id: chainId,
    contract_address: contract,
    onchain_snapshot: {
      id: "7",
      chainId,
      contractAddress: contract,
      client: CLIENT,
      worker: WORKER,
      amount: "1000000",
      token: TOKEN,
      state: "Disputed",
    },
  };
}

function setupMocks(chainId: number, contract: string) {
  mocks.createPublicClient.mockReturnValue({
    readContract: vi.fn(async () => ({})),
    waitForTransactionReceipt: vi.fn(),
    simulateContract: vi.fn(),
  });
  mocks.createWalletClient.mockReturnValue({ writeContract: vi.fn() });
  mocks.parsePaymentData.mockImplementation(() => ({
    id: 7n,
    client: CLIENT,
    worker: WORKER,
    amount: 1000000n,
    token: TOKEN,
    state: "Disputed",
  }));

  const builders = [
    makeBuilder({ data: makeDecision(chainId, contract), error: null }),
    makeBuilder({ data: null, error: null }),
    makeBuilder({ data: { id: "execution-1" }, error: null }),
    makeBuilder({ data: null, error: null }),
  ];
  mocks.getSupabaseClient.mockReturnValue({
    from: vi.fn(() => builders.shift() ?? makeBuilder({ data: null, error: null })),
  });
}

describe("P4.1b executor dry-run mainnet guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "ESCROW_EXECUTOR_PRIVATE_KEY",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  it("isDryRunRefusedOnMainnet is true only for mainnet + dry-run", () => {
    vi.stubEnv("ESCROW_EXECUTION_DRY_RUN", "true");
    expect(isDryRunRefusedOnMainnet(42220)).toBe(true);
    expect(isDryRunRefusedOnMainnet(11142220)).toBe(false);
    vi.stubEnv("ESCROW_EXECUTION_DRY_RUN", "false");
    expect(isDryRunRefusedOnMainnet(42220)).toBe(false);
  });

  it("Sepolia dry-run behavior is unchanged (DRY_RUN cancellation)", async () => {
    vi.stubEnv("ESCROW_EXECUTION_DRY_RUN", "true");
    setupMocks(11142220, SEPOLIA_CONTRACT);

    const result = await executeDisputeResolution(PAYMENT_IDENTIFIER, DECISION_ID);

    expect(result).toMatchObject({
      success: false,
      status: "cancelled",
      errorCode: "DRY_RUN",
      dryRun: true,
    });
  });

  it("Mainnet dry-run is explicitly refused (never masquerades as success)", async () => {
    vi.stubEnv("ESCROW_EXECUTION_DRY_RUN", "true");
    setupMocks(42220, MAINNET_CONTRACT);

    const result = await executeDisputeResolution(PAYMENT_IDENTIFIER, DECISION_ID);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("DRY_RUN_REFUSED_ON_MAINNET");
    expect(result.dryRun).toBe(true);
    // No transaction is simulated or submitted on the refused path.
    expect(mocks.createWalletClient).not.toHaveBeenCalled();
  });
});
