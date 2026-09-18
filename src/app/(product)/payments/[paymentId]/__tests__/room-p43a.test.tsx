// ---------------------------------------------------------------------------
// Payment Room P4.3a — wiring + lifecycle + roles (source + helper asserts,
// mocks only, no chain transactions).
//
// Verifies: explicit ?chainId= resolution with fail-closed invalid handling,
// explicit chain threading into reads + accept/requestRelease (+ fund),
// lifecycle label mapping, role gating, wrong-network switch plumbing,
// attribution/simulate retention, receipt-confirm/state-refresh, gas + share,
// Sepolia regression, and EvidenceMap byte-identity.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getPaymentLifecycleLabel,
  parseChainIdParam,
} from "@/components/payment/paymentLifecycle";
import { buildPaymentSharePath } from "@/components/payment/SharePaymentLink";

const ROOM_PATH = resolve(__dirname, "..", "page.tsx");

function roomSource(): string {
  return readFileSync(ROOM_PATH, "utf-8");
}

describe("room — chain-explicit resolution (?chainId=)", () => {
  it("resolves chain from URL via useSearchParams + validated parsing", () => {
    const src = roomSource();
    expect(src).toContain("useSearchParams");
    expect(src).toContain("parseChainIdParam");
    expect(src).toContain('get("chainId")');
  });

  it("fails closed on malformed/unsupported chainId with explicit notice", () => {
    const src = roomSource();
    expect(src).toContain("isChainInvalid");
    expect(src).toContain("Unsupported network");
    expect(src).toContain("unsupported network");
    // Lists both supported networks explicitly.
    expect(src).toContain("42220");
    expect(src).toContain("11142220");
  });

  it("does not silently fall back to Sepolia for invalid links", () => {
    const src = roomSource();
    // Invalid branch returns before any payment read rendering.
    const invalidIdx = src.indexOf("isChainInvalid");
    const unsupportedIdx = src.indexOf("Unsupported network");
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(unsupportedIdx).toBeGreaterThan(-1);
    expect(unsupportedIdx).toBeGreaterThan(invalidIdx);
  });

  it("preserves default behavior when ?chainId= is absent", () => {
    const src = roomSource();
    // Absent → default Sepolia chain constant (existing behavior).
    expect(src).toContain("CELO_CHAIN_ID");
    expect(src).toContain("explicitChainId ?? CELO_CHAIN_ID");
  });
});

describe("room — explicit chain threading (reads + writes)", () => {
  it("threads explicit chainId into the payment read", () => {
    expect(roomSource()).toContain("usePayment(paymentId, activeChainId)");
  });

  it("threads explicit chainId into token approval reads", () => {
    expect(roomSource()).toContain("useTokenApproval(activeChainId)");
  });

  it("threads explicit chainId into accept + requestRelease", () => {
    const src = roomSource();
    expect(src).toContain("useAcceptPayment(activeChainId)");
    expect(src).toContain("useRequestRelease(activeChainId)");
  });

  it("threads explicit chainId into fund/create paths (no redesign)", () => {
    const src = roomSource();
    expect(src).toContain("useFundPayment(activeChainId)");
    expect(src).toContain("useApproveRelease(activeChainId)");
    expect(src).toContain("useOpenDispute(activeChainId)");
    expect(src).toContain("useCancelUnfunded(activeChainId)");
  });

  it("passes explicit 42220 (chain-aware token + explorer)", () => {
    const src = roomSource();
    expect(src).toContain("CELO_MAINNET_CHAIN_ID");
    expect(src).toContain("getPaymentTokenConfig(activeChainId)");
    expect(src).toContain("getCeloMainnetExplorerTxUrl");
  });

  it("share URL is canonical with validated chainId", () => {
    expect(buildPaymentSharePath("9", 42220)).toBe(
      "/payments/9?chainId=42220",
    );
    expect(roomSource()).toContain("SharePaymentLink");
    expect(roomSource()).toContain("chainId={activeChainId}");
  });
});

describe("room — lifecycle labels (exact)", () => {
  it("maps Funded→Protected, DeliverySubmitted→Delivered, ReleaseRequested→Release requested, Released→Released", () => {
    expect(getPaymentLifecycleLabel("Funded")).toBe("Protected");
    expect(getPaymentLifecycleLabel("DeliverySubmitted")).toBe("Delivered");
    expect(getPaymentLifecycleLabel("ReleaseRequested")).toBe(
      "Release requested",
    );
    expect(getPaymentLifecycleLabel("Released")).toBe("Released");
    expect(getPaymentLifecycleLabel("Accepted")).toBe("Accepted");
  });

  it("Created never reads protected", () => {
    expect(getPaymentLifecycleLabel("Created")).toBe("Created");
  });

  it("room uses the lifecycle helper for the money strip", () => {
    const src = roomSource();
    expect(src).toContain("getPaymentLifecycleLabel(payment.state)");
    expect(src).toContain("state={lifecycleLabel}");
  });

  it("timeline is lifecycle-accurate", () => {
    const src = roomSource();
    expect(src).toContain('statusLabel: "Protected"');
    expect(src).toContain('statusLabel: "Delivered"');
    expect(src).toContain('statusLabel: "Release requested"');
    expect(src).toContain('statusLabel: "Released"');
  });
});

describe("room — roles + landing", () => {
  it("derives roles from canonical on-chain data (contract final authority)", () => {
    const src = roomSource();
    expect(src).toContain("getUserRole(payment, wallet.address)");
    expect(src).toContain("final authority");
  });

  it("anonymous gets the safe read-only freelancer landing", () => {
    const src = roomSource();
    expect(src).toContain("!wallet.isConnected");
    expect(src).toContain("FreelancerLanding");
    // The exact protection sentence lives in the landing component (safe,
    // funded-only) — the room wires it for anonymous viewers.
    const landingSrc = readFileSync(
      resolve(__dirname, "..", "..", "..", "..", "..", "components", "payment", "FreelancerLanding.tsx"),
      "utf-8",
    );
    expect(landingSrc).toContain(
      "Your payment is protected in the Reclaim contract.",
    );
  });

  it("unrelated wallets are read-only with no privileged controls", () => {
    const src = roomSource();
    expect(src).toContain('role === "viewer"');
    expect(src).toContain("read-only");
    // Viewer block contains no privileged write calls.
    const viewerIdx = src.indexOf('role === "viewer"');
    const viewerBlock = src.slice(viewerIdx, viewerIdx + 1500);
    expect(viewerBlock).not.toContain("acceptPayment.action");
    expect(viewerBlock).not.toContain("requestRelease.action");
    expect(viewerBlock).not.toContain("fundPayment.action");
    expect(viewerBlock).not.toContain("approveRelease.action");
  });

  it("worker accept path is role-gated with honest pending/success/error", () => {
    const src = roomSource();
    expect(src).toContain("Accept terms");
    expect(src).toContain("acceptPayment.action(payment.id)");
    expect(src).toContain("acceptPayment.isPending");
    expect(src).toContain("acceptPayment.isSuccess");
    expect(src).toContain("acceptPayment.error");
    expect(src).toContain("acceptPayment.txHash");
  });

  it("requestRelease path is role-gated with honest states", () => {
    const src = roomSource();
    expect(src).toContain("Request release");
    expect(src).toContain("requestRelease.action(payment.id)");
    expect(src).toContain("requestRelease.isPending");
    expect(src).toContain("requestRelease.isSuccess");
    expect(src).toContain("requestRelease.error");
  });

  it("wrong-network shows targetable Switch to Celo", () => {
    const src = roomSource();
    expect(src).toContain("isWrongNetwork");
    expect(src).toContain("requestNetworkSwitch(activeChainId)");
    expect(src).toContain("Switch to {chainDisplayName}");
  });

  it("worker gas readiness is shown (no exact-gas promise, no faucet)", () => {
    const src = roomSource();
    expect(src).toContain("WorkerGasNotice");
    expect(src.toLowerCase()).not.toContain("faucet");
  });

  it("failure does not advance UI (no fake success)", () => {
    const src = roomSource();
    // Errors render via TxStatus; success requires confirmed receipt hash.
    expect(src).toContain("TxStatus");
    expect(src).toContain("isSuccess && txHash");
    expect(src).not.toContain("isSuccess = true");
  });
});

describe("room — attribution + receipt-confirm + refresh", () => {
  it("retains attribution + simulate-before-write via hooks (no bypass)", () => {
    const escrowSrc = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "hooks",
        "contracts",
        "useEscrowActions.ts",
      ),
      "utf-8",
    );
    expect(escrowSrc).toContain("getAttributionDataSuffix");
    expect(escrowSrc).toContain("simulateContract");
    // Room calls hooks — never writes directly.
    const src = roomSource();
    expect(src).not.toContain("writeContract(");
    expect(src).toContain("useAcceptPayment(activeChainId)");
    expect(src).toContain("useRequestRelease(activeChainId)");
  });

  it("confirms receipt with explorer link + refreshes state", () => {
    const src = roomSource();
    expect(src).toContain("confirmed.");
    expect(src).toContain("View on Celo Explorer");
    expect(src).toContain("refetchPayment()");
    expect(src).toContain("acceptPayment.isSuccess");
    expect(src).toContain("requestRelease.isSuccess");
  });
});

describe("room — Sepolia regression + evidence safety", () => {
  it("keeps Sepolia supported (no removal)", () => {
    const src = roomSource();
    expect(src).toContain("CELO_CHAIN_ID");
    expect(src).toContain("11142220");
    expect(parseChainIdParam("11142220")).toEqual({
      status: "explicit",
      chainId: 11142220,
    });
  });

  it("leaves EvidenceMap import/usage byte-identical", () => {
    const src = roomSource();
    expect(src).toContain(
      'import EvidenceMap, {\n  type EvidenceItemData,\n} from "@/components/payment/EvidenceMap";',
    );
    expect(src).toContain("<EvidenceMap items={evidenceItems} />");
  });

  it("keeps existing room navigation (evidence/agent/review/receipt)", () => {
    const src = roomSource();
    expect(src).toContain("Update evidence");
    expect(src).toContain(`/payments/\${paymentIdStr}/evidence`);
    expect(src).toContain("Request release");
    expect(src).toContain("Open Resolution Agent");
    expect(src).toContain(`/payments/\${paymentIdStr}/agent`);
    expect(src).toContain("hasReviewPacket");
    expect(src).toContain("Review case");
    expect(src).toContain(`/payments/\${paymentIdStr}/review`);
    expect(src).toContain(`/api/payments/\${paymentIdStr}/review-packet`);
    expect(src).toContain("View receipt");
    expect(src).toContain(`/receipts/\${paymentIdStr}`);
    expect(src).toContain("Receipt");
  });

  it("never exposes plaintext evidence", () => {
    const src = roomSource();
    expect(src).not.toContain("evidenceFile");
    expect(src).not.toContain("plaintext");
  });
});

describe("room — chainId propagation to sub-routes (preserve-or-propagate)", () => {
  it("builds an explicit-only chainQuery suffix (empty when absent)", () => {
    const src = roomSource();
    expect(src).toContain("const chainQuery");
    expect(src).toContain("explicitChainId !== undefined");
    expect(src).toContain("`?chainId=${explicitChainId}`");
    expect(src).toContain(': ""');
  });

  it("appends chainQuery to all evidence/dispute/review/agent links", () => {
    const src = roomSource();
    expect(src).toContain(`/payments/\${paymentIdStr}/evidence\${chainQuery}`);
    expect(src).toContain(`/payments/\${paymentIdStr}/dispute\${chainQuery}`);
    expect(src).toContain(`/payments/\${paymentIdStr}/review\${chainQuery}`);
    expect(src).toContain(`/payments/\${paymentIdStr}/agent\${chainQuery}`);
  });

  it("leaves receipt + default chain untouched", () => {
    const src = roomSource();
    // Receipt stays chain-free; default chain resolution is unchanged.
    expect(src).toContain(`/receipts/\${paymentIdStr}`);
    expect(src).not.toContain(`receipts/\${paymentIdStr}\${chainQuery}`);
    expect(src).toContain("explicitChainId ?? CELO_CHAIN_ID");
  });

  it("includes chainId in the review-packet fetch when present", () => {
    const src = roomSource();
    expect(src).toContain(
      `/api/payments/\${paymentIdStr}/review-packet\${chainQuery}`,
    );
    expect(src).toContain("[paymentIdStr, chainQuery]");
  });

  it("does not hardcode ?chainId= in sub-route hrefs (propagation only via chainQuery)", () => {
    const src = roomSource();
    expect(src).not.toContain("/evidence?chainId=");
    expect(src).not.toContain("/dispute?chainId=");
    expect(src).not.toContain("/review?chainId=");
    expect(src).not.toContain("/agent?chainId=");
  });
});

describe("agent/review — chainId preserve-or-propagate", () => {
  it("agent propagates explicit chainId to review/room links + packet fetch", () => {
    const agentSrc = readFileSync(
      resolve(__dirname, "..", "agent", "page.tsx"),
      "utf-8",
    );
    expect(agentSrc).toContain("parseChainIdParam");
    expect(agentSrc).toContain("const chainQuery");
    expect(agentSrc).toContain(
      `/api/payments/\${paymentId}/review-packet\${chainQuery}`,
    );
    expect(agentSrc).toContain(`/payments/\${paymentId}/review\${chainQuery}`);
    expect(agentSrc).toContain(`/payments/\${paymentId}\${chainQuery}`);
    expect(agentSrc).toContain(
      `reviewHref={\`/payments/\${paymentId}/review\${chainQuery}\`}`,
    );
  });

  it("review propagates explicit chainId to room/dispute links + packet fetch", () => {
    const reviewSrc = readFileSync(
      resolve(__dirname, "..", "review", "page.tsx"),
      "utf-8",
    );
    expect(reviewSrc).toContain("parseChainIdParam");
    expect(reviewSrc).toContain("const chainQuery");
    expect(reviewSrc).toContain(
      `/api/payments/\${paymentIdStr}/review-packet\${chainQuery}`,
    );
    expect(reviewSrc).toContain(`/payments/\${paymentIdStr}\${chainQuery}`);
    expect(reviewSrc).toContain(
      `/payments/\${paymentIdStr}/dispute\${chainQuery}`,
    );
  });

  it("agent/review default to empty suffix when absent (no hardcoded query)", () => {
    for (const rel of ["../agent/page.tsx", "../review/page.tsx"]) {
      const src = readFileSync(resolve(__dirname, rel), "utf-8");
      expect(src).toContain(': ""');
      expect(src).not.toContain("/review?chainId=");
      expect(src).not.toContain("/dispute?chainId=");
    }
  });
});
