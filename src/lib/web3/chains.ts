import { celoSepolia } from "viem/chains";
import type { Chain } from "viem/chains";

export const celoChain: Chain = celoSepolia;

export const CELO_CHAIN_ID = celoSepolia.id;

export const CELO_NETWORK_NAME = "Celo Sepolia";

export const CELO_NETWORK_LABEL = "Celo Sepolia Testnet";

const explorerBaseUrl = (
  process.env.NEXT_PUBLIC_CELO_EXPLORER_URL ||
  celoSepolia.blockExplorers.default.url
).replace(/\/$/, "");

export function isSupportedChain(chainId: number | undefined): boolean {
  return chainId === CELO_CHAIN_ID;
}

export function getCeloExplorerTxUrl(txHash: string): string {
  return `${explorerBaseUrl}/tx/${txHash}`;
}

export function getCeloExplorerAddressUrl(address: string): string {
  return `${explorerBaseUrl}/address/${address}`;
}
