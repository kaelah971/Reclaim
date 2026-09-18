// ---------------------------------------------------------------------------
// Payment Room P4.4a — client review → release → released (source + helper
// asserts, mocks only, no chain transactions).
//
// Verifies: client review area + SecureEvidenceViewer + ReleasePreflight
// wiring in the room, role gating (worker/unrelated/anon see no release
// controls), POST-only partyRead flow, error/retry copy, preflight exactness,
// wrong-network targeting, explicit approveRelease chain, attribution,
// no-optimistic settlement, confirmed-refresh + stale-never-rebroadcast,
// Released summary (client/worker), and Sepolia regression.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseChainIdParam } from "@/components/payment/paymentLifecycle";

const ROOM_PATH = resolve(__dirname, "..", "page.tsx");
const VIEWER_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "components",
  "payment",
  "SecureEvidenceViewer.tsx",
);
const PREFLIGHT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "components",
  "payment",
  "ReleasePreflight.tsx",
);
const SUMMARY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "components",
  "payment",
  "ReleasedSummary.tsx",
);
const ESCROW_HOOK_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "hooks",
  "contracts",
  "useEscrowActions.ts",
);

function roomSource(): string {
  return readFileSync(ROOM_PATH, "utf-8").replace(/\r\n/g, "\n");
}
function viewerSource(): string {
  return readFileSync(VIEWER_PATH, "utf-8").replace(/\r\n/g, "\n");
}
function preflightSource(): string {
  return readFileSync(PREFLIGHT_PATH, "utf-8").replace(/\r\n/g, "\n");
}
function summarySource(): string {
  return readFileSync(SUMMARY_PATH, "utf-8").replace(/\r\n/g, "\n");
}
function escrowSource(): string {
  return readFileSync(ESCROW_HOOK_PATH, "utf-8").replace(/\r\n/g, "\n");
}

/** Slice a branch from its marker to the next `} else if` (isolated block). */
function branchSlice(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) return "";
  const next = src.indexOf("} else if", start + marker.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe("room P4.4a — client review area", () => {
  it("renders 'Review delivery' with full canonical detail for DeliverySubmitted + ReleaseRequested clients", () => {
    const src = roomSource();
    expect(src).toContain("Review delivery");
    // Canonical detail labels (amount/token/freelancer/network/terms/status/
    // delivery timestamp/evidence hash) appear in the client review blocks.
    for (const label of [
      "Freelancer",
      "Evidence hash",
      "Delivered",
      "Terms",
      "Status",
      "Network",
      "Amount",
    ]) {
      expect(src).toContain(label);
    }
    expect(src).toContain("payment.evidenceReference");
    expect(src).toContain("payment.deliveryAt");
    expect(src).toContain("lifecycleLabel");
    expect(src).toContain("chainDisplayName");
  });

  it("wires SecureEvidenceViewer with canonical payment + wallet + chain", () => {
    const src = roomSource();
    expect(src).toContain(
      'import SecureEvidenceViewer from "@/components/payment/SecureEvidenceViewer"',
    );
    expect(src).toContain("<SecureEvidenceViewer");
    expect(src).toContain("evidenceReference={payment.evidenceReference}");
    expect(src).toContain("walletAddress={wallet.address}");
    expect(src).toContain("isConnected={wallet.isConnected}");
    expect(src).toContain("chainId={activeChainId}");
  });

  it("wires ReleasePreflight with explicit chain + canonical state + refresh", () => {
    const src = roomSource();
    expect(src).toContain(
      'import ReleasePreflight from "@/components/payment/ReleasePreflight"',
    );
    expect(src).toContain("<ReleasePreflight");
    expect(src).toContain("amountLabel={formatUSDC(payment.amount)}");
    expect(src).toContain("workerAddress={payment.worker}");
    expect(src).toContain("networkName={chainDisplayName}");
    expect(src).toContain("targetChainId={activeChainId}");
    expect(src).toContain("chainId={activeChainId}");
    expect(src).toContain("canonicalState={payment.state}");
    expect(src).toContain("onRefresh={() => refetchPayment()}");
    expect(src).toContain("approveRelease.action(payment.id)");
  });
});

describe("room P4.4a — role gating (no release controls for others)", () => {
  it("worker branches show status only (no client review/preflight)", () => {
    const src = roomSource();
    // Isolate the DeliverySubmitted+worker branch (role-gated marker).
    const deliveryWorkerMarker = 'payment.state === "DeliverySubmitted" &&\n    role === "worker"';
    const deliveryWorker = branchSlice(src, deliveryWorkerMarker);
    expect(deliveryWorker).not.toBe("");
    expect(deliveryWorker).toContain("Request release");
    expect(deliveryWorker).not.toContain("Review delivery");
    expect(deliveryWorker).not.toContain("ReleasePreflight");
    expect(deliveryWorker).not.toContain("SecureEvidenceViewer");
    expect(deliveryWorker).not.toContain("Release payment");

    // ReleaseRequested+worker branch (status only).
    const releaseWorkerMarker = 'payment.state === "ReleaseRequested" &&\n    role === "worker"';
    const releaseWorkerBlock = branchSlice(src, releaseWorkerMarker);
    expect(releaseWorkerBlock).not.toBe("");
    expect(releaseWorkerBlock).toContain("Waiting for the client");
    expect(releaseWorkerBlock).not.toContain("ReleasePreflight");
    expect(releaseWorkerBlock).not.toContain("SecureEvidenceViewer");
    expect(releaseWorkerBlock).not.toContain("Release payment");

    // Client branches carry the review + preflight.
    const releaseClientMarker = 'payment.state === "ReleaseRequested" &&\n    role === "client"';
    expect(branchSlice(src, releaseClientMarker)).toContain("Review delivery");
  });

  it("unrelated wallets stay read-only with no privileged controls", () => {
    const src = roomSource();
    const viewerIdx = src.indexOf('role === "viewer"');
    const viewerBlock = src.slice(viewerIdx, viewerIdx + 1500);
    expect(viewerBlock).toContain("read-only");
    expect(viewerBlock).not.toContain("approveRelease.action");
    expect(viewerBlock).not.toContain("ReleasePreflight");
    expect(viewerBlock).not.toContain("SecureEvidenceViewer");
    expect(viewerBlock).not.toContain("Release payment");
  });

  it("anonymous stays read-only via the landing (no release controls)", () => {
    const src = roomSource();
    const anonIdx = src.indexOf("!wallet.isConnected");
    const anonBlock = src.slice(anonIdx, anonIdx + 800);
    expect(anonBlock).toContain("FreelancerLanding");
    expect(anonBlock).not.toContain("approveRelease.action");
    expect(anonBlock).not.toContain("ReleasePreflight");
    expect(anonBlock).not.toContain("Release payment");
  });
});

describe("room P4.4a — evidence POST challenge/sign/read", () => {
  it("viewer uses the POST-only partyRead helper with wallet signing", () => {
    const src = viewerSource();
    expect(src).toContain("readPartyEvidence");
    expect(src).toContain("View delivery evidence");
    expect(src).toContain("signMessageAsync");
    expect(src).not.toContain('method: "GET"');
    expect(src).not.toContain("?challengeId=");
    expect(src).not.toContain("?signature=");
  });

  it("anon is denied to hash + retry (never a public fallback)", () => {
    const src = viewerSource();
    expect(src).toContain("!isConnected");
    expect(src).toContain("Connect your wallet");
    expect(src).toContain("evidenceReference");
  });

  it("reject/expire/replay map to clear errors with fresh-challenge retry", () => {
    const src = viewerSource();
    expect(src).toContain("CHALLENGE_EXPIRED");
    expect(src).toContain("CHALLENGE_CONSUMED");
    expect(src).toContain("SIGNATURE_INVALID");
    expect(src).toContain("NOT_PARTY");
    expect(src).toContain("Try again");
    expect(src).toContain("fresh challenge");
  });

  it("keeps evidence ephemeral and minimal", () => {
    const src = viewerSource();
    expect(src).toContain("useState");
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
    expect(src).not.toContain("URLSearchParams");
    expect(src).not.toContain("useSearchParams");
  });
});

describe("room P4.4a — preflight exactness + chain + attribution", () => {
  it("preflight shows exact amount/worker/network with a calm finality note", () => {
    const src = preflightSource();
    expect(src).toContain("Release payment");
    expect(src).toContain("amountLabel");
    expect(src).toContain("tokenSymbol");
    expect(src).toContain("workerAddress");
    expect(src).toContain("networkName");
    expect(src).toContain("To worker");
    expect(src).toContain("cannot be undone");
    expect(src).toContain("Take a moment");
  });

  it("wrong network targets the payment chain via the existing switch", () => {
    expect(roomSource()).toContain("targetChainId={activeChainId}");
    expect(roomSource()).toContain("onRequestSwitch={(cid) => requestNetworkSwitch(cid)}");
    expect(roomSource()).toContain("requestNetworkSwitch(activeChainId)");
    expect(preflightSource()).toContain("onRequestSwitch(targetChainId)");
    expect(preflightSource()).toContain("Switch to");
  });

  it("approveRelease uses the explicit chain with hook-held attribution/simulate", () => {
    expect(roomSource()).toContain("useApproveRelease(activeChainId)");
    expect(roomSource()).toContain("CELO_MAINNET_CHAIN_ID");
    expect(roomSource()).toContain("getPaymentTokenConfig(activeChainId)");
    expect(roomSource()).not.toContain("writeContract(");
    expect(escrowSource()).toContain("getAttributionDataSuffix");
    expect(escrowSource()).toContain("simulateContract");
  });
});

describe("room P4.4a — no optimistic settlement + refresh discipline", () => {
  it("never fakes Released from local tx state", () => {
    expect(preflightSource()).not.toContain("Payment released");
    // Released rendering requires the canonical on-chain state.
    expect(roomSource()).toContain('payment.state === "Released"');
  });

  it("confirmed release refreshes canonical state", () => {
    const src = roomSource();
    expect(src).toContain("approveRelease.isSuccess");
    expect(src).toContain("refetchPayment()");
    expect(src).toContain("onRefresh={() => refetchPayment()}");
    // The refresh affordance itself lives in the preflight component.
    expect(preflightSource()).toContain("Refresh payment data");
  });

  it("stale reads refresh instead of rebroadcasting", () => {
    const src = preflightSource();
    expect(src).toContain('canonicalState !== "Released"');
    expect(src).toContain("Do not resubmit");
    expect(src).toContain("Refresh payment data");
    expect(src).not.toContain("useEffect");
    expect(src).not.toContain("writeContract(");
  });
});

describe("room P4.4a — Released success", () => {
  it("Released branch renders the canonical summary with receipt + copy (no release action)", () => {
    const src = roomSource();
    expect(src).toContain(
      'import ReleasedSummary from "@/components/payment/ReleasedSummary"',
    );
    expect(src).toContain("<ReleasedSummary");
    expect(src).toContain("receiptLabel=\"View receipt\"");
    expect(src).toContain(`/receipts/\${paymentIdStr}`);
    const releasedBlock = branchSlice(src, 'payment.state === "Released"');
    expect(releasedBlock).toContain("View receipt");
    expect(releasedBlock).toContain(`/receipts/\${paymentIdStr}`);
    expect(releasedBlock).not.toContain("approveRelease.action");
    expect(releasedBlock).not.toContain("Release payment");
  });

  it("worker settled view derives from canonical Released state", () => {
    const src = summarySource();
    expect(src).toContain("Payment received");
    expect(src).toContain("Payment released");
    expect(src).toContain('role === "worker"');
    expect(src).toContain("canonical");
    expect(roomSource()).toContain("role={");
  });

  it("summary carries amount/worker/network/id/tx/explorer/time + receipt + copy", () => {
    const src = summarySource();
    for (const token of [
      "amountLabel",
      "tokenSymbol",
      "workerAddress",
      "networkName",
      "paymentId",
      "txHash",
      "releasedAtLabel",
      "View on Celo Explorer",
      "View receipt",
      "Copy payment link",
    ]) {
      expect(src).toContain(token);
    }
    expect(src).not.toContain("approveRelease.action");
    expect(src).not.toContain("Release payment");
  });
});

describe("room P4.4a — Sepolia regression", () => {
  it("keeps Sepolia supported end-to-end", () => {
    expect(roomSource()).toContain("CELO_CHAIN_ID");
    expect(roomSource()).toContain("11142220");
    expect(parseChainIdParam("11142220")).toEqual({
      status: "explicit",
      chainId: 11142220,
    });
    expect(parseChainIdParam("42220")).toEqual({
      status: "explicit",
      chainId: 42220,
    });
    expect(preflightSource()).toContain("getCeloExplorerTxUrl");
    expect(summarySource()).toContain("getCeloExplorerTxUrl");
  });
});
