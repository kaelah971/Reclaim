// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.4E useSubmitEvidenceFlow — durable manifest + metadata-only recovery.
//
//   - Initial state never implies success (isSuccess false, idle).
//   - submit() persists the manifest to localStorage (refresh survival).
//   - recoverMetadata() POSTs with the exact submit() body shape WITHOUT any
//     chain write (submitEvidenceTx / writeContract never called); success
//     clears the stored manifest.
//   - Recovery retry is idempotent (second POST → 200 alreadyExisted).
//   - Recovery failure surfaces error state and withholds success.
// Mocks only — no chain transactions, no real network (fetch stubbed).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect } from "react";
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
const STORAGE_KEY = "reclaim.evidenceManifest.11142220.1";

const FORM: EvidenceFormData = {
  title: "Logo delivery",
  description: "Final logo delivery for review",
  type: "message",
  relatedClaim: "Logo",
  date: "2026-09-18",
  externalRef: "",
  pastedText: "Logo concepts attached as described — final delivery note.",
  fileHash: "",
};

type FlowApi = ReturnType<typeof useSubmitEvidenceFlow>;

let latest: FlowApi | null = null;
let root: Root | null = null;

function setupWagmiMocks() {
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
    data: undefined,
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
  wagmiMocks.useWaitForTransactionReceipt.mockReturnValue({
    isLoading: false,
    isSuccess: false,
  });
}

function writeContractMock(): ReturnType<typeof vi.fn> {
  const results = wagmiMocks.useWriteContract.mock.results;
  expect(results.length).toBeGreaterThan(0);
  return results[0].value.writeContract;
}

function Harness() {
  const flow = useSubmitEvidenceFlow(1n, "1");
  useEffect(() => {
    latest = flow;
  });
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
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("P6.4E useSubmitEvidenceFlow — durable recovery", () => {
  it("initial state never implies success", async () => {
    setupWagmiMocks();
    vi.stubGlobal("fetch", vi.fn());
    await mountHarness();

    expect(latest!.isSuccess).toBe(false);
    expect(latest!.isTxConfirmed).toBe(false);
    expect(latest!.metadataState).toBe("idle");
    expect(latest!.metadataError).toBeNull();
    expect(latest!.hasStoredManifest()).toBeNull();
  });

  it("submit() persists the manifest to localStorage (refresh survival)", async () => {
    setupWagmiMocks();
    vi.stubGlobal("fetch", vi.fn());
    await mountHarness();

    await act(async () => {
      latest!.submit(FORM);
    });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(FORM);
    expect(latest!.hasStoredManifest()).toEqual(FORM);
  });

  it("recoverMetadata() POSTs the exact body with zero chain writes", async () => {
    setupWagmiMocks();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    const writeMock = writeContractMock();

    // Seed the durable manifest as if a pre-refresh submit() stored it.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(FORM));

    await act(async () => {
      latest!.recoverMetadata(FORM);
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
    expect(body.relatedClaim).toBe(FORM.relatedClaim);
    expect(body.date).toBe(FORM.date);
    expect(body.externalRef).toBe(FORM.externalRef);
    expect(body.pastedText).toBe(FORM.pastedText);
    expect(body.fileHash).toBe(FORM.fileHash);
    expect(body.chainId).toBe(11142220);
    expect(body.escrowChainId).toBe("11142220");

    // ZERO chain writes on the recovery path.
    expect(writeMock).not.toHaveBeenCalled();

    expect(latest!.metadataState).toBe("persisted");
    expect(latest!.metadataError).toBeNull();
    // Success clears the durable copy.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("recovery retry is idempotent (200 alreadyExisted → persisted)", async () => {
    setupWagmiMocks();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve("stale read") })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    const writeMock = writeContractMock();

    await act(async () => {
      latest!.recoverMetadata(FORM);
    });
    await act(async () => {});

    expect(latest!.metadataState).toBe("error");
    expect(latest!.metadataError).toBeTruthy();

    await act(async () => {
      latest!.recoverMetadata(FORM);
    });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writeMock).not.toHaveBeenCalled();
    expect(latest!.metadataState).toBe("persisted");
  });

  it("recovery failure withholds success and never touches the chain", async () => {
    setupWagmiMocks();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("HASH_MISMATCH"),
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountHarness();
    const writeMock = writeContractMock();

    await act(async () => {
      latest!.recoverMetadata(FORM);
    });
    await act(async () => {});

    expect(writeMock).not.toHaveBeenCalled();
    expect(latest!.metadataState).toBe("error");
    expect(latest!.isSuccess).toBe(false);
  });
});
