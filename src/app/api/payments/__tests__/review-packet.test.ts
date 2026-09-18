// @vitest-environment node
// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/review-packet — real packet loading
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const storeMock = vi.hoisted(() => ({
  getAgentByCaseIdentity: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/resolution-agent/store/supabase", () => ({
  SupabaseResolutionAgentStore: class {
    getAgentByCaseIdentity = storeMock.getAgentByCaseIdentity;
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => supabaseMock,
}));
vi.mock("@/lib/resolution-agent/api/escrow-reader", () => ({
  CeloSepoliaEscrowCaseReader: class {
    chainId = 11142220;
    contractAddress = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
  },
}));

import { GET } from "../[paymentId]/review-packet/route";

const PACKET = {
  schemaVersion: "reclaim-review-packet-v1",
  case: { escrowPaymentId: "1", client: "0xClient", worker: "0xWorker" },
  evidence: { evidenceReference: "0x1bb11c9d…" },
  qualityCheck: { readiness: "needs_improvement", reviewerQuestions: ["Q1"] },
  decision: "NO DECISION MADE BY THE AGENT",
};

function makeQueryChain() {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
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

describe("GET /api/payments/[paymentId]/review-packet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the latest durable packet for the agent bound to the payment", async () => {
    storeMock.getAgentByCaseIdentity.mockResolvedValue({
      id: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    });
    makeQueryChain();
    const { limit } = supabaseMock.from().order("created_at", { ascending: false });
    limit.mockResolvedValueOnce({
      data: [
        {
          id: "437c351a-5875-4fc5-8574-dacca19595bb",
          created_at: "2026-08-09T08:23:12.789+00:00",
          metadata: PACKET,
        },
      ],
      error: null,
    });

    const req = new NextRequest("http://localhost/api/payments/1/review-packet");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.agentId).toBe("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(body.packetEventId).toBe("437c351a-5875-4fc5-8574-dacca19595bb");
    expect(body.packet.schemaVersion).toBe("reclaim-review-packet-v1");
    expect(body.packet.qualityCheck.readiness).toBe("needs_improvement");
    // P4.3D: public review-packet is hash-only — QC free text redacted.
    expect(body.packet.qualityCheck.reviewerQuestions).toEqual([]);
    // The agent lookup is bound by the canonical escrow identity (no role).
    expect(storeMock.getAgentByCaseIdentity).toHaveBeenCalledWith(
      "11142220",
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      "1",
    );
  });

  it("returns found:false when no agent exists for the payment", async () => {
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/payments/9/review-packet");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "9" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
  });

  it("returns found:false when the agent has no review packet event", async () => {
    storeMock.getAgentByCaseIdentity.mockResolvedValue({ id: "agt_x" });
    makeQueryChain(); // empty events
    const req = new NextRequest("http://localhost/api/payments/1/review-packet");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "1" }) });
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.agentId).toBe("agt_x");
  });

  it("rejects a malformed payment id", async () => {
    const req = new NextRequest("http://localhost/api/payments/abc/review-packet");
    const res = await GET(req, { params: Promise.resolve({ paymentId: "abc" }) });
    expect(res.status).toBe(400);
  });
});
