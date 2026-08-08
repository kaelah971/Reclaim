// ---------------------------------------------------------------------------
// Wagmi SSR hydration wiring — source-level verification test
//
// Verifies the root layout passes cookieToInitialState → Web3Provider
// → WagmiProvider initialState chain.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const LAYOUT_PATH = resolve(__dirname, "..", "..", "app", "layout.tsx");
const PROVIDER_PATH = resolve(__dirname, "..", "Web3Provider.tsx");

describe("Wagmi SSR hydration wiring", () => {
  it("root layout imports cookieToInitialState from wagmi", () => {
    const source = readFileSync(LAYOUT_PATH, "utf-8");
    expect(source).toContain("cookieToInitialState");
  });

  it("root layout uses cookieToInitialState with the wagmi config", () => {
    const source = readFileSync(LAYOUT_PATH, "utf-8");
    expect(source).toContain("cookieToInitialState");
    expect(source).toContain("wagmiConfig");
  });

  it("root layout passes initialState to Web3Provider", () => {
    const source = readFileSync(LAYOUT_PATH, "utf-8");
    expect(source).toContain("initialState");
  });

  it("Web3Provider accepts initialState prop", () => {
    const source = readFileSync(PROVIDER_PATH, "utf-8");
    expect(source).toContain("initialState");
  });

  it("Web3Provider passes initialState to WagmiProvider", () => {
    const source = readFileSync(PROVIDER_PATH, "utf-8");
    expect(source).toContain("initialState");
    expect(source).toContain("WagmiProvider");
  });

  it("does NOT set ssr: false", () => {
    const configPath = resolve(__dirname, "..", "..", "lib", "web3", "config.ts");
    const source = readFileSync(configPath, "utf-8");
    expect(source).toContain("ssr: true");
  });

  it("useConnection is unchanged", () => {
    const walletStatePath = resolve(__dirname, "..", "..", "hooks", "wallet", "useWalletState.ts");
    const source = readFileSync(walletStatePath, "utf-8");
    expect(source).toContain("useConnection");
  });
});
