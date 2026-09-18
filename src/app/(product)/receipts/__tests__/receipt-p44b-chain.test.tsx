// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.4b receipts — chain-aware Mainnet + Sepolia (mocked reads only).
//
// Proves (no chain transactions, no DB writes):
//   - detail + listing fetch the canonical receipt with ?chainId= threading
//     (absent → Sepolia default URL byte-identical; explicit 42220 threads)
//   - unsupported/malformed ?chainId= fails closed (explicit notice, no fetch)
//   - explorer labels + token labels are chain-aware (USA₮ on Mainnet, USDC
//     on Sepolia; celoscan.io vs blockscout)
//   - PUBLIC receipt stays sanitized on BOTH chains (plaintext nulls, QC [])
//   - safe fields present on both chains (hash, parties, amount, tx, state)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const searchState = vi.hoisted(() => ({ query: "" }));
const walletState = vi.hoisted(() => ({
  address: undefined as string | undefined,
  isConnected: false,
}));
const contractCalls = vi.hoisted(() => ({
  clientChain: [] as unknown[],
  workerChain: [] as unknown[],
}));
const stableIds = vi.hoisted(() => ({
  one: [1n] as readonly bigint[],
  empty: [] as readonly bigint[],
}));

vi.mock("@/components/ui/Button", () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/Notice", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/LoadingSkeleton", () => ({
  default: () => <div>Loading…</div>,
}));
vi.mock("@/components/ui/StatusBadge", () => ({
  default: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ receiptId: "1" }),
  useSearchParams: () => new URLSearchParams(searchState.query),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: () => ({
    address: walletState.address,
    isConnected: walletState.isConnected,
    shortAddress: "",
    connectionState: walletState.isConnected ? "connected" : "disconnected",
    isConnecting: false,
    isReconnecting: false,
    chainId: undefined,
    chainSupported: false,
    disconnect: vi.fn(),
  }),
  shortenAddress: (a?: string) => a ?? "",
}));
vi.mock("@/hooks/contracts", () => ({
  useClientPaymentIds: (_address: unknown, chain: unknown) => {
    contractCalls.clientChain.push(chain);
    return {
      data: walletState.isConnected ? stableIds.one : stableIds.empty,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useWorkerPaymentIds: (_address: unknown, chain: unknown) => {
    contractCalls.workerChain.push(chain);
    return {
      data: stableIds.empty,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("wagmi", () => ({
  useSignMessage: () => ({
    signMessageAsync: async () => "0xsig",
  }),
}));

import ReceiptDetailPage from "../[receiptId]/page";
import ReceiptsPage from "../page";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const SEPOLIA_ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const RELEASE_SEPOLIA = "0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298";
const RELEASE_MAINNET = "0x225bfccf2d0f248582ae62d966d0de4681340698446889135facb0968b44656f";
const EVIDENCE_SUB_MAINNET = "0x559d3e2ffb89c032a54b150fef7319c136c45ff7c5952e36ba18dc3fd7c602a0";
const X402_TX = "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351";
const EVIDENCE_HASH_SEPOLIA =
  "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99";
const EVIDENCE_HASH_MAINNET =
  "0x685444d11f6b1518db6d76e7aaab56ebf85b1d0ee3cfdd911f6d4cf6f57644d3";

// Public sanitized Sepolia receipt: plaintext nulls, QC free-text [].
const SEPOLIA_RECEIPT = {
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
    escrowContractAddress: SEPOLIA_ESCROW,
    chainId: "eip155:11142220",
    network: "Celo Sepolia",
    finalState: "Released",
    releasedAt: "2026-08-09T11:49:09.000Z",
    escrowState: "5",
    financialOutcome: "Released to worker",
    resolvedAt: null,
  },
  agreement: {
    deliverable: "Completed work evidence for Payment #1",
    deliveryFormat: "package",
    releaseRule: "manual",
    evidenceExpectation: "Evidence required",
    deadline: "2026-08-10T00:00:00.000Z",
    autoReleaseSeconds: "2592000",
    disputeWindowSeconds: "604800",
  },
  evidence: {
    title: null,
    claim: null,
    date: null,
    pastedText: null,
    evidenceReference: EVIDENCE_HASH_SEPOLIA,
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-08-09T02:49:25.972Z",
    submitter: "chain_verified",
    submissionTxHash:
      "0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
  },
  resolutionAgent: {
    agentId: "agt_test",
    objective: "Prepare this payment case for fair human review.",
    statement: "The agent prepared the case. A person made the final decision.",
    caseVersionHash:
      "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
    evidenceVersionHash:
      "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    priceHuman: "$0.01 USDC",
    network: "Celo Mainnet",
    facilitatorUrl: "https://api.x402.celo.org",
    executionRequestHash:
      "0x8a26b7131c30af20a6210b78cc00f250f20341ed80feb7219e48b36303c83015",
    readiness: "needs_improvement",
    reviewerQuestions: [],
    ambiguities: [],
    recommendedImprovements: [],
    settlementTxHash: X402_TX,
    paymentReference: X402_TX,
    resultReference: "0xadca01fdcc736941cdfb99b4b781ae51af21bae7d2fadc8f2ff334492e232ac3",
    inconsistencies: [],
  },
  humanDecision: {
    decision: "Approve release",
    authority: "client",
    txHash: RELEASE_SEPOLIA,
    sender: CLIENT.toLowerCase(),
    blockNumber: "32992161",
    blockTime: "2026-08-09T11:49:09.000Z",
    status: "success",
    finalRecipient: WORKER,
    outcome: "Released",
    clientAmount: null,
    workerAmount: null,
    clientAmountHuman: null,
    workerAmountHuman: null,
  },
  audit: {
    explorerLinks: {
      escrowContract: `https://celo-sepolia.blockscout.com/address/${SEPOLIA_ESCROW}`,
      client: `https://celo-sepolia.blockscout.com/address/${CLIENT}`,
      worker: `https://celo-sepolia.blockscout.com/address/${WORKER}`,
      releaseTransaction: `https://celo-sepolia.blockscout.com/tx/${RELEASE_SEPOLIA}`,
      evidenceSubmissionTransaction:
        "https://celo-sepolia.blockscout.com/tx/0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
      x402SettlementTransaction: `https://celoscan.io/tx/${X402_TX}`,
      disputeTransaction: null,
      resolutionTransaction: null,
      cancellationTransaction: null,
    },
    timestamps: {
      evidenceSubmittedAt: "2026-08-09T02:49:25.972Z",
      releaseAt: "2026-08-09T11:49:09.000Z",
      qcSettlementAt: "2026-08-09T07:42:20.000Z",
      disputedAt: null,
      resolvedAt: null,
      cancelledAt: null,
    },
  },
};

// Public sanitized Mainnet receipt (Payment #1-compatible shape, API
// technical symbol USAT — UI must display USA₮).
const MAINNET_RECEIPT = {
  schemaVersion: "reclaim-final-receipt-v1",
  productModel:
    "The contract protects the payment. The agent prepares the resolution. People make the final decision.",
  protectedPayment: {
    paymentId: "1",
    amountAtomic: "50000",
    amountHuman: "0.05 USAT",
    asset: "USAT",
    client: CLIENT,
    worker: WORKER,
    escrowContractAddress: MAINNET_ESCROW,
    chainId: "eip155:42220",
    network: "Celo Mainnet",
    finalState: "Released",
    releasedAt: "2026-09-01T00:00:00.000Z",
    escrowState: "5",
    financialOutcome: "Released to worker",
    resolvedAt: null,
  },
  agreement: {
    deliverable: "Reclaim mainnet protected E2E",
    deliveryFormat: null,
    releaseRule: null,
    evidenceExpectation: null,
    deadline: null,
    autoReleaseSeconds: null,
    disputeWindowSeconds: "259200",
  },
  evidence: {
    title: null,
    claim: null,
    date: null,
    pastedText: null,
    evidenceReference: EVIDENCE_HASH_MAINNET,
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-09-01T00:00:00.000Z",
    submitter: "chain_verified",
    submissionTxHash: EVIDENCE_SUB_MAINNET,
  },
  resolutionAgent: {
    agentId: null,
    objective: null,
    statement: "The agent prepared the case. A person made the final decision.",
    caseVersionHash: null,
    evidenceVersionHash: null,
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    priceHuman: null,
    network: "Celo Mainnet",
    facilitatorUrl: "https://api.x402.celo.org",
    executionRequestHash: null,
    readiness: null,
    reviewerQuestions: [],
    ambiguities: [],
    recommendedImprovements: [],
    settlementTxHash: null,
    paymentReference: null,
    resultReference: null,
    inconsistencies: [],
  },
  humanDecision: {
    decision: "Approve release",
    authority: "client",
    txHash: RELEASE_MAINNET,
    sender: CLIENT.toLowerCase(),
    blockNumber: "77810960",
    blockTime: "2026-09-01T00:00:00.000Z",
    status: "success",
    finalRecipient: WORKER,
    outcome: "Released",
    clientAmount: null,
    workerAmount: null,
    clientAmountHuman: null,
    workerAmountHuman: null,
  },
  audit: {
    explorerLinks: {
      escrowContract: `https://celoscan.io/address/${MAINNET_ESCROW}`,
      client: `https://celoscan.io/address/${CLIENT}`,
      worker: `https://celoscan.io/address/${WORKER}`,
      releaseTransaction: `https://celoscan.io/tx/${RELEASE_MAINNET}`,
      evidenceSubmissionTransaction: `https://celoscan.io/tx/${EVIDENCE_SUB_MAINNET}`,
      x402SettlementTransaction: null,
      disputeTransaction: null,
      resolutionTransaction: null,
      cancellationTransaction: null,
    },
    timestamps: {
      evidenceSubmittedAt: "2026-09-01T00:00:00.000Z",
      releaseAt: "2026-09-01T00:00:00.000Z",
      qcSettlementAt: null,
      disputedAt: null,
      resolvedAt: null,
      cancelledAt: null,
    },
  },
};

let root: Root | null = null;

function stubReceiptFetch(receipt: unknown) {
  const fetchMock = vi.fn().mockImplementation((url: unknown) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ found: true, paymentId: "1", receipt }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mount(el: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
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
  searchState.query = "";
  walletState.address = undefined;
  walletState.isConnected = false;
  contractCalls.clientChain.length = 0;
  contractCalls.workerChain.length = 0;
});

describe("P4.4b receipt chain-awareness (mocked reads only)", () => {
  it("Sepolia default: fetches without ?chainId=, USDC labels, Sepolia explorers, sanitized public view", async () => {
    searchState.query = "";
    const fetchMock = stubReceiptFetch(SEPOLIA_RECEIPT);
    await mount(<ReceiptDetailPage />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/payments/1/receipt");

    const text = document.body.textContent ?? "";
    // Safe fields present.
    expect(text).toContain("Settlement receipt — Payment #1");
    expect(text).toContain("0.01");
    expect(text).toContain("USDC");
    expect(text).toContain(CLIENT);
    expect(text).toContain(WORKER);
    expect(text).toContain(EVIDENCE_HASH_SEPOLIA);
    expect(text).toContain(RELEASE_SEPOLIA);
    expect(text).toContain("Released");
    // Chain-aware explorer labels for the escrow chain.
    expect(text).toContain("Evidence submission (Celo Sepolia)");
    expect(text).toContain("Release transaction (Celo Sepolia)");
    expect(text).toContain("blockscout.com/tx/");
    // PUBLIC redaction: plaintext nulls render as em-dash, QC arrays empty.
    expect(text).not.toContain("I completed the agreed");
    expect(text).not.toContain("Reviewer question:");
    expect(text).not.toContain("Unverified submitter");
    // Signatures/challenges/nonces never exposed.
    expect(text).not.toMatch(/challengeId|signature|nonce/i);
  });

  it("Mainnet explicit: fetches ?chainId=42220, USA₮ labels, celoscan explorers, sanitized public view", async () => {
    searchState.query = "chainId=42220";
    const fetchMock = stubReceiptFetch(MAINNET_RECEIPT);
    await mount(<ReceiptDetailPage />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/payments/1/receipt?chainId=42220",
    );

    const text = document.body.textContent ?? "";
    // Safe fields present (50000 base units → 0.05, Mainnet escrow).
    expect(text).toContain("Settlement receipt — Payment #1");
    expect(text).toContain("0.05");
    expect(text).toContain("USA₮");
    expect(text).not.toContain("USAT");
    expect(text).toContain(CLIENT);
    expect(text).toContain(WORKER);
    expect(text).toContain(MAINNET_ESCROW);
    expect(text).toContain(EVIDENCE_HASH_MAINNET);
    expect(text).toContain(RELEASE_MAINNET);
    expect(text).toContain("Released");
    expect(text).toContain("Celo Mainnet");
    // Chain-aware explorer labels + links.
    expect(text).toContain("Evidence submission (Celo Mainnet)");
    expect(text).toContain("Release transaction (Celo Mainnet)");
    expect(text).toContain("celoscan.io/tx/");
    expect(text).not.toContain("blockscout.com/tx/");
    // PUBLIC redaction on Mainnet too.
    expect(text).not.toContain("Reclaim mainnet protected payment E2E delivery proof");
    expect(text).not.toMatch(/challengeId|signature|nonce/i);
    // Back link preserves the explicit chain.
    const backLink = document.querySelector<HTMLAnchorElement>('a[href="/payments/1?chainId=42220"]');
    expect(backLink).not.toBeNull();
  });

  it("fails closed on unsupported ?chainId= (no fetch, explicit notice)", async () => {
    searchState.query = "chainId=1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount(<ReceiptDetailPage />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Unsupported network");
    expect(text).toContain("42220");
    expect(text).toContain("11142220");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text).not.toContain("Settlement receipt");
  });

  it("fails closed on malformed ?chainId=", async () => {
    searchState.query = "chainId=abc";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount(<ReceiptDetailPage />);

    expect(document.body.textContent ?? "").toContain("Unsupported network");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listing threads the explicit chain into contract reads, receipt fetches and detail links", async () => {
    searchState.query = "chainId=42220";
    walletState.address = CLIENT;
    walletState.isConnected = true;
    const fetchMock = stubReceiptFetch(MAINNET_RECEIPT);
    await mount(<ReceiptsPage />);

    // Contract reads target Mainnet explicitly (no silent Sepolia fallback).
    expect(contractCalls.clientChain).toContain(42220);
    expect(contractCalls.workerChain).toContain(42220);
    // Receipt fetch carries the chain.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/payments/1/receipt?chainId=42220",
    );
    // Card shows Mainnet token + network, link preserves the chain.
    const text = document.body.textContent ?? "";
    expect(text).toContain("Payment #1");
    expect(text).toContain("0.05");
    expect(text).toContain("USA₮");
    expect(text).toContain("Celo Mainnet");
    const link = document.querySelector<HTMLAnchorElement>('a[href="/receipts/1?chainId=42220"]');
    expect(link).not.toBeNull();
  });

  it("listing defaults to Sepolia URLs when ?chainId= is absent (Sepolia regression)", async () => {
    searchState.query = "";
    walletState.address = CLIENT;
    walletState.isConnected = true;
    const fetchMock = stubReceiptFetch(SEPOLIA_RECEIPT);
    await mount(<ReceiptsPage />);

    expect(contractCalls.clientChain).toContain(11142220);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/payments/1/receipt");
    const link = document.querySelector<HTMLAnchorElement>('a[href="/receipts/1"]');
    expect(link).not.toBeNull();
    expect(document.body.textContent ?? "").toContain("0.01 USDC");
  });

  it("listing fails closed on unsupported ?chainId=", async () => {
    searchState.query = "chainId=137";
    walletState.address = CLIENT;
    walletState.isConnected = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount(<ReceiptsPage />);

    expect(document.body.textContent ?? "").toContain("Unsupported network");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
