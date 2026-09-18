// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// /receipts — settlement receipt index discovery tests
//
// Proves:
//   1. a completed Payment #1-compatible canonical receipt appears in the index
//   2. the empty state remains for wallets with no eligible receipts
//   3. the receipt link resolves to the canonical /receipts/[id] page
// Plus a read-only guarantee: only GETs to the canonical receipt API.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: () => mockWallet,
}));
vi.mock("@/hooks/contracts", () => ({
  useClientPaymentIds: () => mockClientIds,
  useWorkerPaymentIds: () => mockWorkerIds,
}));
vi.mock("@/components/ui/Button", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("@/components/ui/Notice", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/StatusBadge", () => ({
  default: ({ label }: { label: string }) => <span>{label}</span>,
}));

import ReceiptsPage from "../page";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const RELEASE_TX = "0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298";
const X402_TX = "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351";

const RECEIPT = {
  schemaVersion: "reclaim-final-receipt-v1",
  productModel:
    "The contract protects the payment. The agent prepares the resolution. People make the final decision.",
  protectedPayment: {
    paymentId: "1",
    amountAtomic: "10000",
    amountHuman: "0.01 USDC",
    asset: "USDC",
    client: CLIENT,
    worker: WORKER,
    escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
    chainId: "eip155:11142220",
    network: "Celo Sepolia",
    finalState: "Released",
    releasedAt: "2026-08-09T11:49:09.000Z",
  },
  evidence: {
    title: "Controlled dispute test — completed work evidence",
    evidenceReference:
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
  },
  resolutionAgent: {
    agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    objective: "Prepare this payment case for fair human review.",
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    priceHuman: "$0.01 USDC",
    network: "Celo Mainnet",
    facilitatorUrl: "https://api.x402.celo.org",
    settlementTxHash: X402_TX,
  },
  humanDecision: {
    decision: "Approve release",
    authority: "client",
    txHash: RELEASE_TX,
    finalRecipient: WORKER,
    outcome: "Released",
  },
};

// --- Mutable mock state (reset per test) -----------------------------------

let mockWallet: {
  address: string | undefined;
  isConnected: boolean;
  shortAddress: string;
  connectionState: string;
  isConnecting: boolean;
  isReconnecting: boolean;
  chainId: number | undefined;
  chainSupported: boolean;
  disconnect: () => void;
};
let mockClientIds: {
  data: readonly bigint[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockWorkerIds: {
  data: readonly bigint[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};

function resetMocks() {
  mockWallet = {
    address: undefined,
    isConnected: false,
    shortAddress: "",
    connectionState: "disconnected",
    isConnecting: false,
    isReconnecting: false,
    chainId: undefined,
    chainSupported: false,
    disconnect: vi.fn(),
  };
  mockClientIds = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  mockWorkerIds = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}
resetMocks();

let root: Root | null = null;

function setupFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountIndex() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReceiptsPage />);
  });
  await act(async () => {});
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetMocks();
});

describe("/receipts (index discovery)", () => {
  it("shows the completed Payment #1 canonical receipt for its client", async () => {
    mockWallet = {
      ...mockWallet,
      address: CLIENT,
      isConnected: true,
      connectionState: "connected",
    };
    mockClientIds = { ...mockClientIds, data: [1n] };
    mockWorkerIds = { ...mockWorkerIds, data: [] };
    const fetchMock = setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });

    await mountIndex();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Payment #1");
    expect(text).toContain("0.01 USDC");
    expect(text).toContain("Client");
    expect(text).toContain("Released");

    // Only the canonical receipt API was called, via GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/payments/1/receipt");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("shows the completed Payment #1 canonical receipt for its worker", async () => {
    mockWallet = {
      ...mockWallet,
      address: WORKER,
      isConnected: true,
      connectionState: "connected",
    };
    mockClientIds = { ...mockClientIds, data: [] };
    mockWorkerIds = { ...mockWorkerIds, data: [1n] };
    setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });

    await mountIndex();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Payment #1");
    expect(text).toContain("Worker");
  });

  it("keeps the empty state for a connected wallet with no on-chain payments", async () => {
    mockWallet = {
      ...mockWallet,
      address: "0x1111111111111111111111111111111111111111",
      isConnected: true,
      connectionState: "connected",
    };
    mockClientIds = { ...mockClientIds, data: [] };
    mockWorkerIds = { ...mockWorkerIds, data: [] };

    await mountIndex();

    const text = document.body.textContent ?? "";
     expect(text).toContain("No payment receipts yet.");
     expect(text).toContain("Receipts appear when a protected payment can be verified on-chain.");
   });

  it("lists a non-terminal payment with its current escrow state", async () => {
    mockWallet = {
      ...mockWallet,
      address: CLIENT,
      isConnected: true,
      connectionState: "connected",
    };
     // Payment #1 exists but is not released; it still has a canonical
     // read-only receipt so the user can see the current state.
    mockClientIds = { ...mockClientIds, data: [1n] };
    mockWorkerIds = { ...mockWorkerIds, data: [] };
    setupFetch({
      found: true,
      paymentId: "1",
      receipt: { ...RECEIPT, protectedPayment: { ...RECEIPT.protectedPayment, finalState: "Funded" } },
    });

     await mountIndex();

     const text = document.body.textContent ?? "";
     expect(text).toContain("Payment #1");
     expect(text).toContain("Funded");
   });

  it("renders the receipt card as a link to the canonical /receipts/[id] page", async () => {
    mockWallet = {
      ...mockWallet,
      address: CLIENT,
      isConnected: true,
      connectionState: "connected",
    };
    mockClientIds = { ...mockClientIds, data: [1n] };
    mockWorkerIds = { ...mockWorkerIds, data: [] };
    setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });

    await mountIndex();

    const link = document.querySelector<HTMLAnchorElement>('a[href="/receipts/1"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Payment #1");
    expect(link?.textContent).toContain("0.01 USDC");
  });
});
