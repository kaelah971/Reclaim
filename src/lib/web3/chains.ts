import { celoSepolia, celo } from "viem/chains";
import type { Chain } from "viem/chains";

export const celoChain: Chain = celoSepolia;

export const CELO_CHAIN_ID = celoSepolia.id;

export const CELO_NETWORK_NAME = "Celo Sepolia";

export const CELO_NETWORK_LABEL = "Celo Sepolia Testnet";

/** Celo mainnet (chain ID 42220). */
export const celoMainnetChain: Chain = celo;

/** Celo mainnet chain ID. */
export const CELO_MAINNET_CHAIN_ID = celo.id;

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
