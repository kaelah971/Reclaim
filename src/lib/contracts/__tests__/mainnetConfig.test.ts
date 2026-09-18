// ---------------------------------------------------------------------------
// P2A — chain-scoped protected escrow configuration
//
// These tests deliberately cover configuration only.  They must not make RPC
// calls, send transactions, or depend on a deployed Celo mainnet escrow.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  celoMainnetChain,
  celoSepoliaChain,
} from "@/lib/web3/chains";
import {
  CELO_MAINNET_ESCROW_TOKEN_CONFIG,
  getEscrowTokenConfig,
} from "@/lib/web3/tokens";
import {
  DEPLOYED_ADDRESSES,
  getEscrowAddress,
} from "../addresses";
import {
  getEscrowContractAddress,
  getEscrowContractConfig,
} from "../config";

const SEPOLIA_V1 = "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79";
const SEPOLIA_V2 = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_USAT = "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";

describe("P2A chain definitions", () => {
  it("defines Celo Sepolia and Celo Mainnet explicitly", () => {
    expect(CELO_SEPOLIA_CHAIN_ID).toBe(11142220);
    expect(CELO_MAINNET_CHAIN_ID).toBe(42220);
    expect(celoSepoliaChain.id).toBe(CELO_SEPOLIA_CHAIN_ID);
    expect(celoMainnetChain.id).toBe(CELO_MAINNET_CHAIN_ID);
    // Historical callers continue to resolve the escrow chain to Sepolia.
    expect(CELO_CHAIN_ID).toBe(CELO_SEPOLIA_CHAIN_ID);
  });
});

describe("chain-scoped escrow token configuration", () => {
  it("uses USA₮/USAT on Celo Mainnet", () => {
    expect(CELO_MAINNET_ESCROW_TOKEN_CONFIG).toEqual({
      address: MAINNET_USAT,
      symbol: "USAT",
      name: "USA₮",
      decimals: 6,
      chainId: CELO_MAINNET_CHAIN_ID,
    });
    expect(getEscrowTokenConfig(celoMainnetChain)).toEqual(
      CELO_MAINNET_ESCROW_TOKEN_CONFIG,
    );
  });

  it("keeps the existing Sepolia escrow token configuration readable", () => {
    const token = getEscrowTokenConfig(celoSepoliaChain);
    expect(token.chainId).toBe(CELO_SEPOLIA_CHAIN_ID);
    expect(token.symbol).toBe("USDC");
    expect(token.decimals).toBe(6);
  });
});

describe("chain-scoped escrow contract configuration", () => {
  it("keeps Sepolia V2 and V1 history represented", () => {
    expect(getEscrowAddress(CELO_SEPOLIA_CHAIN_ID)).toBe(SEPOLIA_V2);
    expect(DEPLOYED_ADDRESSES[CELO_SEPOLIA_CHAIN_ID].protectedPaymentEscrowV1).toBe(
      SEPOLIA_V1,
    );

    expect(getEscrowContractAddress(celoSepoliaChain)).toBe(SEPOLIA_V2);
    expect(getEscrowContractConfig(celoSepoliaChain)).toMatchObject({
      address: SEPOLIA_V2,
      chainId: CELO_SEPOLIA_CHAIN_ID,
    });
  });

  it("resolves the deployed Celo Mainnet escrow (P3)", () => {
    expect(getEscrowAddress(CELO_MAINNET_CHAIN_ID)).toBe(MAINNET_ESCROW);
    expect(DEPLOYED_ADDRESSES[CELO_MAINNET_CHAIN_ID].protectedPaymentEscrow).toBe(
      MAINNET_ESCROW,
    );

    expect(getEscrowContractAddress(celoMainnetChain)).toBe(MAINNET_ESCROW);
    expect(getEscrowContractConfig(celoMainnetChain)).toMatchObject({
      address: MAINNET_ESCROW,
      chainId: CELO_MAINNET_CHAIN_ID,
    });
  });

  it("fails closed for chains without a deployed escrow", () => {
    expect(getEscrowAddress(1)).toBeUndefined();
    expect(() => getEscrowContractAddress(1)).toThrow(
      /not deployed on chain 1/i,
    );
    expect(() => getEscrowContractConfig(1)).toThrow(
      /not deployed on chain 1/i,
    );
  });
});
