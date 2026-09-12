import type { Chain } from "viem/chains";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  celoSepoliaChain,
} from "./chains";

const FALLBACK_TOKEN_ADDRESS = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";

export const PAYMENT_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS || FALLBACK_TOKEN_ADDRESS;

export const PAYMENT_TOKEN_SYMBOL =
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL || "USDC";

export const PAYMENT_TOKEN_NAME = "USD Coin";

const parsedDecimals = Number(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS);
export const PAYMENT_TOKEN_DECIMALS = Number.isInteger(parsedDecimals)
  ? parsedDecimals
  : 6;

export interface PaymentTokenConfig {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
}

export type EscrowTokenConfig = PaymentTokenConfig;

/** Verified Celo Mainnet USA₮ contract address. */
export const CELO_MAINNET_ESCROW_TOKEN_ADDRESS =
  "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771" as `0x${string}`;

/** Verified USA₮ token configuration for the future Celo Mainnet escrow. */
export const CELO_MAINNET_ESCROW_TOKEN_CONFIG: EscrowTokenConfig = {
  address: (process.env.NEXT_PUBLIC_CELO_MAINNET_ESCROW_TOKEN_ADDRESS ||
    CELO_MAINNET_ESCROW_TOKEN_ADDRESS) as `0x${string}`,
  symbol: process.env.NEXT_PUBLIC_CELO_MAINNET_ESCROW_TOKEN_SYMBOL || "USAT",
  name: "USA₮",
  decimals: Number.isInteger(
    Number(process.env.NEXT_PUBLIC_CELO_MAINNET_ESCROW_TOKEN_DECIMALS),
  )
    ? Number(process.env.NEXT_PUBLIC_CELO_MAINNET_ESCROW_TOKEN_DECIMALS)
    : 6,
  chainId: CELO_MAINNET_CHAIN_ID,
};

/** Existing Celo Sepolia escrow token configuration. */
export const CELO_SEPOLIA_ESCROW_TOKEN_CONFIG: EscrowTokenConfig = {
  address: PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  symbol: PAYMENT_TOKEN_SYMBOL,
  name: PAYMENT_TOKEN_NAME,
  decimals: PAYMENT_TOKEN_DECIMALS,
  chainId: CELO_CHAIN_ID,
};

/** Chain-scoped protected escrow token configurations. */
export const ESCROW_TOKEN_CONFIG_BY_CHAIN = {
  [CELO_CHAIN_ID]: CELO_SEPOLIA_ESCROW_TOKEN_CONFIG,
  [CELO_MAINNET_CHAIN_ID]: CELO_MAINNET_ESCROW_TOKEN_CONFIG,
} as const;

type ChainReference = Chain | number;

function resolveChainId(chain: ChainReference): number {
  return typeof chain === "number" ? chain : chain.id;
}

function validateTokenConfig(config: EscrowTokenConfig): EscrowTokenConfig {
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.address)) {
    throw new Error(`Invalid payment token address: ${config.address}`);
  }
  return config;
}

/**
 * Return the immutable-token configuration for a protected escrow chain.
 * Sepolia remains the default for historical callers.
 */
export function getEscrowTokenConfig(
  chain: ChainReference = celoSepoliaChain,
): EscrowTokenConfig {
  const chainId = resolveChainId(chain);
  const config =
    ESCROW_TOKEN_CONFIG_BY_CHAIN[
      chainId as keyof typeof ESCROW_TOKEN_CONFIG_BY_CHAIN
    ];
  if (!config) {
    throw new Error(`Unsupported escrow chain ${chainId}.`);
  }
  return validateTokenConfig(config);
}

/**
 * Backward-compatible payment-token accessor. Its default remains the
 * existing Sepolia USDC configuration; x402 continues to use the legacy
 * USDC constants above rather than this chain-scoped escrow mapping.
 */
export function getPaymentTokenConfig(
  chain: ChainReference = celoSepoliaChain,
): PaymentTokenConfig {
  return getEscrowTokenConfig(chain);
}
