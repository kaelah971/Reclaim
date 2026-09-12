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

import { executeDisputeResolution } from "@/lib/reviewer/execution/executor";

const PAYMENT_IDENTIFIER = "pay_reviewer_case_uuid";
const DECISION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONTRACT = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const CLIENT = "0x1111111111111111111111111111111111111111";
const WORKER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

function makeDecision() {
  return {
    id: DECISION_ID,
    payment_identifier: PAYMENT_IDENTIFIER,
    reviewer_address: CLIENT,
    decision: "release_to_worker",
    rationale: "The worker delivered the agreed protected work.",
    client_amount: null,
    worker_amount: null,
    decision_status: "ready_for_execution",
    onchain_payment_id: "7",
    chain_id: 11142220,
    contract_address: CONTRACT,
    onchain_snapshot: {
      id: "7",
      chainId: 11142220,
      contractAddress: CONTRACT,
      client: CLIENT,
      worker: WORKER,
      amount: "1000000",
      token: TOKEN,
      state: "Disputed",
    },
  };
}

describe("reviewer execution receipt ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ESCROW_EXECUTOR_PRIVATE_KEY", "0x0000000000000000000000000000000000000000000000000000000000000001");
    vi.stubEnv("ESCROW_EXECUTION_DRY_RUN", "false");

    let readCount = 0;
    const readContract = vi.fn(async () => {
      readCount += 1;
      return {};
    });
    const waitForTransactionReceipt = vi.fn();
    const simulateContract = vi.fn().mockResolvedValue({ request: { requestId: "request" } });
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);

    mocks.createPublicClient.mockReturnValue({
      readContract,
      waitForTransactionReceipt,
      simulateContract,
    });
    mocks.createWalletClient.mockReturnValue({ writeContract });
    mocks.parsePaymentData.mockImplementation(() => ({
      id: 7n,
      client: CLIENT,
      worker: WORKER,
      amount: 1000000n,
      token: TOKEN,
      state: readCount >= 2 ? "Resolved" : "Disputed",
    }));

    const decisionBuilder = makeBuilder({ data: makeDecision(), error: null });
    const existingExecutionBuilder = makeBuilder({ data: null, error: null });
    const insertBuilder = makeBuilder({ data: { id: "execution-1" }, error: null });
    const updateBuilders = [
      makeBuilder({ data: null, error: null }),
      makeBuilder({ data: null, error: null }),
      makeBuilder({ data: null, error: null }),
    ];

    const builders = [decisionBuilder, existingExecutionBuilder, insertBuilder, ...updateBuilders];
    mocks.getSupabaseClient.mockReturnValue({
      from: vi.fn(() => builders.shift() ?? makeBuilder({ data: null, error: null })),
    });

    // Expose the deferred receipt and DB builders to each test without using a live chain.
    (mocks as typeof mocks & { waitForTransactionReceipt: typeof waitForTransactionReceipt }).waitForTransactionReceipt = waitForTransactionReceipt;
    (mocks as typeof mocks & { updateBuilders: typeof updateBuilders }).updateBuilders = updateBuilders;
    (mocks as typeof mocks & { insertBuilder: typeof insertBuilder }).insertBuilder = insertBuilder;
    (mocks as typeof mocks & { simulateContract: typeof simulateContract }).simulateContract = simulateContract;
    (mocks as typeof mocks & { writeContract: typeof writeContract }).writeContract = writeContract;
  });

  it("does not persist confirmed until the receipt succeeds and state is Resolved", async () => {
    let resolveReceipt!: (receipt: { status: "success"; blockNumber: bigint; gasUsed: bigint }) => void;
    const receiptPromise = new Promise<{ status: "success"; blockNumber: bigint; gasUsed: bigint }>((resolve) => {
      resolveReceipt = resolve;
    });
    const waitForReceipt = (mocks as typeof mocks & { waitForTransactionReceipt: ReturnType<typeof vi.fn> }).waitForTransactionReceipt;
    waitForReceipt.mockReturnValue(receiptPromise);

    const execution = executeDisputeResolution(PAYMENT_IDENTIFIER, DECISION_ID);
    await vi.waitFor(() => expect(waitForReceipt).toHaveBeenCalledWith({ hash: TX_HASH }));

    const updateBuilders = (mocks as typeof mocks & { updateBuilders: Array<{ payload?: unknown }> }).updateBuilders;
    expect(updateBuilders.some((builder) => (builder.payload as { status?: string } | undefined)?.status === "confirmed")).toBe(false);

    resolveReceipt({ status: "success", blockNumber: 99n, gasUsed: 21n });
    const result = await execution;

    expect(result).toMatchObject({ success: true, status: "confirmed", transactionHash: TX_HASH });
    expect(updateBuilders.some((builder) => (builder.payload as { status?: string } | undefined)?.status === "confirmed")).toBe(true);
    const simulateContract = (mocks as typeof mocks & { simulateContract: ReturnType<typeof vi.fn> }).simulateContract;
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: CONTRACT,
      functionName: "resolveDispute",
      args: [7n, 0n],
    }));
    expect((mocks as typeof mocks & { insertBuilder: { payload?: unknown } }).insertBuilder.payload).toMatchObject({
      onchain_payment_id: "7",
      chain_id: 11142220,
      contract_address: CONTRACT,
      source_onchain_snapshot: expect.objectContaining({
        id: "7",
        client: CLIENT,
        worker: WORKER,
        amount: "1000000",
        token: TOKEN,
      }),
    });
  });

  it("fails a concurrent duplicate at the database boundary before transaction construction", async () => {
    const insertBuilder = (mocks as typeof mocks & { insertBuilder: { maybeSingle: ReturnType<typeof vi.fn> } }).insertBuilder;
    insertBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "idx_review_executions_payment_active" },
    });

    const result = await executeDisputeResolution(PAYMENT_IDENTIFIER, DECISION_ID);

    expect(result).toMatchObject({ success: false, errorCode: "ALREADY_EXECUTING" });
    expect((mocks as typeof mocks & { simulateContract: ReturnType<typeof vi.fn> }).simulateContract).not.toHaveBeenCalled();
  });
});
