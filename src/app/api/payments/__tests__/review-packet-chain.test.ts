// @vitest-environment node
// ---------------------------------------------------------------------------
// P4.1b GET review-packet — chain param threading (mocked reads).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const storeMock = vi.hoisted(() => ({
  getAgentByCaseIdentity: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));
const escrowMock = vi.hoisted(() => ({
  sepoliaCtor: vi.fn(),
  mainnetCtor: vi.fn(),
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

import { GET } from "../[paymentId]/review-packet/route";

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

describe("GET review-packet chain threading (P4.1b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeQueryChain();
    storeMock.getAgentByCaseIdentity.mockResolvedValue(null);
  });

  it("defaults to Sepolia (behavior unchanged)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/payments/7/review-packet"), {
      params: Promise.resolve({ paymentId: "7" }),
    });
    expect(res.status).toBe(200);
    expect(escrowMock.sepoliaCtor).toHaveBeenCalled();
    expect(escrowMock.mainnetCtor).not.toHaveBeenCalled();
    expect(storeMock.getAgentByCaseIdentity).toHaveBeenCalledWith(
      "11142220",
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      "7",
    );
  });

  it("threads chainId=42220 to the Mainnet escrow identity", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/payments/7/review-packet?chainId=42220"),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(200);
    expect(escrowMock.mainnetCtor).toHaveBeenCalled();
    expect(storeMock.getAgentByCaseIdentity).toHaveBeenCalledWith(
      "42220",
      "0xE42cF4620DE454bE0De5004255d25683e4F882c4",
      "7",
    );
  });

  it("rejects unsupported chains", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/payments/7/review-packet?chainId=99999"),
      { params: Promise.resolve({ paymentId: "7" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNSUPPORTED_CHAIN");
  });
});
