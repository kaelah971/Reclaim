// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SecureEvidenceViewer — party-gated evidence read (P4.4a, mocks only).
// No chain txs, no real RPC: readFn + signer are injected.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import { resolve } from "path";

const wagmiMocks = vi.hoisted(() => ({
  useSignMessage: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useSignMessage: wagmiMocks.useSignMessage,
}));

import SecureEvidenceViewer from "../SecureEvidenceViewer";
import type { PartyEvidence } from "@/lib/evidence/partyRead";

const VIEWER_PATH = resolve(__dirname, "..", "SecureEvidenceViewer.tsx");
function viewerSource(): string {
  return readFileSync(VIEWER_PATH, "utf-8");
}

function setupWagmi() {
  wagmiMocks.useSignMessage.mockReturnValue({
    signMessageAsync: vi.fn(async () => "0xsig"),
    signMessage: vi.fn(),
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof SecureEvidenceViewer>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SecureEvidenceViewer {...props} />);
  });
  await act(async () => {});
}

function bodyText(): string {
  return container?.textContent ?? "";
}

function clickButton(text: string): void {
  const buttons = Array.from(container?.querySelectorAll("button") ?? []);
  const target = buttons.find((b) => b.textContent?.includes(text));
  if (!target) throw new Error(`button "${text}" not found`);
  target.click();
}

const BASE = {
  paymentId: "7",
  chainId: 42220,
  walletAddress: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
  isConnected: true,
  evidenceReference: "0xabc123hash",
};

function fakeEvidence(): PartyEvidence {
  return {
    title: "Delivery title",
    claim: "Delivery claim",
    description: "Delivery note body",
    pastedText: "pasted",
    date: "2026-09-01",
    externalRef: null,
    evidenceType: "other",
    fileHash: null,
    fileCount: 1,
    evidenceReference: "0xabc123hash",
    submittedAt: "2026-09-18T00:00:00.000Z",
    submitter: "chain_verified",
    availability: "package_available",
  };
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("SecureEvidenceViewer — initial + anon", () => {
  it("renders 'View delivery evidence' with no content initially", async () => {
    setupWagmi();
    await mount({ ...BASE, readFn: vi.fn() });
    expect(bodyText()).toContain("View delivery evidence");
    expect(bodyText()).not.toContain("Delivery title");
  });

  it("anon shows hash + connect hint and never calls the read", async () => {
    setupWagmi();
    const readFn = vi.fn();
    await mount({ ...BASE, isConnected: false, walletAddress: undefined, readFn });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(readFn).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Connect your wallet");
    expect(bodyText()).toContain("0xabc123hash");
    // Never a public fallback: no content rendered.
    expect(bodyText()).not.toContain("Delivery title");
  });
});

describe("SecureEvidenceViewer — POST challenge/sign/read", () => {
  it("auth success renders title/note/date via the POST helper", async () => {
    setupWagmi();
    const signMessage = vi.fn(async () => "0xsig");
    const readFn = vi.fn(async () => fakeEvidence());
    await mount({ ...BASE, signMessage, readFn });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(readFn).toHaveBeenCalledTimes(1);
    expect(readFn).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "7",
        chainId: 42220,
        wallet: BASE.walletAddress,
      }),
    );
    const text = bodyText();
    expect(text).toContain("Delivery title");
    expect(text).toContain("Delivery note body");
    expect(text).toContain("2026-09-01");
  });

  it("signature reject clears content and offers retry with a new challenge", async () => {
    setupWagmi();
    const rejected = Object.assign(new Error("User rejected the request."), {
      code: "ACTION_REJECTED",
    });
    const readFn = vi
      .fn()
      .mockRejectedValueOnce(rejected)
      .mockResolvedValueOnce(fakeEvidence());
    await mount({ ...BASE, signMessage: vi.fn(async () => "0xsig"), readFn });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(bodyText()).toContain("Signature was not completed");
    expect(bodyText()).toContain("Try again");
    expect(bodyText()).not.toContain("Delivery title");
    // Retry requests a brand-new challenge (second call).
    await act(async () => {
      clickButton("Try again");
    });
    await act(async () => {});
    expect(readFn).toHaveBeenCalledTimes(2);
    expect(bodyText()).toContain("Delivery title");
  });

  it("expiry and replay map to fresh-challenge retry copy", async () => {
    setupWagmi();
    const expired = Object.assign(new Error("expired"), { code: "CHALLENGE_EXPIRED" });
    await mount({
      ...BASE,
      signMessage: vi.fn(async () => "0xsig"),
      readFn: vi.fn(async () => {
        throw expired;
      }),
    });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(bodyText().toLowerCase()).toContain("expired");
    expect(bodyText()).toContain("fresh challenge");
  });

  it("replay maps to already-used + fresh challenge", async () => {
    setupWagmi();
    const replay = Object.assign(new Error("used"), { code: "CHALLENGE_CONSUMED" });
    await mount({
      ...BASE,
      signMessage: vi.fn(async () => "0xsig"),
      readFn: vi.fn(async () => {
        throw replay;
      }),
    });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(bodyText()).toContain("already used");
    expect(bodyText()).toContain("fresh challenge");
  });

  it("unrelated wallet never receives content (NOT_PARTY)", async () => {
    setupWagmi();
    const denied = Object.assign(new Error("not party"), { code: "NOT_PARTY" });
    await mount({
      ...BASE,
      signMessage: vi.fn(async () => "0xsig"),
      readFn: vi.fn(async () => {
        throw denied;
      }),
    });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    expect(bodyText()).toContain("Only the client or worker");
    expect(bodyText()).not.toContain("Delivery title");
  });

  it("renders minimal material only (no private text)", async () => {
    setupWagmi();
    await mount({
      ...BASE,
      signMessage: vi.fn(async () => "0xsig"),
      readFn: vi.fn(async () => fakeEvidence()),
    });
    await act(async () => {
      clickButton("View delivery evidence");
    });
    await act(async () => {});
    const text = bodyText().toLowerCase();
    expect(text).not.toContain("reviewer");
    // No QC text is rendered.
    expect(bodyText()).not.toContain("QC");
  });
});

describe("SecureEvidenceViewer — POST-only + ephemeral source guards", () => {
  it("uses the POST-only partyRead helper and never the GET alias", () => {
    const src = viewerSource();
    expect(src).toContain("readPartyEvidence");
    expect(src).toContain("View delivery evidence");
    expect(src).toContain("signMessageAsync");
    expect(src).not.toContain('method: "GET"');
    expect(src).not.toContain("?challengeId=");
    expect(src).not.toContain("?signature=");
  });

  it("keeps evidence ephemeral (no storage, no URL params)", () => {
    const src = viewerSource();
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
    expect(src).not.toContain("URLSearchParams");
    expect(src).not.toContain("useSearchParams");
    // State lives in component memory only.
    expect(src).toContain("useState");
  });
});
