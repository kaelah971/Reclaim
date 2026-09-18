// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.3D public redaction — receipt + review-packet expose hash/safe fields
// ONLY. Plaintext (title/claim/pasted text/date/refs) and QC free text that
// may quote worker content are redacted. Mocks only, no real RPC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { GET as GET_RECEIPT } from "../[paymentId]/receipt/route";
import { GET as GET_PACKET } from "../[paymentId]/review-packet/route";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function makeQueryChain(packet: unknown) {
  const limit = vi.fn(async () => ({
    data: packet ? [{ id: "evt-1", created_at: "2026-09-18T00:00:00Z", metadata: packet }] : [],
    error: null,
  }));
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => ({ limit })),
    limit,
  };
  supabaseMock.from.mockReturnValue(builder);
}

describe("public receipt redaction (P4.3D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proofReaderMock.readFinalProof.mockResolvedValue({
      paymentId: "7",
      state: {
        state: "5",
        stateLabel: "released",
        client: CLIENT,
        worker: WORKER,
        token: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
        amount: "10000",
        evidenceReference: "0xabc",
        disputeReference: "0x0000000000000000000000000000000000000000000000000000000000000000",
        deliveryAt: "2026-09-18T00:00:00.000Z",
        releaseRequestedAt: null,
        releasedAt: "2026-09-18T01:00:00.000Z",
      },
      release: { txHash: "0xrel", status: "success", sender: CLIENT.toLowerCase(), blockNumber: "1", blockTime: "2026-09-18T01:00:00.000Z" },
      evidenceSubmission: { txHash: "0xevtx", blockNumber: "1", blockTime: "2026-09-18T00:00:00.000Z" },
    });
    storeMock.getAgentByCaseIdentity.mockResolvedValue({ id: "agt-1", goal: "goal" });
    storeMock.listToolExecutions.mockResolvedValue([]);
    evidenceReaderMock.getEvidenceMetadata.mockResolvedValue({
      title: "Secret title",
      relatedClaim: "Secret claim",
      pastedText: "Secret pasted text",
      evidenceDate: "2026-09-01",
      evidenceType: "other",
      substantiveEvidence: true,
      latestUpdateTimestamp: new Date("2026-09-18T00:00:00Z").getTime(),
      submitterAddress: "chain_verified",
    });
    mainnetClientMock.getTransactionReceipt.mockResolvedValue({ blockNumber: 1n });
    mainnetClientMock.getBlock.mockResolvedValue({ timestamp: 1n });
  });

  it("omits ALL plaintext evidence but keeps hash/safe fields", async () => {
    makeQueryChain({
      evidence: { caseVersionHash: "0xcase", evidenceVersionHash: "0xev" },
      qualityCheck: {
        toolId: "evidence-quality-check",
        executionRequestHash: "0xreq",
        readiness: "needs_improvement",
        reviewerQuestions: ["Q quoting worker secret"],
        ambiguities: ["Ambiguity quoting secret"],
        recommendedImprovements: ["Improve secret"],
      },
      qcInconsistency: ["QC states no pasted text, but verified evidence contains pasted text."],
    });
    const res = await GET_RECEIPT(new NextRequest("http://localhost/api/payments/7/receipt"), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ev = body.receipt.evidence;
    expect(ev.title).toBeNull();
    expect(ev.claim).toBeNull();
    expect(ev.date).toBeNull();
    expect(ev.pastedText).toBeNull();
    // Hash + safe fields still present.
    expect(ev.evidenceReference).toBe("0xabc");
    expect(ev.availability).toBe("package_available");
    expect(ev.submissionTxHash).toBe("0xevtx");
    expect(ev.submittedAt).toBeTruthy();
    const qc = body.receipt.qualityCheck;
    expect(qc.readiness).toBe("needs_improvement");
    expect(qc.reviewerQuestions).toEqual([]);
    expect(qc.ambiguities).toEqual([]);
    expect(qc.recommendedImprovements).toEqual([]);
    expect(qc.inconsistencies).toEqual([]);
    // Safe public receipt data still functions.
    expect(body.receipt.protectedPayment.client).toBe(CLIENT);
    expect(body.receipt.humanDecision.txHash).toBe("0xrel");
  });
});

describe("public review-packet redaction (P4.3D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getAgentByCaseIdentity.mockResolvedValue({ id: "agt-1" });
  });

  it("omits ALL plaintext evidence + QC free text, keeps hashes", async () => {
    makeQueryChain({
      schemaVersion: "reclaim-review-packet-v1",
      case: { escrowPaymentId: "7" },
      evidence: {
        evidenceReference: "0xabc",
        title: "Secret",
        relatedClaim: "Secret claim",
        pastedText: "Secret text",
        evidenceDate: "2026-09-01",
        externalRef: "https://private.example",
        fileHash: "0xfile",
        fileCount: 1,
        availability: "package_available",
        caseVersionHash: "0xcase",
        evidenceVersionHash: "0xev",
      },
      qualityCheck: {
        toolId: "evidence-quality-check",
        readiness: "needs_improvement",
        reviewerQuestions: ["Q secret"],
        ambiguities: ["A secret"],
        recommendedImprovements: ["I secret"],
      },
      qcInconsistency: ["leak"],
    });
    const res = await GET_PACKET(new NextRequest("http://localhost/api/payments/7/review-packet"), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    const ev = body.packet.evidence;
    expect(ev.title).toBeNull();
    expect(ev.relatedClaim).toBeNull();
    expect(ev.pastedText).toBeNull();
    expect(ev.evidenceDate).toBeNull();
    expect(ev.externalRef).toBeNull();
    expect(ev.evidenceReference).toBe("0xabc");
    expect(ev.fileHash).toBe("0xfile");
    const qc = body.packet.qualityCheck;
    expect(qc.readiness).toBe("needs_improvement");
    expect(qc.reviewerQuestions).toEqual([]);
    expect(qc.ambiguities).toEqual([]);
    expect(body.packet.qcInconsistency).toEqual([]);
  });
});
