// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// /payments/[paymentId]/review — human review surface tests
//
// Real packet loading, rendered QC/reviewer content, role/decision gating,
// confirmation step WITHOUT any mutation/signing, and the explicit
// agent-prepares / person-decides message.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toHex } from "viem";

const wagmiMocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
  useDisconnect: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: wagmiMocks.useConnection,
  useDisconnect: wagmiMocks.useDisconnect,
}));

vi.mock("@/hooks/contracts/useReadContract", () => ({
  usePayment: () => ({
    data: {
      client: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
      worker: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      state: "DeliverySubmitted",
    },
    isLoading: false,
    isError: false,
    notFound: false,
  }),
}));

vi.mock("@/components/ui/Button", () => ({
  default: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/Notice", () => ({
  default: ({ children }: { children: React.ReactNode; variant?: string }) => (
    <div>{children}</div>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ paymentId: "1" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ReviewPage from "../review/page";

const PACKET = {
  schemaVersion: "reclaim-review-packet-v1",
  preparedBy: { agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235", objective: "Prepare this payment case for fair human review." },
  disclaimer: "The agent prepares the case; people make the final decision. The contract protects the payment.",
  case: {
    escrowChainId: "eip155:11142220",
    escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
    escrowPaymentId: "1",
    state: "delivered",
    client: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
    worker: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    amountAtomic: "10000",
  },
  evidence: {
    evidenceReference: "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    title: "Controlled dispute test — completed work evidence",
    evidenceType: "other",
    description: "Evidence showing the completed work for Payment #1.",
    fileCount: 0,
    availability: "package_available",
    substantiveEvidence: true,
    caseVersionHash: "0x72ecc6a1…",
    evidenceVersionHash: "0xa5519101…",
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
    settlementTxHash: "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351",
    paymentReference: "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351",
    resultReference: "0xadca01fd…",
  },
  decision: "NO DECISION MADE BY THE AGENT — human review required.",
};

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const OTHER = "0x1111111111111111111111111111111111111111";

let root: Root | null = null;

function setupWallet(address: string | undefined) {
  const provider = {
    request: vi.fn(async () => toHex(11142220)),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const connector = { getProvider: vi.fn(async () => provider), getChainId: vi.fn(async () => 11142220) };
  const isConnected = address !== undefined;
  wagmiMocks.useConnection.mockReturnValue({
    address,
    chainId: address ? 11142220 : undefined,
    connector,
    isReconnecting: false,
    isConnected,
    isConnecting: false,
    isDisconnected: !isConnected,
    status: isConnected ? "connected" : "disconnected",
  });
  wagmiMocks.useDisconnect.mockReturnValue({ mutate: vi.fn() });
}

function setupFetch(packet: unknown = PACKET, ok = true) {
  const body =
    packet === PACKET
      ? {
          found: true,
          paymentId: "1",
          agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
          packetEventId: "437c351a-5875-4fc5-8574-dacca19595bb",
          packet,
        }
      : packet;
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountReview() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReviewPage />);
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

describe("/payments/[paymentId]/review", () => {
  it("loads the REAL packet and renders case, evidence, QC and provenance", async () => {
    setupWallet(CLIENT);
    setupFetch();
    await mountReview();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Case review — Payment #1");
    expect(text).toContain("agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235");
    expect(text).toContain(CLIENT);
    expect(text).toContain(WORKER);
    expect(text).toContain("0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99");
    expect(text).toContain("package_available");
    expect(text).toContain("Controlled dispute test — completed work evidence");
    expect(text).toContain("needs_improvement");
    expect(text).toContain("Unverified submitter");
    expect(text).toContain("Reviewer question");
    expect(text).toContain("Paste relevant message logs");
    expect(text).toContain("0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351");
    expect(text).toContain("0x72ecc6a1");
    expect(text).toContain("0xa5519101");
    expect(text).toContain("The agent prepared this case. A person makes the final decision.");
  });

  it("client sees Approve release + Open dispute; worker only Open dispute", async () => {
    setupWallet(CLIENT);
    setupFetch();
    await mountReview();
    let text = document.body.textContent ?? "";
    expect(text).toContain("Approve release");
    expect(text).toContain("Open dispute");

    await act(async () => {
      root!.unmount();
    });
    document.body.innerHTML = "";

    setupWallet(WORKER);
    await mountReview();
    text = document.body.textContent ?? "";
    expect(text).not.toContain("Approve release");
    expect(text).toContain("Open dispute");
  });

  it("a viewer/other wallet sees no decision controls", async () => {
    setupWallet(OTHER);
    setupFetch();
    await mountReview();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Approve release");
    expect(text).not.toContain("Open dispute");
    expect(text).toContain("Only the payment client or worker can make the final decision.");
  });

  it("confirmation step does NOT execute anything (no mutation, no signing)", async () => {
    setupWallet(CLIENT);
    const fetchMock = setupFetch();
    await mountReview();

    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Approve release"))!
        .click();
    });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Confirm: approve release");
    expect(text).toContain("final human decision");

    // The only network call was the read-only packet GET — no POST, no
    // wallet write, no signing (no wagmi write hooks are mounted).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/payments/1/review-packet");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("shows the empty state when no packet exists", async () => {
    setupWallet(CLIENT);
    setupFetch({ found: false, paymentId: "1" });
    await mountReview();
    const text = document.body.textContent ?? "";
    expect(text).toContain("No review packet has been prepared");
  });
});
