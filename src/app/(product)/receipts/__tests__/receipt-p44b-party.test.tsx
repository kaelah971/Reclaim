// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.4b receipt — party-authenticated private delivery view (mocked only).
//
// The public receipt stays hash-only. The connected client/worker may reveal
// delivery plaintext via the SAME P4.3D wallet-challenge flow
// (readPartyEvidence → .../evidence/challenge + .../evidence/plaintext).
// Anonymous and unrelated wallets stay redacted: no reveal control, no
// challenge/plaintext fetch, no plaintext in the DOM. Signatures,
// challenges and nonces are never rendered.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const searchState = vi.hoisted(() => ({ query: "" }));
const walletState = vi.hoisted(() => ({
  address: undefined as string | undefined,
  isConnected: false,
}));
const signState = vi.hoisted(() => ({
  calls: [] as string[],
  shouldThrow: false,
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
vi.mock("wagmi", () => ({
  useSignMessage: () => ({
    signMessageAsync: async ({ message }: { message: string }) => {
      signState.calls.push(message);
      if (signState.shouldThrow) throw new Error("User rejected the signature.");
      return "0xmocksignature";
    },
  }),
}));

import ReceiptDetailPage from "../[receiptId]/page";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const STRANGER = "0x000000000000000000000000000000000000dEaD";
const EVIDENCE_HASH =
  "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99";

// Sanitized public receipt — plaintext nulls, QC [].
const PUBLIC_RECEIPT = {
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
    escrowState: "5",
    financialOutcome: "Released to worker",
    resolvedAt: null,
  },
  agreement: {
    deliverable: null,
    deliveryFormat: null,
    releaseRule: null,
    evidenceExpectation: null,
    deadline: null,
    autoReleaseSeconds: null,
    disputeWindowSeconds: null,
  },
  evidence: {
    title: null,
    claim: null,
    date: null,
    pastedText: null,
    evidenceReference: EVIDENCE_HASH,
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-08-09T02:49:25.972Z",
    submitter: "chain_verified",
    submissionTxHash: null,
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
    txHash: null,
    sender: null,
    blockNumber: null,
    blockTime: null,
    status: null,
    finalRecipient: WORKER,
    outcome: "Released",
    clientAmount: null,
    workerAmount: null,
    clientAmountHuman: null,
    workerAmountHuman: null,
  },
  audit: {
    explorerLinks: {
      escrowContract: "https://example.com/escrow",
      client: "https://example.com/client",
      worker: "https://example.com/worker",
      releaseTransaction: null,
      evidenceSubmissionTransaction: null,
      x402SettlementTransaction: null,
      disputeTransaction: null,
      resolutionTransaction: null,
      cancellationTransaction: null,
    },
    timestamps: {
      evidenceSubmittedAt: "2026-08-09T02:49:25.972Z",
      releaseAt: "2026-08-09T11:49:09.000Z",
      qcSettlementAt: null,
      disputedAt: null,
      resolvedAt: null,
      cancelledAt: null,
    },
  },
};

const PARTY_PLAINTEXT = {
  title: "Party-only delivery title",
  claim: "Party-only delivery claim",
  description: "Party-only delivery description",
  pastedText: "Party-only pasted delivery text",
  date: "2026-08-08",
  externalRef: null,
  evidenceType: "other",
  fileHash: null,
  fileCount: 0,
  evidenceReference: EVIDENCE_HASH,
  submittedAt: "2026-08-09T02:49:25.972Z",
  submitter: "chain_verified",
  availability: "package_available",
};

let root: Root | null = null;

/** Route fetch: receipt → sanitized; challenge/plaintext → mocked party flow. */
function stubPartyFetch(opts?: { plaintextStatus?: number }) {
  const calls: string[] = [];
  const fetchMock = vi.fn().mockImplementation((url: unknown, init?: RequestInit) => {
    const href = String(url);
    calls.push(`${init?.method ?? "GET"} ${href}`);
    if (href.includes("/evidence/challenge")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            challengeId: "challenge-1",
            message: "Reclaim evidence read challenge",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            paymentId: "1",
            chainId: 11142220,
            escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
            wallet: walletState.address,
            purpose: "evidence-read",
          }),
      });
    }
    if (href.includes("/evidence/plaintext")) {
      if ((opts?.plaintextStatus ?? 200) !== 200) {
        return Promise.resolve({
          ok: false,
          status: opts!.plaintextStatus,
          json: () => Promise.resolve({ error: "Forbidden.", code: "NOT_PARTY" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ found: true, paymentId: "1", evidence: PARTY_PLAINTEXT }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ found: true, paymentId: "1", receipt: PUBLIC_RECEIPT }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReceiptDetailPage />);
  });
  await act(async () => {});
}

async function clickReveal() {
  const button = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Reveal delivery evidence"),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {});
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
  signState.calls.length = 0;
  signState.shouldThrow = false;
});

describe("P4.4b receipt party private view (mocked auth only)", () => {
  it("anonymous stays redacted: locked notice, no reveal fetch, no plaintext", async () => {
    walletState.address = undefined;
    walletState.isConnected = false;
    const { fetchMock, calls } = stubPartyFetch();
    await mount();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Private delivery evidence");
    expect(text).toContain(EVIDENCE_HASH);
    // No plaintext anywhere in the public DOM.
    expect(text).not.toContain("Party-only delivery title");
    expect(text).not.toContain("Party-only pasted delivery text");
    // No challenge/plaintext fetch occurred.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.includes("/evidence/"))).toBe(false);
    expect(signState.calls).toHaveLength(0);
    // No reveal control for anonymous.
    expect(text).not.toContain("Reveal delivery evidence");
  });

  it("unrelated connected wallet stays redacted (denied)", async () => {
    walletState.address = STRANGER;
    walletState.isConnected = true;
    const { fetchMock, calls } = stubPartyFetch();
    await mount();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Private delivery evidence");
    expect(text).not.toContain("Party-only delivery title");
    expect(text).not.toContain("Reveal delivery evidence");
    expect(calls.some((c) => c.includes("/evidence/"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("connected client reveals plaintext only after the challenge + signature flow", async () => {
    walletState.address = CLIENT;
    walletState.isConnected = true;
    const { calls } = stubPartyFetch();
    await mount();

    // Gate offered to the party, plaintext not yet shown.
    expect(document.body.textContent ?? "").toContain("Reveal delivery evidence");
    expect(document.body.textContent ?? "").not.toContain("Party-only pasted delivery text");

    await clickReveal();

    const text = document.body.textContent ?? "";
    // Challenge requested, message signed, plaintext fetched.
    expect(calls.some((c) => c.includes("/evidence/challenge"))).toBe(true);
    expect(calls.some((c) => c.includes("/evidence/plaintext"))).toBe(true);
    expect(signState.calls.length).toBeGreaterThan(0);
    // Plaintext now visible to the party.
    expect(text).toContain("Party-only delivery title");
    expect(text).toContain("Party-only delivery claim");
    expect(text).toContain("Party-only pasted delivery text");
    // Auth material never rendered.
    expect(text).not.toMatch(/challenge-1|0xmocksignature/i);
    expect(document.body.innerHTML).not.toContain("0xmocksignature");
  });

  it("connected worker reveals plaintext via the same flow", async () => {
    walletState.address = WORKER;
    walletState.isConnected = true;
    stubPartyFetch();
    await mount();
    await clickReveal();

    expect(document.body.textContent ?? "").toContain("Party-only delivery title");
    expect(signState.calls.length).toBeGreaterThan(0);
  });

  it("party flow threads the explicit Mainnet chain into challenge + plaintext", async () => {
    searchState.query = "chainId=42220";
    walletState.address = CLIENT;
    walletState.isConnected = true;
    const { fetchMock } = stubPartyFetch();
    await mount();
    await clickReveal();

    const bodies = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([, init]) => String((init as RequestInit).body ?? ""));
    expect(bodies.some((b) => b.includes("42220"))).toBe(true);
    expect(document.body.textContent ?? "").toContain("Party-only delivery title");
  });

  it("signature rejection surfaces an error and keeps plaintext hidden", async () => {
    walletState.address = CLIENT;
    walletState.isConnected = true;
    signState.shouldThrow = true;
    stubPartyFetch();
    await mount();
    await clickReveal();

    const text = document.body.textContent ?? "";
    expect(text).toContain("User rejected the signature.");
    expect(text).not.toContain("Party-only pasted delivery text");
  });
});
