// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// /receipts/[receiptId] — final settlement receipt page tests
//
// Real receipt loading (GET only), full story rendering incl. the recorded
// QC inconsistencies, human-decision attribution, explorer audit links, and
// read-only behavior (no wallet, no mutation, no signing).
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
  useParams: () => ({ receiptId: "1" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ReceiptDetailPage from "../[receiptId]/page";

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
    title: "Controlled dispute test — completed work evidence",
    claim: "Completed work for the controlled dispute test",
    date: "2026-08-08",
    pastedText: "I completed the agreed controlled dispute test deliverable.",
    evidenceReference: "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-08-09T02:49:25.972Z",
    submitter: "chain_verified",
    submissionTxHash: "0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
  },
  resolutionAgent: {
    agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    objective: "Prepare this payment case for fair human review.",
    statement: "The agent prepared the case. A person made the final decision.",
    caseVersionHash: "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
    evidenceVersionHash: "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    priceHuman: "$0.01 USDC",
    network: "Celo Mainnet",
    facilitatorUrl: "https://api.x402.celo.org",
    executionRequestHash: "0x8a26b7131c30af20a6210b78cc00f250f20341ed80feb7219e48b36303c83015",
    readiness: "needs_improvement",
    reviewerQuestions: [
      "Reviewer question: No pasted text content — evidence may lack substance.",
    ],
    ambiguities: ["Unverified submitter — evidence could be from an unknown third party."],
    recommendedImprovements: ["Paste relevant message logs, terms, or documentation."],
    settlementTxHash: X402_TX,
    paymentReference: X402_TX,
    resultReference: "0xadca01fd…",
    inconsistencies: [
      "QC states there is no pasted text, but verified evidence contains pasted text.",
    ],
  },
  humanDecision: {
    decision: "Approve release",
    authority: "client",
    txHash: RELEASE_TX,
    sender: CLIENT.toLowerCase(),
    blockNumber: "32992161",
    blockTime: "2026-08-09T11:49:09.000Z",
    status: "success",
    finalRecipient: WORKER,
    outcome: "Released",
  },
  audit: {
    explorerLinks: {
      escrowContract: "https://celo-sepolia.blockscout.com/address/0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      client: "https://celo-sepolia.blockscout.com/address/" + CLIENT,
      worker: "https://celo-sepolia.blockscout.com/address/" + WORKER,
      releaseTransaction: "https://celo-sepolia.blockscout.com/tx/" + RELEASE_TX,
      evidenceSubmissionTransaction:
        "https://celo-sepolia.blockscout.com/tx/0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958",
      x402SettlementTransaction: "https://celoscan.io/tx/" + X402_TX,
    },
    timestamps: {
      evidenceSubmittedAt: "2026-08-09T02:49:25.972Z",
      releaseAt: "2026-08-09T11:49:09.000Z",
      qcSettlementAt: "2026-08-09T07:42:20.000Z",
    },
  },
};

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

describe("/receipts/[receiptId]", () => {
  it("renders the complete real settlement receipt", async () => {
    setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });
    await mountReceipt();

    const text = document.body.textContent ?? "";
    // Header + outcome
    expect(text).toContain("Settlement receipt — Payment #1");
    expect(text).toContain("Released to the worker");
    expect(text).toContain("Verified on-chain");
    // Protected payment + allocation
    expect(text).toContain("0.01");
    expect(text).toContain(CLIENT);
    expect(text).toContain(WORKER);
    expect(text).toContain("Worker allocation");
    expect(text).toContain("Client allocation");
    // Evidence record
    expect(text).toContain("0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99");
    expect(text).toContain("package_available");
    // Resolution record: agent, QC, decision
    expect(text).toContain("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(text).toContain("The agent prepared the case. A person made the final decision.");
    expect(text).toContain("$0.01 USDC");
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("https://api.x402.celo.org");
    expect(text).toContain(X402_TX);
    expect(text).toContain("Approve release");
    expect(text).toContain(RELEASE_TX);
    expect(text).toContain("0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695");
    // Review result plain language
    expect(text).toContain("Released — approved by the client");
    // Audit links
    expect(text).toContain("blockscout.com/tx/");
    expect(text).toContain("celoscan.io/tx/");
    // Product model
    expect(text).toContain("The contract protects the payment.");
    expect(text).toContain("People make the final decision.");
  });

  it("never hides the recorded QC inconsistencies", async () => {
    setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    expect(text).toContain("QC ran before the verified facts were available");
    expect(text).toContain("QC states there is no pasted text");
  });

  it("is read-only: only a GET to the receipt API, no wallet, no mutation", async () => {
    const fetchMock = setupFetch({ found: true, paymentId: "1", receipt: RECEIPT });
    await mountReceipt();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/payments/1/receipt");
    expect(init?.method ?? "GET").toBe("GET");

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Connect wallet");
    expect(text).not.toContain("Confirm:");
    expect(text).not.toContain("Sign");
  });

  it("shows the unavailable state when no receipt exists", async () => {
    setupFetch({ found: false, paymentId: "1" });
    await mountReceipt();
    const text = document.body.textContent ?? "";
    expect(text).toContain("This settlement receipt is not available yet");
  });
});
