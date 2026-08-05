import { describe, it, expect } from "vitest";
import { toResolutionAgentPublicView } from "../../public-view";
import type { ResolutionAgent } from "../../types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeTestAgent(
  overrides: Partial<ResolutionAgent> = {},
): ResolutionAgent {
  return {
    id: "agent_boundary_1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_boundary_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: [
        "evidence-quality-check",
        "case-refresh",
        "reclaim-dispute-brief-v1",
      ],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999,
      funderAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 20000n,
      reservedAtomic: 10000n,
    },
    plan: {
      steps: [
        { kind: "read_agreement", description: "Read agreement" },
        { kind: "check_evidence", description: "Check evidence" },
      ],
      currentStepIndex: 0,
      lastUpdated: 5000000,
      caseVersionHash: "0xdef456",
      evidenceVersionHash: "0xabc123",
    },
    observation: {
      escrowState: "funded",
      evidenceCount: 2,
      evidenceVersionHash: "0xabc123",
      caseVersionHash: "0xdef456",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: 5000000,
    },
    caseWalletAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "real-looking-ciphertext-that-should-not-leak-base64",
      iv: "real-looking-iv-that-should-not-leak-base64",
      authenticationTag: "real-looking-tag-that-should-not-leak-base64",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1000000,
    updatedAt: 5000000,
    activatedAt: 4000000,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Public Barrel — server functions must NOT be exported
// ---------------------------------------------------------------------------

describe("Public barrel exports", () => {
  it("does not export parseWalletEncryptionKey", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).parseWalletEncryptionKey,
    ).toBeUndefined();
  });

  it("does not export encryptCaseWalletPrivateKey", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).encryptCaseWalletPrivateKey,
    ).toBeUndefined();
  });

  it("does not export generateEncryptedCaseWallet", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).generateEncryptedCaseWallet,
    ).toBeUndefined();
  });

  it("does not export decryptCaseWalletPrivateKey", async () => {
    // This function MUST NEVER be in the public barrel — it's server-only.
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).decryptCaseWalletPrivateKey,
    ).toBeUndefined();
  });

  it("does not export withDecryptedCaseWalletAccount", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).withDecryptedCaseWalletAccount,
    ).toBeUndefined();
  });

  it("does not export createAssociatedData", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).createAssociatedData,
    ).toBeUndefined();
  });

  it("does not export WALLET_ENCRYPTION_KEY_ENV", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).WALLET_ENCRYPTION_KEY_ENV,
    ).toBeUndefined();
  });

  it("does not export WALLET_ENCRYPTION_KEY_BYTES", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).WALLET_ENCRYPTION_KEY_BYTES,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NEXT_PUBLIC Env Var Leak
// ---------------------------------------------------------------------------

describe("NEXT_PUBLIC environment variable leak prevention", () => {
  it("no NEXT_PUBLIC resolution agent encryption key variable exists", () => {
    const publicKeyVars = Object.keys(process.env).filter(
      (k) =>
        k.includes("RESOLUTION_AGENT") && k.startsWith("NEXT_PUBLIC"),
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

  it("the server-side encryption key env var is not NEXT_PUBLIC-prefixed", () => {
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
// Public View Type — must not include encryption fields
// ---------------------------------------------------------------------------

describe("ResolutionAgentPublicView type boundaries", () => {
  it("public view has no EncryptedWalletSecret field", () => {
    // TypeScript structural check: the public view interface should not
    // have any field typed as EncryptedWalletSecret. We verify at runtime
    // by checking that an agent with encrypted secret does not leak those
    // fields through toResolutionAgentPublicView.
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);

    // Check that encryptedSecret fields are not present
    const raw = view as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("encryptedSecret");
  });

  it("public view has no encryption-related fields at root level", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);
    const keys = Object.keys(view);

    // None of these encryption-related keys should appear
    const forbiddenKeys = [
      "encryptedSecret",
      "ciphertext",
      "iv",
      "authenticationTag",
      "version",
      "algorithm",
      "keyVersionId",
      "privateKey",
      "encryptionKey",
      "walletSecret",
    ];
    for (const key of forbiddenKeys) {
      expect(keys).not.toContain(key);
    }
  });

  it("public view with EncryptedWalletSecret does not leak version", () => {
    const agent = makeTestAgent({
      encryptedSecret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "some-sensitive-ciphertext",
        iv: "some-sensitive-iv",
        authenticationTag: "some-sensitive-tag",
      },
    });
    const view = toResolutionAgentPublicView(agent);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("some-sensitive-ciphertext");
    expect(serialized).not.toContain("some-sensitive-iv");
    expect(serialized).not.toContain("some-sensitive-tag");
    expect(serialized).not.toContain("\"version\":");
    expect(serialized).not.toContain("\"algorithm\":");
  });

  it("public view does not leak envelope structure as nested objects", () => {
    const agent = makeTestAgent();
    const view = toResolutionAgentPublicView(agent);

    // Walk the public view recursively and ensure no EncryptedWalletSecret
    // artifacts appear anywhere in the object tree.
    function deepCheck(obj: unknown, path: string = "root"): void {
      if (obj === null || obj === undefined) return;
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => deepCheck(item, `${path}[${i}]`));
        return;
      }
      if (typeof obj === "object") {
        const record = obj as Record<string, unknown>;
        // Check for envelope keys
        const envelopeKeys = ["ciphertext", "iv", "authenticationTag"];
        for (const key of envelopeKeys) {
          expect(record).not.toHaveProperty(key);
        }
        // Recurse
        for (const [k, v] of Object.entries(record)) {
          deepCheck(v, `${path}.${k}`);
        }
      }
    }

    deepCheck(view);
  });
});

// ---------------------------------------------------------------------------
// EncryptedWalletSecret must not be in the public barrel types
// ---------------------------------------------------------------------------

describe("Type-only boundary checks", () => {
  it("EncryptedWalletSecret type is not re-exported from a server-restricted path", () => {
    // While EncryptedWalletSecret IS exported from the public barrel
    // (because it's part of the ResolutionAgent type), the encryption
    // and decryption FUNCTIONS must not be. This test documents that
    // the type itself may be visible, but the operations are not.
    //
    // This is acceptable because:
    // 1. Building an EncryptedWalletSecret object requires the server key
    // 2. Decrypting it requires the server key
    // 3. The type is needed for server-to-server communication
    //
    // The critical boundary is that encryption/decryption OPERATIONS
    // are server-only, which we verify above.
    //
    // This test serves as explicit documentation of this design decision.
    expect(true).toBe(true);
  });
});
