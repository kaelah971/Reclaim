// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useSubmitEvidenceFlow — evidence submission lifecycle tests
//
// Required semantics under test:
//   no tx hash            => no success / no redirect / no metadata POST
//   wallet rejection      => error shown, no success / no metadata POST
//   failed receipt        => no success / no metadata POST
//   successful receipt    => metadata POST occurs, THEN success
//   metadata POST failure => error state, success withheld, retry re-POSTs
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EvidenceFormData } from "@/lib/evidence/manifest";

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

function setupWagmiMocks(options: {
  txHash?: `0x${string}`;
  receiptSuccess?: boolean;
  writeError?: unknown;
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
    error: options.writeError ?? null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: options.receiptSuccess ?? false,
  });
}

function Harness() {
  const flow = useSubmitEvidenceFlow(1n, "1");
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

beforeEach(() => {
  latest = null;
  refresh = null;
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

describe("useSubmitEvidenceFlow — strict success semantics", () => {
  it("no tx hash => no success, no metadata POST, no redirect state", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();

    await act(async () => {
      latest!.submit(FORM);
    });

    expect(latest!.txHash).toBeUndefined();
    expect(latest!.isTxConfirmed).toBe(false);
    expect(latest!.isSuccess).toBe(false);
    expect(latest!.metadataState).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wallet rejection => error shown, no success, no metadata POST", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();

    await act(async () => {
      latest!.submit(FORM);
    });

    // Wallet rejects the signature: the write mutation errors.
    wagmiMocks.useWriteContract.mockReturnValue({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      error: { shortMessage: "User rejected the request." },
      reset: vi.fn(),
    });
    await act(async () => {
      refresh!();
    });

    expect(latest!.error).toBe("Transaction was rejected. You can try again when ready.");
    expect(latest!.isTxConfirmed).toBe(false);
    expect(latest!.isSuccess).toBe(false);
    expect(latest!.metadataState).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("failed receipt (hash present, receipt not confirmed) => no metadata POST, no success", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();

    await act(async () => {
      latest!.submit(FORM);
    });

    // Wallet signed (hash produced) but the receipt never confirms.
    wagmiMocks.useWriteContract.mockReturnValue({
      writeContract: vi.fn(),
      data: TX_HASH,
      isPending: false,
      error: null,
      reset: vi.fn(),
    });
    wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
      isLoading: false,
      isSuccess: false,
    });
    await act(async () => {
      refresh!();
    });
    await act(async () => {});

    expect(latest!.txHash).toBe(TX_HASH);
    expect(latest!.isTxConfirmed).toBe(false);
    expect(latest!.isSuccess).toBe(false);
    expect(latest!.metadataState).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("successful receipt => metadata POST occurs, then success", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();

    await act(async () => {
      latest!.submit(FORM);
    });

    // Receipt confirms on-chain.
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/payments/1/evidence/metadata");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.title).toBe(FORM.title);
    expect(body.description).toBe(FORM.description);
    expect(body.type).toBe(FORM.type);
    expect(body.date).toBe(FORM.date);
    expect(body.pastedText).toBe(FORM.pastedText);
    expect(body.fileHash).toBe(FORM.fileHash);

    expect(latest!.isTxConfirmed).toBe(true);
    expect(latest!.metadataState).toBe("persisted");
    expect(latest!.isSuccess).toBe(true);
    expect(latest!.lastReference).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("metadata POST failure => error state, success withheld, retry re-POSTs", async () => {
    setupWagmiMocks({ txHash: undefined, receiptSuccess: false });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve("HASH_MISMATCH") })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();

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

    expect(latest!.metadataState).toBe("error");
    expect(latest!.metadataError).toBeTruthy();
    expect(latest!.isSuccess).toBe(false);

    await act(async () => {
      latest!.retryMetadata();
    });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest!.metadataState).toBe("persisted");
    expect(latest!.isSuccess).toBe(true);
  });
});
