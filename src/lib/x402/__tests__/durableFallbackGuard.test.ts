// ---------------------------------------------------------------------------
// P4.1b durable-store fallback guard (no real Supabase, no real chain).
//
// - Local/test mode keeps the in-memory fallback (existing behavior).
// - Facilitator/mainnet mode fails closed when Supabase is unconfigured.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("P4.1b durable payment-store fallback guard", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.X402_SETTLEMENT_MODE;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllEnvs();
  });

  it("keeps the in-memory fallback in local/test mode (unchanged)", async () => {
    const supabase = await import("@/lib/supabase/client");
    supabase.__resetSupabaseClientCacheForTests();
    expect(supabase.isSupabaseConfigured()).toBe(false);
    expect(supabase.isDurablePersistenceRequired()).toBe(false);

    const { getPaymentStore, __resetPaymentStoreCacheForTests } = await import(
      "../paymentStore.supabase"
    );
    __resetPaymentStoreCacheForTests();
    const store = getPaymentStore();
    const id = store.createPaymentId();
    await store.recordPending(id);
    expect(await store.getStatus(id)).toBe("pending");
  });

  it("fails closed in facilitator/mainnet mode when Supabase is unconfigured", async () => {
    vi.stubEnv("X402_SETTLEMENT_MODE", "celo-facilitator");
    const supabase = await import("@/lib/supabase/client");
    supabase.__resetSupabaseClientCacheForTests();
    expect(supabase.isDurablePersistenceRequired()).toBe(true);
    expect(() =>
      supabase.assertSupabaseConfiguredForDurableWrites("x402 payment store"),
    ).toThrow(/Durable persistence is required/);

    const { getPaymentStore, __resetPaymentStoreCacheForTests } = await import(
      "../paymentStore.supabase"
    );
    __resetPaymentStoreCacheForTests();
    expect(() => getPaymentStore()).toThrow(/Durable persistence is required/);
  });

  it("getDurablePaymentStore always requires Supabase", async () => {
    const { getDurablePaymentStore, __resetPaymentStoreCacheForTests } = await import(
      "../paymentStore.supabase"
    );
    __resetPaymentStoreCacheForTests();
    expect(() => getDurablePaymentStore()).toThrow(/Durable persistence is required/);
  });
});
