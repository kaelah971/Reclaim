// ---------------------------------------------------------------------------
// P4.1a — explicit supported chain plumbing (lib-level).
//
// Proves:
//   - 42220 resolves canonical Mainnet escrow + USA₮ (USAT) 6 decimals
//   - Production / new-payment defaults resolve to 42220 (D1)
//   - Sepolia behavior unchanged (explicit + backward-compat default)
//   - Unsupported chains fail closed (no hidden Mainnet→Sepolia fallback)
//   - Chain-parameterized switch errors are explicit per chain
// No RPC calls, no transactions.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  celoChain,
  celoMainnetChain,
  celoSepoliaChain,
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  PRODUCTION_ESCROW_CHAIN_ID,
  DEFAULT_NEW_PAYMENT_CHAIN_ID,
  PRODUCTION_ESCROW_CHAIN,
  getChainName,
  getChainSwitchError,
  getChainActionSwitchError,
  isSupportedChain,
  isSupportedEscrowChain,
  assertSupportedEscrowChain,
} from "@/lib/web3/chains";
import {
  CELO_MAINNET_ESCROW_TOKEN_CONFIG,
  CELO_SEPOLIA_ESCROW_TOKEN_CONFIG,
  getEscrowTokenConfig,
  getPaymentTokenConfig,
} from "@/lib/web3/tokens";
import { getEscrowAddress } from "../addresses";
import {
  DEFAULT_NEW_PAYMENT_CHAIN_ID as CONFIG_DEFAULT_NEW_PAYMENT,
  getEscrowChainId,
  getEscrowContractAddress,
  getEscrowContractConfig,
  getProductionEscrowChainId,
  getProductionEscrowContractAddress,
  getProductionEscrowContractConfig,
  PRODUCTION_ESCROW_CHAIN_ID as CONFIG_PRODUCTION_CHAIN,
} from "../config";

const SEPOLIA_V2 = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";
const MAINNET_USAT = "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771";

describe("P4.1a production defaults resolve to Celo Mainnet 42220 (D1)", () => {
  it("chain constants resolve production to 42220", () => {
    expect(CELO_MAINNET_CHAIN_ID).toBe(42220);
    expect(PRODUCTION_ESCROW_CHAIN_ID).toBe(42220);
    expect(DEFAULT_NEW_PAYMENT_CHAIN_ID).toBe(42220);
    expect(PRODUCTION_ESCROW_CHAIN.id).toBe(42220);
    expect(celoMainnetChain.id).toBe(42220);
  });

  it("config production helpers resolve to 42220", () => {
    expect(CONFIG_PRODUCTION_CHAIN).toBe(42220);
    expect(CONFIG_DEFAULT_NEW_PAYMENT).toBe(42220);
    expect(getProductionEscrowChainId()).toBe(42220);
    expect(getProductionEscrowContractAddress()).toBe(MAINNET_ESCROW);
    expect(getProductionEscrowContractConfig()).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: 42220,
    });
  });
});

describe("P4.1a 42220 resolves canonical escrow + USAT 6 decimals", () => {
  it("resolves the canonical Mainnet escrow address", () => {
    expect(getEscrowAddress(CELO_MAINNET_CHAIN_ID)).toBe(MAINNET_ESCROW);
    expect(getEscrowAddress(celoMainnetChain)).toBe(MAINNET_ESCROW);
    expect(getEscrowAddress(42220)).toBe(MAINNET_ESCROW);
    expect(getEscrowContractAddress(42220)).toBe(MAINNET_ESCROW);
    expect(getEscrowContractAddress(celoMainnetChain)).toBe(MAINNET_ESCROW);
    expect(getEscrowContractConfig(42220)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: 42220,
    });
    expect(getEscrowContractConfig(celoMainnetChain)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: 42220,
    });
    expect(getEscrowChainId(42220)).toBe(42220);
    expect(getEscrowChainId(celoMainnetChain)).toBe(42220);
  });

  it("resolves USA₮/USAT with 6 decimals on Mainnet", () => {
    expect(CELO_MAINNET_ESCROW_TOKEN_CONFIG).toMatchObject({
      address: MAINNET_USAT,
      symbol: "USAT",
      decimals: 6,
      chainId: 42220,
    });
    const token = getEscrowTokenConfig(42220);
    expect(token.address).toBe(MAINNET_USAT);
    expect(token.symbol).toBe("USAT");
    expect(token.decimals).toBe(6);
    expect(token.chainId).toBe(42220);
    expect(getEscrowTokenConfig(celoMainnetChain)).toEqual(token);
    expect(getPaymentTokenConfig(42220)).toEqual(token);
  });

  it("never falls back to Sepolia when Mainnet is requested", () => {
    expect(getEscrowAddress(42220)).not.toBe(SEPOLIA_V2);
    expect(getEscrowContractAddress(42220)).not.toBe(SEPOLIA_V2);
    expect(getEscrowTokenConfig(42220).address).not.toBe(
      CELO_SEPOLIA_ESCROW_TOKEN_CONFIG.address,
    );
  });
});

describe("P4.1a Sepolia behavior unchanged", () => {
  it("keeps historical Sepolia defaults for backward compat", () => {
    expect(CELO_SEPOLIA_CHAIN_ID).toBe(11142220);
    expect(CELO_CHAIN_ID).toBe(11142220);
    expect(celoChain.id).toBe(11142220);
    expect(celoSepoliaChain.id).toBe(11142220);
  });

  it("resolves Sepolia escrow + token identically via default and explicit chain", () => {
    expect(getEscrowAddress(CELO_SEPOLIA_CHAIN_ID)).toBe(SEPOLIA_V2);
    // Default (no arg) preserves Sepolia for unmigrated callers.
    expect(getEscrowContractAddress()).toBe(SEPOLIA_V2);
    expect(getEscrowContractConfig()).toMatchObject({
      address: SEPOLIA_V2,
      chainId: 11142220,
    });
    expect(getEscrowContractAddress(celoSepoliaChain)).toBe(SEPOLIA_V2);
    expect(getEscrowContractConfig(11142220)).toMatchObject({
      address: SEPOLIA_V2,
      chainId: 11142220,
    });
    const token = getEscrowTokenConfig(celoSepoliaChain);
    expect(token.chainId).toBe(11142220);
    expect(token.symbol).toBe("USDC");
    expect(token.decimals).toBe(6);
  });
});

describe("P4.1a unsupported chains fail closed", () => {
  it("escrow address lookup returns undefined (no fallback)", () => {
    expect(getEscrowAddress(1)).toBeUndefined();
    expect(getEscrowAddress(10)).toBeUndefined();
    expect(getEscrowAddress(137)).toBeUndefined();
  });

  it("escrow contract accessors throw 'not deployed on chain X'", () => {
    expect(() => getEscrowContractAddress(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => getEscrowContractConfig(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => getEscrowContractConfig(10)).toThrow(
      /not deployed on chain 10/i,
    );
  });

  it("token configs throw for unsupported chains", () => {
    expect(() => getEscrowTokenConfig(1)).toThrow(/unsupported/i);
    expect(() => getPaymentTokenConfig(1)).toThrow(/unsupported/i);
  });

  it("chain support helpers fail closed", () => {
    expect(isSupportedChain(42220)).toBe(true);
    expect(isSupportedChain(11142220)).toBe(true);
    expect(isSupportedChain(1)).toBe(false);
    expect(isSupportedEscrowChain(42220)).toBe(true);
    expect(isSupportedEscrowChain(11142220)).toBe(true);
    expect(isSupportedEscrowChain(1)).toBe(false);
    expect(() => assertSupportedEscrowChain(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => assertSupportedEscrowChain(undefined)).toThrow(
      /not deployed/i,
    );
  });
});

describe("P4.1a chain-parameterized switch errors", () => {
  it("resolves explicit per-chain switch copy", () => {
    expect(getChainName(42220)).toBe("Celo Mainnet");
    expect(getChainName(11142220)).toBe("Celo Sepolia");
    expect(getChainSwitchError(42220)).toBe(
      "Switch to Celo Mainnet to continue.",
    );
    expect(getChainSwitchError(11142220)).toBe(
      "Switch to Celo Sepolia to continue.",
    );
    expect(getChainActionSwitchError(42220, "to create a payment.")).toBe(
      "Switch to Celo Mainnet to create a payment.",
    );
    expect(getChainActionSwitchError(11142220, "to create a payment.")).toBe(
      "Switch to Celo Sepolia to create a payment.",
    );
  });
});
