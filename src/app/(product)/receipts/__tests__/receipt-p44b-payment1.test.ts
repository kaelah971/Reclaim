// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.4b Payment #1 readiness — READ-ONLY validation (mocks only).
//
// Proves the room+receipt architecture renders the real Mainnet Payment #1
// shape (Released, 50000 base units = 0.05 USA₮, canonical Mainnet escrow,
// chain 42220) via MOCKED chain reads matching the verified on-chain record.
// No chain transactions, no deploys, no DB writes.
//
// Payment #1 constants live ONLY in this test fixture — product code must
// NOT contain them (asserted at the bottom by scanning the owned product
// files for the canonical escrow + evidence hash markers).
//
// Also asserts public sanitization on Mainnet + Sepolia (plaintext nulls,
// QC []), with safe fields present (hash, parties, amount, tx, state).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

import { GET } from "../../../api/payments/[paymentId]/receipt/route";

// --- Verified Mainnet Payment #1 record (test fixture ONLY) ----------------
// Matches docs/mainnet-usat-e2e.md: Payment #1, Released, 50000 base units
// (0.05 USA₮, 6 decimals), canonical Mainnet escrow, chain 42220.
const PAYMENT1_CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const PAYMENT1_WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const PAYMENT1_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const PAYMENT1_EVIDENCE_HASH =
  "0x685444d11f6b1518db6d76e7aaab56ebf85b1d0ee3cfdd911f6d4cf6f57644d3";
const PAYMENT1_RELEASE_TX =
  "0x225bfccf2d0f248582ae62d966d0de4681340698446889135facb0968b44656f";
const PAYMENT1_EVIDENCE_TX =
  "0x559d3e2ffb89c032a54b150fef7319c136c45ff7c5952e36ba18dc3fd7c602a0";

function payment1Proof() {
  return {
    paymentId: "1",
    state: {
      state: "5",
      stateLabel: "released",
      client: PAYMENT1_CLIENT,
      worker: PAYMENT1_WORKER,
      token: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
      amount: "50000",
      evidenceReference: PAYMENT1_EVIDENCE_HASH,
      disputeReference:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      deliveryAt: "2026-09-01T00:00:00.000Z",
      releaseRequestedAt: "2026-09-01T00:00:00.000Z",
      releasedAt: "2026-09-01T01:00:00.000Z",
      agreementLabel: null,
      deliverableSummary: null,
      deliveryFormat: null,
      releaseRule: null,
      evidenceExpectation: null,
      deliveryDeadline: null,
      autoReleaseSeconds: null,
      disputeWindowSeconds: "259200",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    release: {
      txHash: PAYMENT1_RELEASE_TX,
      status: "success",
      sender: PAYMENT1_CLIENT.toLowerCase(),
      blockNumber: "77810960",
      blockTime: "2026-09-01T01:00:00.000Z",
    },
    evidenceSubmission: {
      txHash: PAYMENT1_EVIDENCE_TX,
      blockNumber: "77810955",
      blockTime: "2026-09-01T00:00:00.000Z",
    },
    dispute: {
      txHash: null,
      status: null,
      sender: null,
      blockNumber: null,
      blockTime: null,
      disputeReference: null,
    },
    resolution: {
      txHash: null,
      status: null,
      sender: null,
      blockNumber: null,
      blockTime: null,
      clientAmount: null,
      workerAmount: null,
    },
    cancellation: {
      txHash: null,
      status: null,
      sender: null,
      blockNumber: null,
      blockTime: null,
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

describe("P4.4b Payment #1 Mainnet readiness (mocked chain reads only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeQueryChain();
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    storeMock.listToolExecutions.mockResolvedValue([]);
    mainnetClientMock.getTransactionReceipt.mockResolvedValue({ blockNumber: 1n });
    mainnetClientMock.getBlock.mockResolvedValue({ timestamp: 1n });
  });

  it("renders real Mainnet Payment #1 as Released with 50000 → 0.05, sanitized", async () => {
    proofMock.mainnetReadFinalProof.mockResolvedValue(payment1Proof());
    // Durable facts contain plaintext — the public receipt must drop it.
    evidenceMock.getEvidenceMetadata.mockResolvedValue({
      title: "should be redacted",
      relatedClaim: "should be redacted",
      evidenceDate: "2026-08-08",
      pastedText: "should be redacted",
      evidenceReference: PAYMENT1_EVIDENCE_HASH,
      substantiveEvidence: true,
      evidenceType: "other",
      latestUpdateTimestamp: new Date("2026-09-01T00:00:00.000Z").getTime(),
      submitterAddress: "chain_verified",
    });

    const res = await GET(
      new NextRequest("http://localhost/api/payments/1/receipt?chainId=42220"),
      { params: Promise.resolve({ paymentId: "1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);

    const pp = body.receipt.protectedPayment;
    // Real Payment #1 shape.
    expect(pp.paymentId).toBe("1");
    expect(pp.amountAtomic).toBe("50000");
    // 50000 base units at 6 decimals = 0.05 (technical symbol USAT;
    // product UI displays USA₮ — asserted in the jsdom chain test).
    expect(pp.amountHuman).toBe("0.05 USAT");
    expect(pp.chainId).toBe("eip155:42220");
    expect(pp.network).toBe("Celo Mainnet");
    expect(pp.escrowContractAddress).toBe(PAYMENT1_ESCROW);
    expect(pp.client).toBe(PAYMENT1_CLIENT);
    expect(pp.worker).toBe(PAYMENT1_WORKER);
    expect(pp.finalState).toBe("Released");

    // Safe fields present.
    const ev = body.receipt.evidence;
    expect(ev.evidenceReference).toBe(PAYMENT1_EVIDENCE_HASH);
    expect(ev.availability).toBe("package_available");
    expect(ev.submissionTxHash).toBe(PAYMENT1_EVIDENCE_TX);
    const hd = body.receipt.humanDecision;
    expect(hd.txHash).toBe(PAYMENT1_RELEASE_TX);
    expect(hd.authority).toBe("client");
    expect(hd.finalRecipient).toBe(PAYMENT1_WORKER);
    expect(body.receipt.audit.explorerLinks.releaseTransaction).toContain(
      `celoscan.io/tx/${PAYMENT1_RELEASE_TX}`,
    );
    expect(body.receipt.audit.explorerLinks.escrowContract).toContain("celoscan.io");

    // PUBLIC redaction on Mainnet: plaintext nulls, QC [].
    expect(ev.title).toBeNull();
    expect(ev.claim).toBeNull();
    expect(ev.date).toBeNull();
    expect(ev.pastedText).toBeNull();
    expect(body.receipt.qualityCheck.reviewerQuestions).toEqual([]);
    expect(body.receipt.qualityCheck.ambiguities).toEqual([]);
    expect(body.receipt.qualityCheck.recommendedImprovements).toEqual([]);
    expect(body.receipt.qualityCheck.inconsistencies).toEqual([]);

    // Chain plumbing: Mainnet readers bound to the canonical escrow.
    expect(proofMock.mainnetCtor).toHaveBeenCalled();
    expect(evidenceMock.getEvidenceMetadata).toHaveBeenCalledWith("1", "42220");
    expect(storeMock.getAgentByCaseIdentity).toHaveBeenCalledWith(
      "42220",
      PAYMENT1_ESCROW,
      "1",
    );
  });

  it("Sepolia stays sanitized with safe fields (regression)", async () => {
    proofMock.sepoliaReadFinalProof.mockResolvedValue({
      ...payment1Proof(),
      paymentId: "7",
      state: {
        ...payment1Proof().state,
        amount: "10000",
        evidenceReference:
          "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
      },
    });
    evidenceMock.getEvidenceMetadata.mockResolvedValue({
      title: "should be redacted",
      relatedClaim: "should be redacted",
      evidenceDate: "2026-08-08",
      pastedText: "should be redacted",
      evidenceReference: null,
      substantiveEvidence: true,
      evidenceType: "other",
      latestUpdateTimestamp: null,
      submitterAddress: null,
    });

    const res = await GET(new NextRequest("http://localhost/api/payments/7/receipt"), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.receipt.protectedPayment.chainId).toBe("eip155:11142220");
    expect(body.receipt.evidence.title).toBeNull();
    expect(body.receipt.evidence.claim).toBeNull();
    expect(body.receipt.evidence.pastedText).toBeNull();
    expect(body.receipt.evidence.date).toBeNull();
    expect(body.receipt.qualityCheck.inconsistencies).toEqual([]);
    expect(body.receipt.evidence.evidenceReference).toBe(
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    );
  });

  it("product code does not hardcode Payment #1 constants", () => {
    const root = process.cwd();
    const owned = [
      join(root, "src/app/(product)/receipts/page.tsx"),
      join(root, "src/app/(product)/receipts/[receiptId]/page.tsx"),
      join(root, "src/app/api/payments/[paymentId]/receipt/route.ts"),
    ];
    const haystack = owned.map((f) => readFileSync(f, "utf8")).join("\n");
    // Canonical Payment #1 markers must not appear in product code.
    expect(haystack).not.toContain("0xE42cF4620DE454bE0De5004255d25683e4F882c4");
    expect(haystack).not.toContain("0xe42cf4620de454be0de5004255d25683e4f882c4");
    expect(haystack).not.toContain(
      "0x685444d11f6b1518db6d76e7aaab56ebf85b1d0ee3cfdd911f6d4cf6f57644d3",
    );
    expect(haystack).not.toContain(
      "0x225bfccf2d0f248582ae62d966d0de4681340698446889135facb0968b44656f",
    );
    expect(haystack).not.toContain("50000");
  });
});
