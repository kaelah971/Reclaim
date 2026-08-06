// ---------------------------------------------------------------------------
// Resolution Agent API — Security Boundary Tests
//
// Ensures that the public barrel (../../index) does NOT leak server-only or
// API-internal implementation details.  The public view must NEVER contain
// encrypted wallet secrets, and no NEXT_PUBLIC encryption key env var must
// exist in the client bundle.
//
// HARDENED: additional checks that escrow reader internals and canonical
// addresses are not exposed through the public barrel.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ResolutionAgent } from "../../types";
import { toResolutionAgentPublicView } from "../../public-view";

// ---------------------------------------------------------------------------
// Test Fixture
// ---------------------------------------------------------------------------

function makeAgentWithEncryptedSecret() {
  return {
    id: "agent_boundary_api_1",
    goal: "Prepare this payment case for fair human review." as const,
    status: "active" as const,
    identity: {
      escrowPaymentId: "pay_boundary_api_1",
      escrowChainId: "eip155:11142220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: [
        "evidence-quality-check",
        "case-refresh",
        "reclaim-dispute-brief-v1",
      ] as const,
      approvedBudgetAtomic: 30000n,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      funderAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    budget: {
      approvedAtomic: 30000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: null,
    caseWalletAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    encryptedSecret: {
      version: 1 as const,
      algorithm: "AES-256-GCM" as const,
      ciphertext: "TOP-SECRET-CIPHERTEXT-DO-NOT-EXPOSE",
      iv: "TOP-SECRET-IV-DO-NOT-EXPOSE",
      authenticationTag: "TOP-SECRET-TAG-DO-NOT-EXPOSE",
    },
    settledToolIds: [] as string[],
    currentRunningToolId: null as string | null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activatedAt: null as number | null,
    pausedAt: null as number | null,
    closedAt: null as number | null,
  };
}

// ---------------------------------------------------------------------------
// Public Barrel — server-only exports must NOT appear
// ---------------------------------------------------------------------------

describe("Public barrel (../../index) does NOT export API internals", () => {
  it("does not export createResolutionAgentForCase", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).createResolutionAgentForCase,
    ).toBeUndefined();
  });

  it("does not export activateResolutionAgent", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).activateResolutionAgent,
    ).toBeUndefined();
  });

  it("does not export refreshFundingStatus", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).refreshFundingStatus,
    ).toBeUndefined();
  });

  it("does not export getResolutionAgentPublicView", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).getResolutionAgentPublicView,
    ).toBeUndefined();
  });

  it("does not export CeloMainnetFundingReader", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).CeloMainnetFundingReader,
    ).toBeUndefined();
  });

  it("does not export buildCreateAgentMessage", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).buildCreateAgentMessage,
    ).toBeUndefined();
  });

  it("does not export buildActivationMessage", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).buildActivationMessage,
    ).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // HARDENED: escrow reader and canonical constants must NOT leak
  // -----------------------------------------------------------------------

  it("EscrowCaseReader functions ARE NOT in the public barrel", async () => {
    const PublicBarrel = await import("../../index");
    const keys = Object.keys(PublicBarrel as Record<string, unknown>);
    // Neither the interface nor the implementations should be exported
    expect(keys).not.toContain("EscrowCaseReader");
    expect(keys).not.toContain("MockEscrowCaseReader");
    expect(keys).not.toContain("CeloSepoliaEscrowCaseReader");
    expect(keys).not.toContain("getCaseParties");
  });

  it("CANONICAL_ESCROW_CONTRACT_ADDRESS is NOT in the public barrel", async () => {
    const PublicBarrel = await import("../../index");
    const keys = Object.keys(PublicBarrel as Record<string, unknown>);
    expect(keys).not.toContain("CANONICAL_ESCROW_CONTRACT_ADDRESS");
  });

  it("CANONICAL_ESCROW_CHAIN_ID is NOT in the public barrel", async () => {
    const PublicBarrel = await import("../../index");
    const keys = Object.keys(PublicBarrel as Record<string, unknown>);
    expect(keys).not.toContain("CANONICAL_ESCROW_CHAIN_ID");
  });

  it("CaseParties type is NOT in the public barrel (internal type)", async () => {
    const PublicBarrel = await import("../../index");
    const keys = Object.keys(PublicBarrel as Record<string, unknown>);
    // CaseParties is a type export — it won't appear as a runtime key,
    // but we verify no string export with that name exists
    expect(keys).not.toContain("CaseParties");
  });
});

// ---------------------------------------------------------------------------
// Public View — encrypted secret must never leak
// ---------------------------------------------------------------------------

describe("Public view NEVER contains encryptedSecret", () => {
  it("toResolutionAgentPublicView excludes encryptedSecret field", () => {
    const agent = makeAgentWithEncryptedSecret();
    const view = toResolutionAgentPublicView(agent as unknown as ResolutionAgent);
    const raw = view as unknown as Record<string, unknown>;

    expect(raw).not.toHaveProperty("encryptedSecret");
  });

  it("toResolutionAgentPublicView excludes ciphertext", () => {
    const agent = makeAgentWithEncryptedSecret();
    const view = toResolutionAgentPublicView(agent as unknown as ResolutionAgent);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("TOP-SECRET-CIPHERTEXT-DO-NOT-EXPOSE");
    expect(serialized).not.toContain("\"ciphertext\":");
  });

  it("toResolutionAgentPublicView excludes IV", () => {
    const agent = makeAgentWithEncryptedSecret();
    const view = toResolutionAgentPublicView(agent as unknown as ResolutionAgent);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("TOP-SECRET-IV-DO-NOT-EXPOSE");
    expect(serialized).not.toContain("\"iv\":");
  });

  it("toResolutionAgentPublicView excludes authenticationTag", () => {
    const agent = makeAgentWithEncryptedSecret();
    const view = toResolutionAgentPublicView(agent as unknown as ResolutionAgent);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("TOP-SECRET-TAG-DO-NOT-EXPOSE");
    expect(serialized).not.toContain("\"authenticationTag\":");
  });

  it("public view JSON has no deep encryption keys", () => {
    const agent = makeAgentWithEncryptedSecret();
    const view = toResolutionAgentPublicView(agent as unknown as ResolutionAgent);
    const serialized = JSON.stringify(view);

    const forbiddenSubstrings = [
      "ciphertext",
      "encryptedSecret",
      "authenticationTag",
    ];
    for (const sub of forbiddenSubstrings) {
      expect(serialized).not.toMatch(new RegExp(`"${sub}"\\s*:`));
    }
  });
});

// ---------------------------------------------------------------------------
// NEXT_PUBLIC env var leak prevention
// ---------------------------------------------------------------------------

describe("No NEXT_PUBLIC encryption key env var", () => {
  it("no NEXT_PUBLIC resolution agent wallet encryption key", () => {
    const publicKeyVars = Object.keys(process.env).filter(
      (k) =>
        (k.includes("RESOLUTION_AGENT") || k.includes("WALLET_ENCRYPTION")) &&
        k.startsWith("NEXT_PUBLIC"),
    );
    expect(publicKeyVars).toHaveLength(0);
  });

  it("no NEXT_PUBLIC variable contains 'encryption' in name", () => {
    const encryptionVars = Object.keys(process.env).filter(
      (k) =>
        k.startsWith("NEXT_PUBLIC") &&
        k.toLowerCase().includes("encrypt"),
    );
    expect(encryptionVars).toHaveLength(0);
  });

  it("server-side encryption key env var is NOT prefixed NEXT_PUBLIC", () => {
    const allEncryptionVars = Object.keys(process.env).filter(
      (k) => k.includes("WALLET_ENCRYPTION_KEY"),
    );
    const nextPublicEncryptionVars = allEncryptionVars.filter((k) =>
      k.startsWith("NEXT_PUBLIC"),
    );
    expect(nextPublicEncryptionVars).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Service barrel exports — confirm service functions are accessible
// via the service module, not the public barrel
// ---------------------------------------------------------------------------

describe("Service barrel (../service) exports service functions", () => {
  it("exports createResolutionAgentForCase", { timeout: 30000 }, async () => {
    const mod = await import("../service");
    expect(typeof mod.createResolutionAgentForCase).toBe("function");
  });

  it("exports activateResolutionAgent", { timeout: 15000 }, async () => {
    const mod = await import("../service");
    expect(typeof mod.activateResolutionAgent).toBe("function");
  });

  it("exports refreshFundingStatus", async () => {
    const mod = await import("../service");
    expect(typeof mod.refreshFundingStatus).toBe("function");
  });

  it("exports getResolutionAgentPublicView", async () => {
    const mod = await import("../service");
    expect(typeof mod.getResolutionAgentPublicView).toBe("function");
  });

  it("does NOT export CeloMainnetFundingReader from service", async () => {
    // The funding reader should be imported directly from ../funding,
    // not re-exported through the service module.
    const mod = await import("../service");
    expect(
      (mod as Record<string, unknown>).CeloMainnetFundingReader,
    ).toBeUndefined();
  });
});
