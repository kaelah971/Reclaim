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

/**
 * P4.1a — production / new-payment default escrow chain (D1).
 *
 * New protected payments resolve to Celo Mainnet (42220) when callers pass
 * this constant explicitly. Historical defaults (`celoChain` /
 * `CELO_CHAIN_ID`) intentionally remain Sepolia for backward compatibility;
 * callers must pass an explicit chainId instead of relying on silent
 * defaults. No hidden Mainnet→Sepolia fallback exists.
 */
export const PRODUCTION_ESCROW_CHAIN_ID = CELO_MAINNET_CHAIN_ID;

/** Alias for the new-payment default (D1 = Celo Mainnet 42220). */
export const DEFAULT_NEW_PAYMENT_CHAIN_ID = CELO_MAINNET_CHAIN_ID;

/** Explicit Celo Mainnet chain object for production escrow callers. */
export const PRODUCTION_ESCROW_CHAIN: Chain = celoMainnetChain;

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

/**
 * Chain-parameterized wallet-switch error for escrow flows.
 * Sepolia resolves to the historical "Switch to Celo Sepolia to continue."
 * copy; Mainnet resolves to "Switch to Celo Mainnet to continue.".
 * Unsupported chains fail closed with an explicit unsupported message.
 */
export function getChainSwitchError(chainId: number | undefined): string {
  return `Switch to ${getChainName(chainId)} to continue.`;
}

/**
 * Chain-parameterized wallet-switch error for a named escrow action.
 * Example: getChainActionSwitchError(42220, "to create a payment.")
 * → "Switch to Celo Mainnet to create a payment."
 */
export function getChainActionSwitchError(
  chainId: number | undefined,
  actionSuffix: string,
): string {
  return `Switch to ${getChainName(chainId)} ${actionSuffix}`.trim();
}

/** True when the chain ID is a supported escrow chain (Sepolia or Mainnet). */
export function isSupportedEscrowChain(
  chainId: number | undefined,
): boolean {
  return isSupportedChain(chainId);
}

/**
 * Fail closed for unsupported escrow chains using the existing
 * "not deployed on chain X" pattern.
 */
export function assertSupportedEscrowChain(chainId: number | undefined): void {
  if (!isSupportedChain(chainId)) {
    throw new Error(
      `ProtectedPaymentEscrow is not deployed on chain ${chainId}.`,
    );
  }
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
