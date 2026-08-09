// ---------------------------------------------------------------------------
// CHAIN_DIAGNOSTICS_ENABLED — dev-only diagnostics flag tests
//
// The flag must be false in production builds no matter what, and only true
// in development when explicitly opted in via
// NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED=true.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("CHAIN_DIAGNOSTICS_ENABLED", () => {
  it("is false in production even when the opt-in flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED", "true");
    const mod = await import("@/lib/web3/devDiagnostics");
    expect(mod.CHAIN_DIAGNOSTICS_ENABLED).toBe(false);
  });

  it("is true in development when the opt-in flag is set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED", "true");
    const mod = await import("@/lib/web3/devDiagnostics");
    expect(mod.CHAIN_DIAGNOSTICS_ENABLED).toBe(true);
  });

  it("is false in development when the opt-in flag is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED", "");
    const mod = await import("@/lib/web3/devDiagnostics");
    expect(mod.CHAIN_DIAGNOSTICS_ENABLED).toBe(false);
  });
});
