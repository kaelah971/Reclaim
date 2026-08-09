// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AgentRunCard — manual "run one worker iteration" control tests
//
//   1. non-runnable agent status          => renders nothing
//   2. on-chain payment state unknown     => renders nothing
//   3. terminal payment state "Released"  => muted terminal card, NO button
//   4. runnable + wallet connected + click => canonical message signed, POST
//      to /api/resolution-agents/<id>/run with x-wallet-* headers, success
//      notice shows the outcome, parent refreshed via onRan
//   5. run failure                        => explicit warning notice
//
// The worker is NEVER executed — fetch is stubbed and resolves canned
// public-safe results.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toHex } from "viem";

const wagmiMocks = vi.hoisted(() => ({
  useConnection: vi.fn(),
  useDisconnect: vi.fn(),
  useSignMessage: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: wagmiMocks.useConnection,
  useDisconnect: wagmiMocks.useDisconnect,
  useSignMessage: wagmiMocks.useSignMessage,
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
  default: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <div data-testid={`notice-${variant ?? "info"}`}>{children}</div>
  ),
}));

import AgentRunCard from "../AgentRunCard";
import { decodeWalletAuthMessage } from "@/lib/x402/walletAuth";

const FUNDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";

let root: Root | null = null;

function setupWallet(options: { connectedAddress?: string }) {
  const provider = {
    request: vi.fn(async () => toHex(11142220)),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const connector = {
    getProvider: vi.fn(async () => provider),
    getChainId: vi.fn(async () => 11142220),
  };
  const isConnected = options.connectedAddress !== undefined;
  wagmiMocks.useConnection.mockReturnValue({
    address: options.connectedAddress,
    chainId: options.connectedAddress ? 11142220 : undefined,
    connector,
    isReconnecting: false,
    isConnected,
    isConnecting: false,
    isDisconnected: !isConnected,
    status: isConnected ? "connected" : "disconnected",
  });
  wagmiMocks.useDisconnect.mockReturnValue({ mutate: vi.fn() });

  const signMessageAsync = vi.fn(() =>
    Promise.resolve("0xsignature1234"),
  );
  wagmiMocks.useSignMessage.mockReturnValue({
    signMessageAsync,
    signMessage: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  });

  return { signMessageAsync };
}

async function mountHarness(props: Parameters<typeof AgentRunCard>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AgentRunCard {...props} />);
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
});

const baseProps = () => ({
  agentId: AGENT_ID,
  escrowPaymentId: "1",
  status: "active",
  paymentState: "Disputed" as string | null,
});

describe("AgentRunCard", () => {
  it("1) renders nothing when the agent status is not worker-runnable", async () => {
    setupWallet({ connectedAddress: FUNDER });
    await mountHarness({ ...baseProps(), status: "paused" });

    expect(document.body.textContent?.trim() ?? "").toBe("");
    expect(document.body.querySelector("[data-testid='agent-run-card']")).toBeNull();
    expect(document.body.querySelector("[data-testid='agent-run-terminated']")).toBeNull();
  });

  it("2) renders nothing when the on-chain payment state is unknown (null)", async () => {
    setupWallet({ connectedAddress: FUNDER });
    await mountHarness({ ...baseProps(), paymentState: null });

    expect(document.body.textContent?.trim() ?? "").toBe("");
  });

  it("3) terminal payment state shows the muted terminal card and NO button", async () => {
    setupWallet({ connectedAddress: FUNDER });
    await mountHarness({ ...baseProps(), paymentState: "Released" });

    const terminalCard = document.body.querySelector("[data-testid='agent-run-terminated']");
    expect(terminalCard).not.toBeNull();
    expect(terminalCard!.textContent).toContain("Case resolved");
    expect(terminalCard!.textContent).toContain("Released");
    expect(document.body.querySelector("button")).toBeNull();
    expect(document.body.querySelector("[data-testid='agent-run-card']")).toBeNull();
  });

  it("4) signs the canonical message, POSTs the run with x-wallet-* headers, shows the outcome, refreshes via onRan", async () => {
    setupWallet({ connectedAddress: FUNDER });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          result: {
            workerIterationId: "iter_1",
            agentId: AGENT_ID,
            outcome: "processed",
            actionDispatched: { kind: "executed" },
          },
          agent: { id: AGENT_ID, status: "active" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRan = vi.fn();
    await mountHarness({ ...baseProps(), onRan });

    await act(async () => {
      document.body.querySelector("button")!.click();
    });
    await act(async () => {});

    expect(wagmiMocks.useSignMessage).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/resolution-agents/${AGENT_ID}/run`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-wallet-address"]).toBe(FUNDER);
    expect(headers["x-wallet-signature"]).toBe("0xsignature1234");
    expect(headers["x-wallet-message"]).toMatch(/^b64url:[A-Za-z0-9_-]+$/);
    const decoded = decodeWalletAuthMessage(headers["x-wallet-message"]);
    expect(decoded).toContain("run_resolution_agent");
    expect(decoded).toContain(AGENT_ID);
    // No request body is sent.
    expect(init.body).toBeUndefined();

    // Success notice summarizes the outcome + dispatched action.
    expect(document.body.textContent).toContain("Iteration complete: processed");
    expect(document.body.textContent).toContain("action executed");
    expect(onRan).toHaveBeenCalledTimes(1);
  });

  it("5) shows an explicit warning notice and does not refresh on failure", async () => {
    setupWallet({ connectedAddress: FUNDER });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ error: "Internal server error: boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRan = vi.fn();
    await mountHarness({ ...baseProps(), onRan });

    await act(async () => {
      document.body.querySelector("button")!.click();
    });
    await act(async () => {});

    expect(document.body.querySelector("[data-testid='notice-warning']")).not.toBeNull();
    expect(document.body.textContent).toContain("boom");
    expect(document.body.textContent).not.toContain("Iteration complete");
    expect(onRan).not.toHaveBeenCalled();
  });
});
