// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.3b useSubmitEvidenceFlow — chain-aware metadata binding (mocks only).
//
//   - Default (no chain) binds the Sepolia canonical chain (regression).
//   - Explicit 42220 binds the Mainnet canonical chain in the metadata POST
//     so the server verifies against the right payment+chain.
//   - Evidence attribution is retained: every manifest field plus the
//     keccak256 reference survive into the POST body.
//   - Simulate-before-write is preserved via the underlying escrow action
//     hook (wagmi publicClient.simulateContract mock resolves).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EvidenceFormData } from "@/lib/evidence/manifest";
import type { EscrowChainReference } from "@/lib/contracts/config";

const wagmiMocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
  usePublicClient: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: wagmiMocks.useAccount,
  usePublicClient: wagmiMocks.usePublicClient,
  useWriteContract: wagmiMocks.useWriteContract,
  useWaitForTransactionReceipt: wagmiMocks.useWaitForTransactionReceipt,
}));

import { useSubmitEvidenceFlow } from "../useSubmitEvidenceFlow";
import { celoChain } from "@/lib/web3/chains";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const CELO_SEPOLIA_ID = 11142220;
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const FORM: EvidenceFormData = {
  title: "Final Figma delivery",
  description: "Design handoff with tokens and layers",
  type: "delivery-file",
  relatedClaim: "Landing page Figma file",
  date: "2026-08-08",
  externalRef: "",
  pastedText: "Design system v2 attached",
  fileHash: "0xbeef",
};

type FlowApi = ReturnType<typeof useSubmitEvidenceFlow>;

let latest: FlowApi | null = null;
let refresh: (() => void) | null = null;
let root: Root | null = null;
let harnessChain: EscrowChainReference | undefined;

function setupWagmiMocks(options: {
  txHash?: `0x${string}`;
  receiptSuccess?: boolean;
}) {
  const connector = {
    getChainId: vi.fn(() => Promise.resolve(CELO_SEPOLIA_ID)),
  };
  wagmiMocks.useAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: CELO_SEPOLIA_ID,
    connector,
    isReconnecting: false,
    isConnected: true,
    isConnecting: false,
    isDisconnected: false,
    status: "connected",
  });
  wagmiMocks.usePublicClient.mockReturnValue({
    simulateContract: vi.fn(() => Promise.resolve({ request: {} })),
  });
  wagmiMocks.useWriteContract.mockReturnValue({
    writeContract: vi.fn(),
    data: options.txHash,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: options.receiptSuccess ?? false,
  });
}

function Harness() {
  const chainArg: EscrowChainReference =
    harnessChain === undefined ? celoChain : harnessChain;
  const flow = useSubmitEvidenceFlow(7n, "7", chainArg);
  const [, force] = useState(0);
  useEffect(() => {
    latest = flow;
    refresh = () => force((v) => v + 1);
  }, [flow]);
  return null;
}

async function mountHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness />);
  });
  await act(async () => {});
}

async function submitAndConfirm() {
  await act(async () => {
    latest!.submit(FORM);
  });
  wagmiMocks.useWriteContract.mockReturnValue({
    writeContract: vi.fn(),
    data: TX_HASH,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: true,
  });
  await act(async () => {
    refresh!();
  });
  await act(async () => {});
}

beforeEach(() => {
  latest = null;
  refresh = null;
  harnessChain = undefined;
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("P4.3b useSubmitEvidenceFlow — chain-aware metadata binding", () => {
  it("defaults to the Sepolia canonical chain (regression)", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    await submitAndConfirm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/7/evidence/metadata");
    const body = JSON.parse(init.body as string);
    expect(body.escrowChainId).toBe("11142220");
    expect(body.chainId).toBe(11142220);
  });

  it("binds explicit Mainnet chain (42220) into the metadata POST", async () => {
    harnessChain = 42220;
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    await submitAndConfirm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/7/evidence/metadata");
    const body = JSON.parse(init.body as string);
    expect(body.escrowChainId).toBe("42220");
    expect(body.chainId).toBe(42220);
    expect(latest!.isSuccess).toBe(true);
  });

  it("retains evidence attribution (all manifest fields + keccak reference)", async () => {
    harnessChain = 42220;
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    await submitAndConfirm();

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe(FORM.title);
    expect(body.description).toBe(FORM.description);
    expect(body.type).toBe(FORM.type);
    expect(body.relatedClaim).toBe(FORM.relatedClaim);
    expect(body.date).toBe(FORM.date);
    expect(body.externalRef).toBe(FORM.externalRef);
    expect(body.pastedText).toBe(FORM.pastedText);
    expect(body.fileHash).toBe(FORM.fileHash);
    expect(latest!.lastReference).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
