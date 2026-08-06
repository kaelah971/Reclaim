import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Public Barrel Boundary — store internals must NOT leak
// ---------------------------------------------------------------------------

describe("Public barrel (../../index) does NOT export store internals", () => {
  it("does not export SupabaseResolutionAgentStore", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).SupabaseResolutionAgentStore,
    ).toBeUndefined();
  });

  it("does not export agentToInsertRow", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).agentToInsertRow,
    ).toBeUndefined();
  });

  it("does not export rowToAgent", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).rowToAgent,
    ).toBeUndefined();
  });

  it("does not export ResolutionAgentRow", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).ResolutionAgentRow,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Store error classes must NOT be in the public barrel
// ---------------------------------------------------------------------------

describe("Public barrel does NOT export any store error classes", () => {
  it("does not export ResolutionAgentStoreError", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).ResolutionAgentStoreError,
    ).toBeUndefined();
  });

  it("does not export ResolutionAgentNotFoundError", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).ResolutionAgentNotFoundError,
    ).toBeUndefined();
  });

  it("does not export ResolutionAgentAlreadyExistsError", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>)
        .ResolutionAgentAlreadyExistsError,
    ).toBeUndefined();
  });

  it("does not export ResolutionAgentConcurrencyError", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>)
        .ResolutionAgentConcurrencyError,
    ).toBeUndefined();
  });

  it("does not export ResolutionAgentSerializationError", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>)
        .ResolutionAgentSerializationError,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No database credentials are imported by the public barrel
// ---------------------------------------------------------------------------

describe("No database credentials are exposed by the public barrel", () => {
  it("does not export SUPABASE_URL", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).SUPABASE_URL,
    ).toBeUndefined();
  });

  it("does not export SUPABASE_ANON_KEY", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).SUPABASE_ANON_KEY,
    ).toBeUndefined();
  });

  it("does not export SUPABASE_SERVICE_ROLE_KEY", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).SUPABASE_SERVICE_ROLE_KEY,
    ).toBeUndefined();
  });

  it("does not export any supabase client instance", async () => {
    const PublicBarrel = await import("../../index");
    const keys = Object.keys(PublicBarrel as Record<string, unknown>);
    const suspicious = keys.filter(
      (k) =>
        k.toLowerCase().includes("supabase") ||
        k.toLowerCase().includes("database") ||
        k.toLowerCase().includes("db_client") ||
        k.toLowerCase().includes("connection"),
    );
    expect(suspicious).toHaveLength(0);
  });

  it("does not export createClient or any supabase factory", async () => {
    const PublicBarrel = await import("../../index");
    expect(
      (PublicBarrel as Record<string, unknown>).createClient,
    ).toBeUndefined();
    expect(
      (PublicBarrel as Record<string, unknown>).supabase,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Store barrel (../index) DOES export SupabaseResolutionAgentStore (server-only)
// ---------------------------------------------------------------------------

describe("Store barrel (../index) exports are correct", () => {
  it("does export SupabaseResolutionAgentStore", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).SupabaseResolutionAgentStore,
    ).toBeDefined();
  });

  it("SupabaseResolutionAgentStore is a class (function)", async () => {
    const StoreBarrel = await import("../index");
    const Store = (StoreBarrel as Record<string, unknown>)
      .SupabaseResolutionAgentStore;
    expect(typeof Store).toBe("function");
  });

  it("does export agentToInsertRow", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).agentToInsertRow,
    ).toBeDefined();
  });

  it("does export rowToAgent", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).rowToAgent,
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Store barrel does NOT export server encryption functions
// (those are in the separate server/ barrel)
// ---------------------------------------------------------------------------

describe("Store barrel does NOT export server encryption internals", () => {
  it("does not export encryptCaseWalletPrivateKey", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).encryptCaseWalletPrivateKey,
    ).toBeUndefined();
  });

  it("does not export decryptCaseWalletPrivateKey", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).decryptCaseWalletPrivateKey,
    ).toBeUndefined();
  });

  it("does not export WALLET_ENCRYPTION_KEY_ENV", async () => {
    const StoreBarrel = await import("../index");
    expect(
      (StoreBarrel as Record<string, unknown>).WALLET_ENCRYPTION_KEY_ENV,
    ).toBeUndefined();
  });
});
