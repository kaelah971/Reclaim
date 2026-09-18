// @vitest-environment node
// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/receipt — canonical final receipt
//
// Read-only: composed from durable on-chain proofs, verified evidence
// metadata and the durable review packet. No mutation, no signing.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const proofReaderMock = vi.hoisted(() => ({
  readFinalProof: vi.fn(),
}));
const storeMock = vi.hoisted(() => ({
  getAgentByCaseIdentity: vi.fn(),
  listToolExecutions: vi.fn(),
}));
const evidenceReaderMock = vi.hoisted(() => ({
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
    readFinalProof = proofReaderMock.readFinalProof;
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
    getEvidenceMetadata = evidenceReaderMock.getEvidenceMetadata;
  },
}));
vi.mock("@/lib/resolution-agent/api/escrow-reader", () => ({
  CeloSepoliaEscrowCaseReader: class {
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
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
const RELEASE_TX = "0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298";
const X402_TX = "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351";

const PROOF = {
  paymentId: "1",
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
    txHash: RELEASE_TX,
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

const PACKET = {
  schemaVersion: "reclaim-review-packet-v1",
  evidence: {
    caseVersionHash: "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
    evidenceVersionHash: "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    executionRequestHash: "0x8a26b7131c30af20a6210b78cc00f250f20341ed80feb7219e48b36303c83015",
    readiness: "needs_improvement",
    missingEvidence: [],
    ambiguities: ["Unverified submitter — evidence could be from an unknown third party."],
    reviewerQuestions: [
      "Reviewer question: No pasted text content — evidence may lack substance.",
    ],
    recommendedImprovements: ["Paste relevant message logs, terms, or documentation."],
    settlementTxHash: X402_TX,
    paymentReference: X402_TX,
    resultReference: "0xadca01fdcc736941cdfb99b4b781ae51af21bae7d2fadc8f2ff334492e232ac3",
  },
  qcInconsistency: [
    "QC states there is no pasted text, but verified evidence contains pasted text.",
  ],
};

const FACTS = {
  title: "Controlled dispute test — completed work evidence",
  evidenceType: "other",
  description: "Evidence showing the completed work for Payment #1.",
  relatedDeliverable: null,
  externalReference: "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
  fileCount: 0,
  latestUpdateTimestamp: new Date("2026-08-09T02:49:25.972Z").getTime(),
  substantiveEvidence: true,
  submitterAddress: "chain_verified",
  relatedClaim: "Completed work for the controlled dispute test",
  pastedText: "I completed the agreed controlled dispute test deliverable.",
  evidenceDate: "2026-08-08",
  externalRef: null,
  fileHash: null,
};

function makeQueryChain() {
  const limit = vi.fn(() => ({ data: [], error: null }));
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => ({ limit })),
    limit,
  };
  supabaseMock.from.mockReturnValue(builder);
  return builder;
}

describe("GET /api/payments/[paymentId]/receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proofReaderMock.readFinalProof.mockResolvedValue(PROOF);
    storeMock.getAgentByCaseIdentity.mockResolvedValue({
      id: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
      goal: "Prepare this payment case for fair human review.",
    });
    storeMock.listToolExecutions.mockResolvedValue([
      {
        tool_identifier: "evidence-quality-check",
        state: "settled",
        price_atomic: 10000,
        case_version_hash: "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
        evidence_version_hash: "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
        payment_reference: X402_TX,
        settlement_tx_hash: X402_TX,
        result_reference: "0xadca01fdcc736941cdfb99b4b781ae51af21bae7d2fadc8f2ff334492e232ac3",
      },
    ]);
    evidenceReaderMock.getEvidenceMetadata.mockResolvedValue(FACTS);
    mainnetClientMock.getTransactionReceipt.mockResolvedValue({ blockNumber: 74360582n });
    mainnetClientMock.getBlock.mockResolvedValue({
      timestamp: BigInt(Math.floor(new Date("2026-08-09T07:42:20Z").getTime() / 1000)),
    });
  });

  it("returns the canonical read-only receipt for the released payment", async () => {
    makeQueryChain();
    const { limit } = supabaseMock.from().order("created_at", { ascending: false });
    limit.mockResolvedValueOnce({
      data: [{ id: "evt-1", created_at: "2026-08-09T09:25:44Z", metadata: PACKET }],
      error: null,
    });

    const req = new NextRequest("http://localhost/api/payments/1/receipt");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.receipt.schemaVersion).toBe("reclaim-final-receipt-v1");

    // Protected payment
    expect(body.receipt.protectedPayment.paymentId).toBe("1");
    expect(body.receipt.protectedPayment.amountHuman).toBe("0.01 USDC");
    expect(body.receipt.protectedPayment.finalState).toBe("Released");
    expect(body.receipt.protectedPayment.client).toBe(CLIENT);
    expect(body.receipt.protectedPayment.worker).toBe(WORKER);

    // Evidence + provenance
    expect(body.receipt.evidence.evidenceReference).toBe(
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    );
    expect(body.receipt.evidence.availability).toBe("package_available");
    expect(body.receipt.evidence.submissionTxHash).toBe(
      "0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
    );

    // Agent + QC (real x402 provenance)
    expect(body.receipt.resolutionAgent.agentId).toBe("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(body.receipt.resolutionAgent.statement).toBe(
      "The agent prepared the case. A person made the final decision.",
    );
    expect(body.receipt.qualityCheck.toolId).toBe("evidence-quality-check");
    expect(body.receipt.qualityCheck.priceHuman).toBe("$0.01 USDC");
    expect(body.receipt.qualityCheck.network).toBe("Celo Mainnet");
    expect(body.receipt.qualityCheck.facilitatorUrl).toBe("https://api.x402.celo.org");
    expect(body.receipt.qualityCheck.settlementTxHash).toBe(X402_TX);
    // P4.3D: public receipt is hash-only — QC free text (which may quote
    // worker content) is redacted. Party plaintext reads use the
    // wallet-challenge .../evidence/plaintext endpoint.
    expect(body.receipt.qualityCheck.inconsistencies).toEqual([]);
    expect(body.receipt.qualityCheck.reviewerQuestions).toEqual([]);
    expect(body.receipt.qualityCheck.ambiguities).toEqual([]);
    expect(body.receipt.qualityCheck.recommendedImprovements).toEqual([]);
    // Plaintext delivery evidence is redacted from the public receipt.
    expect(body.receipt.evidence.title).toBeNull();
    expect(body.receipt.evidence.claim).toBeNull();
    expect(body.receipt.evidence.pastedText).toBeNull();
    expect(body.receipt.evidence.date).toBeNull();

    // Human decision attribution (sender == client)
    expect(body.receipt.humanDecision.decision).toBe("Approve release");
    expect(body.receipt.humanDecision.authority).toBe("client");
    expect(body.receipt.humanDecision.txHash).toBe(RELEASE_TX);
    expect(body.receipt.humanDecision.finalRecipient).toBe(WORKER);
    expect(body.receipt.humanDecision.outcome).toBe("Released");

    // Audit: explorer links for Sepolia + Mainnet, hashes, timestamps
    expect(body.receipt.audit.explorerLinks.releaseTransaction).toContain(
      `tx/${RELEASE_TX}`,
    );
    expect(body.receipt.audit.explorerLinks.x402SettlementTransaction).toContain(
      "celoscan.io/tx/",
    );
    expect(body.receipt.resolutionAgent.caseVersionHash).toBe(
      "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
    );
    expect(body.receipt.resolutionAgent.evidenceVersionHash).toBe(
      "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
    );
    expect(body.receipt.audit.timestamps.qcSettlementAt).toBe("2026-08-09T07:42:20.000Z");
  });

  it("returns found:false when the payment does not exist on-chain", async () => {
    proofReaderMock.readFinalProof.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/payments/99/receipt");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "99" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
  });

  it("uses durable execution settlement proof instead of packet-provided tx metadata", async () => {
    const { limit } = makeQueryChain().order() as { limit: ReturnType<typeof vi.fn> };
    limit.mockResolvedValueOnce({
      data: [{
        id: "evt-1",
        created_at: "2026-08-09T09:25:44Z",
        metadata: {
          ...PACKET,
          qualityCheck: {
            ...PACKET.qualityCheck,
            settlementTxHash: "0xpacket-only-value",
          },
        },
      }],
      error: null,
    });

    const req = new NextRequest("http://localhost/api/payments/1/receipt");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "1" }) });
    const body = await res.json();

    expect(body.receipt.qualityCheck.settlementTxHash).toBe(X402_TX);
    expect(body.receipt.qualityCheck.paymentReference).toBe(X402_TX);
  });

  it("works without an agent/packet — null fields, no fabrication", async () => {
    makeQueryChain(); // no packet events
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    storeMock.listToolExecutions.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/payments/1/receipt");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "1" }) });
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.receipt.resolutionAgent.agentId).toBeNull();
    expect(body.receipt.qualityCheck.settlementTxHash).toBeNull();
    expect(body.receipt.qualityCheck.inconsistencies).toEqual([]);
    // Human decision still comes from the on-chain release proof.
    expect(body.receipt.humanDecision.txHash).toBe(RELEASE_TX);
  });

  it("rejects a malformed payment id", async () => {
    const req = new NextRequest("http://localhost/api/payments/abc/receipt");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "abc" }) });
    expect(res.status).toBe(400);
  });
});
