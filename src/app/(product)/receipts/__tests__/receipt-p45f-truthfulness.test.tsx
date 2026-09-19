// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.5F — receipt truthfulness + humanization + chain preservation (mocks).
//
// Proves: happy-path receipt never claims Resolution Agent involvement,
// technical enums humanized, public receipt sanitized, Mainnet receipt links
// preserve chainId. Fixture/mock shape only (no Payment #2).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/ui/Button", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("@/components/ui/Notice", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/LoadingSkeleton", () => ({
  default: () => <div>Loading…</div>,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ receiptId: "9" }),
  useSearchParams: () => new URLSearchParams("chainId=42220"),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/wallet/useWalletState", () => ({
  useWalletState: () => ({
    address: undefined,
    isConnected: false,
    shortAddress: "",
    connectionState: "disconnected",
    isConnecting: false,
    isReconnecting: false,
    chainId: undefined,
    chainSupported: false,
    disconnect: () => {},
  }),
  shortenAddress: (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""),
}));
vi.mock("wagmi", () => ({
  useSignMessage: () => ({ signMessageAsync: async () => "0xsig" }),
}));

import ReceiptDetailPage from "../[receiptId]/page";
import {
  humanizeAvailabilityLabel,
  humanizeSubmitterLabel,
} from "@/components/payment/paymentLifecycle";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const RELEASE_TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// Happy-path Mainnet receipt: Released, no agent, no packet, no QC settlement.
const HAPPY_RECEIPT = {
  schemaVersion: "reclaim-final-receipt-v1",
  productModel:
    "The contract protects the payment. The agent prepares the resolution. People make the final decision.",
  protectedPayment: {
    paymentId: "9",
    amountAtomic: "10000",
    amountHuman: "0.01 USAT",
    asset: "USAT",
    client: CLIENT,
    worker: WORKER,
    escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
    chainId: "eip155:42220",
    network: "Celo Mainnet",
    finalState: "Released",
    releasedAt: "2026-09-01T00:00:00.000Z",
    escrowState: "5",
    financialOutcome: "Released to worker",
  },
  agreement: {
    deliverable: "Landing page",
    deliveryFormat: "URL",
    releaseRule: "manual",
    evidenceExpectation: "Link",
    deadline: null,
    autoReleaseSeconds: "0",
    disputeWindowSeconds: "86400",
  },
  evidence: {
    title: null,
    claim: null,
    date: null,
    pastedText: null,
    evidenceReference:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-09-01T00:00:00.000Z",
    submitter: "chain_verified",
    submissionTxHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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
    network: null,
    facilitatorUrl: null,
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
    txHash: RELEASE_TX,
    sender: CLIENT.toLowerCase(),
    blockNumber: "1",
    blockTime: "2026-09-01T00:00:00.000Z",
    status: "success",
    finalRecipient: WORKER,
    outcome: "Released",
  },
  audit: { explorerLinks: {}, timestamps: {} },
};

let root: Root | null = null;

function setupFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountReceipt() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReceiptDetailPage />);
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
});

describe("P4.5F receipt truthfulness + humanization", () => {
  it("happy-path receipt does NOT claim Resolution Agent involvement", async () => {
    setupFetch({ found: true, paymentId: "9", receipt: HAPPY_RECEIPT });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "The protected payment was released to the worker after the client approved the delivery.",
    );
    // Never infer agent participation for the happy path.
    expect(text).not.toContain("The resolution agent prepared the case");
    expect(text).not.toContain("The agent prepared the case");
  });

  it("agent receipt DOES mention the agent when durable data proves it", async () => {
    const withAgent = {
      ...HAPPY_RECEIPT,
      resolutionAgent: {
        agentId: "agt_test",
        objective: "Prepare case",
        statement: "The agent prepared the case. A person made the final decision.",
        caseVersionHash: "0x1234",
        evidenceVersionHash: null,
      },
    };
    setupFetch({
      found: true,
      paymentId: "9",
      agentId: "agt_test",
      packetEventId: "evt_1",
      receipt: withAgent,
    });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    expect(text).toContain("resolution agent prepared the case");
  });

  it("technical enums are humanized", () => {
    expect(humanizeAvailabilityLabel("package_available")).toBe(
      "Evidence record available",
    );
    expect(humanizeSubmitterLabel("chain_verified")).toBe("Verified on-chain");
  });

  it("renders humanized labels (never raw enums)", async () => {
    setupFetch({ found: true, paymentId: "9", receipt: HAPPY_RECEIPT });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Evidence record available");
    expect(text).toContain("Verified on-chain");
    expect(text).not.toContain("package_available");
    expect(text).not.toContain("chain_verified");
  });

  it("public receipt remains sanitized (no plaintext)", async () => {
    const fetchMock = setupFetch({
      found: true,
      paymentId: "9",
      receipt: HAPPY_RECEIPT,
    });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    // Hash-only evidence: reference present, plaintext absent.
    expect(text).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/payments/9/receipt");
  });

  it("Mainnet receipt links preserve chainId", async () => {
    const fetchMock = setupFetch({
      found: true,
      paymentId: "9",
      receipt: HAPPY_RECEIPT,
    });
    await mountReceipt();
    // Fetch threads ?chainId=42220.
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("chainId=42220");
    // Back-to-room link preserves chain.
    const backLink = document.body.querySelector('a[href*="/payments/9"]');
    expect(backLink?.getAttribute("href")).toContain("chainId=42220");
  });
});
