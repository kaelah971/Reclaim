import { celoSepolia, celo } from "viem/chains";
import type { Chain } from "viem/chains";

/** Explicit Celo Sepolia chain definition (chain ID 11142220). */
export const celoSepoliaChain = celoSepolia;

/** Explicit Celo Mainnet chain definition (chain ID 42220). */
export const celoMainnetChain = celo;

/**
 * Historical default escrow chain. Keep this alias pointed at Sepolia until
 * the mainnet escrow is deployed and the product is explicitly migrated.
 */
export const celoChain: Chain = celoSepoliaChain;

/** Celo Sepolia chain ID. */
export const CELO_SEPOLIA_CHAIN_ID = celoSepoliaChain.id;

/** Historical alias retained for existing Sepolia escrow callers. */
export const CELO_CHAIN_ID = CELO_SEPOLIA_CHAIN_ID;

export const CELO_NETWORK_NAME = "Celo Sepolia";

export const CELO_NETWORK_LABEL = "Celo Sepolia Testnet";

/** Celo Mainnet chain ID. */
export const CELO_MAINNET_CHAIN_ID = celoMainnetChain.id;

/** The two Celo networks supported by the application. */
export const CELO_CHAINS = {
  [CELO_SEPOLIA_CHAIN_ID]: celoSepoliaChain,
  [CELO_MAINNET_CHAIN_ID]: celoMainnetChain,
} as const;

/** Resolve a supported Celo chain by numeric chain ID. */
export function getCeloChain(chainId: number): Chain | undefined {
  return CELO_CHAINS[chainId as keyof typeof CELO_CHAINS];
}

const explorerBaseUrl = (
  process.env.NEXT_PUBLIC_CELO_EXPLORER_URL ||
  celoSepolia.blockExplorers.default.url
).replace(/\/$/, "");

/** Celo mainnet explorer (celoscan.io). */
const mainnetExplorerBaseUrl = "https://celoscan.io";

export function isSupportedChain(chainId: number | undefined): boolean {
  return chainId === CELO_CHAIN_ID || chainId === CELO_MAINNET_CHAIN_ID;
}

/** Resolve a human-readable chain name for the given chain ID. */
export function getChainName(chainId: number | undefined): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) return "Celo Mainnet";
  if (chainId === CELO_CHAIN_ID) return CELO_NETWORK_NAME;
  return chainId ? `Chain ID: ${chainId} — unsupported` : "Unknown network";
}

export function getCeloExplorerTxUrl(txHash: string): string {
  return `${explorerBaseUrl}/tx/${txHash}`;
}

export function getCeloExplorerAddressUrl(address: string): string {
  return `${explorerBaseUrl}/address/${address}`;
}

/** Explorer transaction URL for Celo mainnet (celoscan.io). */
export function getCeloMainnetExplorerTxUrl(txHash: string): string {
  return `${mainnetExplorerBaseUrl}/tx/${txHash}`;
}

/** Explorer address URL for Celo mainnet (celoscan.io). */
export function getCeloMainnetExplorerAddressUrl(address: string): string {
  return `${mainnetExplorerBaseUrl}/address/${address}`;
}
