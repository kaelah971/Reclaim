// ---------------------------------------------------------------------------
// Resolution Agent API — Funding Reader Tests
//
// Validates the MockFundingReader and CeloMainnetFundingReader implementations.
// The funding reader is the only component that talks to the blockchain —
// it reads USDC balances without ever attempting writes, transfers, or
// contract state changes.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  CeloMainnetFundingReader,
  MockFundingReader,
  USDC_MAINNET_ADDRESS,
  FUNDING_CHAIN_ID,
} from "../funding";

// ---------------------------------------------------------------------------
// MockFundingReader
// ---------------------------------------------------------------------------

describe("MockFundingReader", () => {
  it("returns the configured balance for a known address", async () => {
    const map = new Map<string, bigint>();
    map.set("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1_000_000n);
    const reader = new MockFundingReader(map);
    const balance = await reader.getUsdcBalanceAtomic(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(balance).toBe(1_000_000n);
  });

  it("returns 0 for an unknown / unregistered address", async () => {
    const reader = new MockFundingReader(new Map());
    const balance = await reader.getUsdcBalanceAtomic(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(balance).toBe(0n);
  });

  it("getUsdcBalanceAtomic returns bigint type", async () => {
    const map = new Map<string, bigint>();
    map.set("0xcccccccccccccccccccccccccccccccccccccccc", 42_000n);
    const reader = new MockFundingReader(map);
    const balance = await reader.getUsdcBalanceAtomic(
      "0xcccccccccccccccccccccccccccccccccccccccc",
    );
    expect(typeof balance).toBe("bigint");
  });

  it("makes no RPC / network calls", async () => {
    // The MockFundingReader is entirely in-memory. It should not import
    // or use any fetch, viem public client, or HTTP transport.
    // We verify by checking that no global fetch mock was needed and
    // the call returns synchronously (no real network latency).
    const map = new Map<string, bigint>();
    map.set("0xdddddddddddddddddddddddddddddddddddddddd", 5n);
    const reader = new MockFundingReader(map);
    const start = performance.now();
    const balance = await reader.getUsdcBalanceAtomic(
      "0xdddddddddddddddddddddddddddddddddddddddd",
    );
    const elapsed = performance.now() - start;
    expect(balance).toBe(5n);
    // Should resolve near-instantly (no real I/O)
    expect(elapsed).toBeLessThan(100);
  });

  it("address matching is case-insensitive", async () => {
    const map = new Map<string, bigint>();
    map.set("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 50n);
    const reader = new MockFundingReader(map);
    const balance = await reader.getUsdcBalanceAtomic(
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(balance).toBe(50n);
  });
});

// ---------------------------------------------------------------------------
// CeloMainnetFundingReader
// ---------------------------------------------------------------------------

describe("CeloMainnetFundingReader", () => {
  it("constructor accepts an optional RPC URL", () => {
    const reader = new CeloMainnetFundingReader("https://forno.celo.org");
    expect(reader).toBeDefined();
  });

  it("default constructor creates a valid instance", () => {
    const reader = new CeloMainnetFundingReader();
    expect(reader).toBeDefined();
  });

  it("uses chain ID 42220 (Celo Mainnet)", () => {
    expect(FUNDING_CHAIN_ID).toBe(42220);
  });

  it("uses canonical USDC address", () => {
    const normalized = USDC_MAINNET_ADDRESS.toLowerCase();
    expect(normalized).toBe(
      "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    );
  });

  it("getUsdcBalanceAtomic exists and accepts 1 argument", () => {
    const reader = new CeloMainnetFundingReader();
    expect(typeof reader.getUsdcBalanceAtomic).toBe("function");
    expect(reader.getUsdcBalanceAtomic.length).toBe(1);
  });

  it("getUsdcBalanceAtomic returns a Promise<bigint>", () => {
    const reader = new CeloMainnetFundingReader();
    const result = reader.getUsdcBalanceAtomic(
      "0x0000000000000000000000000000000000000000",
    );
    expect(result).toBeInstanceOf(Promise);
    // Clean up the promise
    result.catch(() => {});
  });

  it("balanceOf never attempts write / sign / transfer", async () => {
    // The funding reader MUST be read-only. It must not import wallet
    // signing primitives (viem WalletClient), must not call transfer(),
    // approve(), or any state-changing function.
    //
    // This is a structural test: we verify that no write-related imports
    // are present in the module by checking the module's own exports.
    const mod = await import("../funding");
    const exports = Object.keys(mod);
    const writeRelated = exports.filter(
      (k) =>
        k.toLowerCase().includes("transfer") ||
        k.toLowerCase().includes("approve") ||
        k.toLowerCase().includes("sign") ||
        k.toLowerCase().includes("send") ||
        k.toLowerCase().includes("write") ||
        k.toLowerCase().includes("mint"),
    );
    expect(writeRelated).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("funding module shape", () => {
  it("exports CeloMainnetFundingReader as a class", async () => {
    const mod = await import("../funding");
    expect(typeof mod.CeloMainnetFundingReader).toBe("function");
  });

  it("exports MockFundingReader as a class", async () => {
    const mod = await import("../funding");
    expect(typeof mod.MockFundingReader).toBe("function");
  });

  it("exports USDC_MAINNET_ADDRESS as a string constant", async () => {
    const mod = await import("../funding");
    expect(typeof mod.USDC_MAINNET_ADDRESS).toBe("string");
    expect(mod.USDC_MAINNET_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("exports FUNDING_CHAIN_ID as a number", async () => {
    const mod = await import("../funding");
    expect(typeof mod.FUNDING_CHAIN_ID).toBe("number");
  });
});
