// ---------------------------------------------------------------------------
// Receipt state mapping tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const proofReaderMock = vi.hoisted(() => ({ readFinalProof: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getAgentByCaseIdentity: vi.fn(),
  listToolExecutions: vi.fn(),
}));
const evidenceReaderMock = vi.hoisted(() => ({ getEvidenceMetadata: vi.fn() }));
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));
const mainnetClientMock = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("@/lib/evidence/chainProvenance", () => ({
  CeloSepoliaChainFinalProofReader: class {
    network = "Celo Sepolia";
    readFinalProof = proofReaderMock.readFinalProof;
  },
}));
vi.mock("@/lib/resolution-agent/store/supabase", () => ({
  SupabaseResolutionAgentStore: class {
    getAgentByCaseIdentity = storeMock.getAgentByCaseIdentity;
    listToolExecutions = storeMock.listToolExecutions;
  },
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => supabaseMock }));
vi.mock("@/lib/evidence/reader", () => ({
  SupabaseEvidenceReader: class {
    getEvidenceMetadata = evidenceReaderMock.getEvidenceMetadata;
  },
}));
vi.mock("@/lib/resolution-agent/api/escrow-reader", () => ({
  CeloSepoliaEscrowCaseReader: class {
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
  },
}));
vi.mock("viem", () => ({ createPublicClient: () => mainnetClientMock, http: () => vi.fn() }));
vi.mock("viem/chains", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, celo: { id: 42220 } };
});

import { GET } from "@/app/api/payments/[paymentId]/receipt/route";

const BASE_STATE = {
  state: "8",
  stateLabel: "resolved",
  client: "0x0000000000000000000000000000000000000001",
  worker: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003",
  amount: "10000",
  evidenceReference: "0x" + "00".repeat(32),
  disputeReference: "0x" + "00".repeat(32),
  deliveryAt: null,
  releaseRequestedAt: null,
  releasedAt: "2026-08-09T11:49:09.000Z",
  agreementLabel: null,
  deliverableSummary: null,
  deliveryFormat: null,
  releaseRule: null,
  evidenceExpectation: null,
  deliveryDeadline: null,
  autoReleaseSeconds: null,
  disputeWindowSeconds: null,
  createdAt: null,
};

type StateOverrides = Partial<Omit<typeof BASE_STATE, "releasedAt">> & {
  releasedAt?: string | null;
};

function proofFor(state: StateOverrides) {
  return {
    paymentId: "1",
    state: { ...BASE_STATE, ...state },
    release: { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null },
    evidenceSubmission: { txHash: null, blockNumber: null, blockTime: null },
    dispute: { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null, disputeReference: null },
    resolution: { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null, clientAmount: null, workerAmount: null },
    cancellation: { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null },
  };
}

function makeQueryChain() {
  const limit = vi.fn().mockResolvedValue({ data: [], error: null });
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => ({ limit })),
    limit,
  };
  supabaseMock.from.mockReturnValue(builder);
  return builder;
}

describe("GET receipt escrow state categories", () => {
  it("reports a full client refund as Resolved with a refunded financial outcome", async () => {
    makeQueryChain();
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    evidenceReaderMock.getEvidenceMetadata.mockResolvedValue({ substantiveEvidence: false });
    proofReaderMock.readFinalProof.mockResolvedValue({
      ...proofFor({}),
      resolution: {
        txHash: "0xresolution",
        status: "success",
        sender: "0x0000000000000000000000000000000000000003",
        blockNumber: "10",
        blockTime: "2026-08-09T11:49:09.000Z",
        clientAmount: "10000",
        workerAmount: "0",
      },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/payments/1/receipt"),
      { params: Promise.resolve({ paymentId: "1" }) },
    );
    const body = await response.json();

    expect(body.receipt.protectedPayment.finalState).toBe("Resolved");
    expect(body.receipt.protectedPayment.financialOutcome).toBe("Refunded to client");
    expect(body.receipt.protectedPayment.releasedAt).toBeNull();
    expect(body.receipt.humanDecision.decision).toBe("Resolve dispute");
    expect(body.receipt.humanDecision.clientAmount).toBe("10000");
    expect(body.receipt.audit.explorerLinks.resolutionTransaction).toContain("/tx/0xresolution");
  });

  it("reports a non-terminal payment as pending without a final decision", async () => {
    makeQueryChain();
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    evidenceReaderMock.getEvidenceMetadata.mockResolvedValue({ substantiveEvidence: false });
    proofReaderMock.readFinalProof.mockResolvedValue(
      proofFor({ state: "1", stateLabel: "funded", releasedAt: null }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/payments/1/receipt"),
      { params: Promise.resolve({ paymentId: "1" }) },
    );
    const body = await response.json();

    expect(body.receipt.protectedPayment.finalState).toBe("Funded");
    expect(body.receipt.protectedPayment.financialOutcome).toBe("Pending");
    expect(body.receipt.humanDecision.decision).toBeNull();
    expect(body.receipt.humanDecision.txHash).toBeNull();
  });
});
