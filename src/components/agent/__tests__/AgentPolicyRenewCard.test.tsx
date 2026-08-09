// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AgentPolicyRenewCard — funder-only policy renewal control tests
//
//   1. expired + funder wallet connected => "Renew agent policy" shown
//   2. policy not expired               => card hidden (no auto-renew UI)
//   3. wrong wallet connected           => blocked, funder address shown
//   4. click renew                       => canonical message signed by the
//      connected FUNDER wallet, POST to the renew endpoint with
//      x-wallet-* headers + +24h expiry, success notice + parent refresh
//   5. renewal POST failure              => explicit error, no refresh
//   6. wallet not connected              => connect hint, no renewal control
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

import AgentPolicyRenewCard from "../AgentPolicyRenewCard";

const FUNDER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const OTHER = "0x1111111111111111111111111111111111111111";
const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";
const EXPIRED = Date.now() - 60_000;
const NOT_EXPIRED = Date.now() + 24 * 60 * 60 * 1000;

let root: Root | null = null;

function setupMocks(options: {
  connectedAddress?: string;
  signResult?: string;
  signRejects?: boolean;
}) {
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

  const signMessageAsync = vi.fn(
    options.signRejects
      ? () => Promise.reject(new Error("User rejected the request."))
      : () => Promise.resolve(options.signResult ?? "0xsignature1234"),
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

async function mountHarness(props: Parameters<typeof AgentPolicyRenewCard>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AgentPolicyRenewCard {...props} />);
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
  expiresAt: EXPIRED,
  funderAddress: FUNDER,
});

describe("AgentPolicyRenewCard", () => {
  it("1) shows 'Renew agent policy' when expired and the connected wallet is the funder", async () => {
    setupMocks({ connectedAddress: FUNDER });
    await mountHarness(baseProps());

    const button = document.body.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Renew agent policy");
  });

  it("2) renders nothing when the policy is not expired (no auto-renew UI)", async () => {
    setupMocks({ connectedAddress: FUNDER });
    await mountHarness({ ...baseProps(), expiresAt: NOT_EXPIRED });

    expect(document.body.querySelector("button")).toBeNull();
    expect(document.body.textContent?.trim() ?? "").toBe("");
  });

  it("3) blocks a wrong wallet and shows the required funder address", async () => {
    setupMocks({ connectedAddress: OTHER });
    await mountHarness(baseProps());

    expect(document.body.querySelector("button")).toBeNull();
    expect(document.body.textContent).toContain("only be renewed by its funder");
    expect(document.body.textContent).toContain(FUNDER);
  });

  it("4) signs the canonical message with the funder wallet and POSTs a +24h renewal", async () => {
    setupMocks({ connectedAddress: FUNDER });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: AGENT_ID, expiresAt: "123" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRenewed = vi.fn();
    await mountHarness({ ...baseProps(), onRenewed });

    const before = Date.now();
    await act(async () => {
      document.body.querySelector("button")!.click();
    });
    await act(async () => {});

    // Canonical message built and signed
    expect(wagmiMocks.useSignMessage).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/resolution-agents/${AGENT_ID}/renew`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-wallet-address"]).toBe(FUNDER);
    expect(headers["x-wallet-signature"]).toBe("0xsignature1234");
    expect(headers["x-wallet-message"]).toContain("renew_resolution_agent_policy");
    expect(headers["x-wallet-message"]).toContain(AGENT_ID);
    expect(headers["x-wallet-message"]).toContain(String(EXPIRED)); // old expiry bound

    const body = JSON.parse(init.body as string);
    const newExpiresAt = Number(body.expiresAt);
    expect(newExpiresAt).toBeGreaterThan(before + 86_000_000);
    expect(newExpiresAt).toBeLessThanOrEqual(before + 87_000_000); // +24h

    expect(onRenewed).toHaveBeenCalledTimes(1);
    expect(onRenewed).toHaveBeenCalledWith(expect.any(Number));
    expect(document.body.textContent).toContain("Policy renewed");
  });

  it("5) shows an explicit error and does not refresh on renewal failure", async () => {
    setupMocks({ connectedAddress: FUNDER });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Access denied: only the agent's funder may renew the policy." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRenewed = vi.fn();
    await mountHarness({ ...baseProps(), onRenewed });

    await act(async () => {
      document.body.querySelector("button")!.click();
    });
    await act(async () => {});

    expect(document.body.textContent).toContain("only the agent's funder may renew");
    expect(document.body.textContent).not.toContain("Policy renewed");
    expect(onRenewed).not.toHaveBeenCalled();
  });

  it("6) shows a connect hint and no renewal control when the wallet is disconnected", async () => {
    setupMocks({ connectedAddress: undefined });
    await mountHarness(baseProps());

    expect(document.body.querySelector("button")).toBeNull();
    expect(document.body.textContent).toContain("Connect the funder wallet to renew");
  });
});
