// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.1b GET receipt / review-packet — chain param threading (mocked reads).
//
// - Default (no chainId) preserves Sepolia behavior exactly.
// - ?chainId=42220 binds to the canonical Mainnet escrow + token + explorer.
// - Unsupported chains are rejected with UNSUPPORTED_CHAIN.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const proofMock = vi.hoisted(() => ({
  sepoliaReadFinalProof: vi.fn(),
  mainnetReadFinalProof: vi.fn(),
  sepoliaCtor: vi.fn(),
  mainnetCtor: vi.fn(),
}));
const escrowMock = vi.hoisted(() => ({
  sepoliaCtor: vi.fn(),
  mainnetCtor: vi.fn(),
}));
const storeMock = vi.hoisted(() => ({
  getAgentByCaseIdentity: vi.fn(),
  listToolExecutions: vi.fn(),
}));
const evidenceMock = vi.hoisted(() => ({
  getEvidenceMetadata: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));
const mainnetClientMock = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("@/lib/evidence/chainProvenance", () => ({
  CeloSepoliaChainFinalProofReader: class {
    network = "Celo Sepolia";
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
    constructor(...args: unknown[]) {
      proofMock.sepoliaCtor(...args);
    }
    readFinalProof = proofMock.sepoliaReadFinalProof;
  },
  CeloChainFinalProofReader: class {
    network = "Celo Mainnet";
    chainId = 42220;
    contractAddress = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
    constructor(...args: unknown[]) {
      proofMock.mainnetCtor(...args);
    }
    readFinalProof = proofMock.mainnetReadFinalProof;
  },
}));

vi.mock("@/lib/resolution-agent/api/escrow-reader", () => ({
  CeloSepoliaEscrowCaseReader: class {
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
    constructor(...args: unknown[]) {
      escrowMock.sepoliaCtor(...args);
    }
  },
  CeloEscrowCaseReader: class {
    chainId = 42220;
    contractAddress = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
    constructor(...args: unknown[]) {
      escrowMock.mainnetCtor(...args);
    }
  },
}));

vi.mock("@/lib/resolution-agent/store/supabase", () => ({
  SupabaseResolutionAgentStore: class {
    getAgentByCaseIdentity = storeMock.getAgentByCaseIdentity;
    listToolExecutions = storeMock.listToolExecutions;
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => supabaseMock,
}));
vi.mock("@/lib/evidence/reader", () => ({
  SupabaseEvidenceReader: class {
    getEvidenceMetadata = evidenceMock.getEvidenceMetadata;
  },
}));
vi.mock("viem", () => ({
  createPublicClient: () => mainnetClientMock,
  http: () => vi.fn(),
}));
vi.mock("viem/chains", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, celo: { id: 42220 } };
});

import { GET } from "../[paymentId]/receipt/route";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function baseProof() {
  return {
    paymentId: "7",
    state: {
      state: "5",
      stateLabel: "released",
      client: CLIENT,
      worker: WORKER,
      token: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
      amount: "10000",
      evidenceReference: "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
      disputeReference: "0x0000000000000000000000000000000000000000000000000000000000000000",
      deliveryAt: "2026-08-09T02:49:15.000Z",
      releaseRequestedAt: null,
      releasedAt: "2026-08-09T11:49:09.000Z",
    },
    release: {
      txHash: "0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298",
      status: "success",
      sender: CLIENT.toLowerCase(),
      blockNumber: "32992161",
      blockTime: "2026-08-09T11:49:09.000Z",
    },
    evidenceSubmission: {
      txHash: "0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
      blockNumber: "32959767",
      blockTime: "2026-08-09T02:49:15.000Z",
    },
  };
}

function makeQueryChain() {
  const limit = vi.fn(() => ({ data: [], error: null }));
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => ({ limit })),
    limit,
  };
  supabaseMock.from.mockReturnValue(builder);
}

describe("GET receipt chain threading (P4.1b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeQueryChain();
    proofMock.sepoliaReadFinalProof.mockResolvedValue(baseProof());
    proofMock.mainnetReadFinalProof.mockResolvedValue(baseProof());
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    storeMock.listToolExecutions.mockResolvedValue([]);
    evidenceMock.getEvidenceMetadata.mockResolvedValue({
      title: null,
      relatedClaim: null,
      evidenceDate: null,
      pastedText: null,
      evidenceReference: null,
      substantiveEvidence: false,
      evidenceType: null,
      latestUpdateTimestamp: null,
      submitterAddress: null,
    });
    mainnetClientMock.getTransactionReceipt.mockResolvedValue({ blockNumber: 1n });
    mainnetClientMock.getBlock.mockResolvedValue({ timestamp: 1n });
  });

  it("defaults to Sepolia (behavior unchanged)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/payments/7/receipt"), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(proofMock.sepoliaCtor).toHaveBeenCalled();
    expect(proofMock.mainnetCtor).not.toHaveBeenCalled();
    expect(escrowMock.sepoliaCtor).toHaveBeenCalled();
    // Evidence read is chain-scoped to Sepolia.
    expect(evidenceMock.getEvidenceMetadata).toHaveBeenCalledWith("7", "11142220");
    expect(body.receipt.protectedPayment.chainId).toBe("eip155:11142220");
    expect(body.receipt.protectedPayment.network).toBe("Celo Sepolia");
  });

  it("threads chainId=42220 to Mainnet readers + Mainnet explorer links", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/payments/7/receipt?chainId=42220"),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(proofMock.mainnetCtor).toHaveBeenCalled();
    expect(escrowMock.mainnetCtor).toHaveBeenCalled();
    expect(evidenceMock.getEvidenceMetadata).toHaveBeenCalledWith("7", "42220");
    expect(storeMock.getAgentByCaseIdentity).toHaveBeenCalledWith(
      "42220",
      "0xE42cF4620DE454bE0De5004255d25683e4F882c4",
      "7",
    );
    expect(body.receipt.protectedPayment.chainId).toBe("eip155:42220");
    expect(body.receipt.protectedPayment.network).toBe("Celo Mainnet");
    expect(body.receipt.protectedPayment.escrowContractAddress).toBe(
      "0xE42cF4620DE454bE0De5004255d25683e4F882c4",
    );
    expect(body.receipt.audit.explorerLinks.escrowContract).toContain("celoscan.io");
  });

  it("rejects unsupported chains", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/payments/7/receipt?chainId=1"),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
  });
});
