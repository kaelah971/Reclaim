import {
  celoChain,
  celoMainnetChain,
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  PRODUCTION_ESCROW_CHAIN_ID,
} from "@/lib/web3/chains";
import { getEscrowAddress } from "./addresses";
import { protectedPaymentEscrowABI } from "./ProtectedPaymentEscrow.abi";
import { protectedPaymentEscrowV2ABI } from "./ProtectedPaymentEscrowV2.abi";
import type { EscrowDeployment } from "./escrowIdentity";
import type { Chain } from "viem/chains";

// ---------------------------------------------------------------------------
// Deployed contract configuration — single source of truth for the frontend.
// The address comes from src/lib/contracts/addresses.ts (canonical deployment
// record) with an optional NEXT_PUBLIC_PROTECTED_PAYMENT_ESCROW_ADDRESS
// environment override.
// ---------------------------------------------------------------------------

export type EscrowChainReference = Chain | number;

function resolveChainId(chain: EscrowChainReference): number {
  return typeof chain === "number" ? chain : chain.id;
}

function resolveChain(chain: EscrowChainReference): Chain {
  if (typeof chain !== "number") return chain;
  if (chain === CELO_CHAIN_ID) return celoChain;
  if (chain === CELO_MAINNET_CHAIN_ID) return celoMainnetChain;
  throw new Error(`Unsupported escrow chain ${chain}.`);
}

/**
 * Returns the deployed escrow contract address as a checksummed address.
 */
export function getEscrowContractAddress(
  chain: EscrowChainReference = celoChain,
): `0x${string}` {
  const chainId = resolveChainId(chain);
  const address = getEscrowAddress(chainId);
  if (!address) {
    throw new Error(
      `ProtectedPaymentEscrow is not deployed on chain ${chainId}.`,
    );
  }
  return address;
}

/**
 * Returns a full wagmi contract config object suitable for use with
 * useReadContract / useWriteContract.
 */
export function getEscrowContractConfig(
  chain: EscrowChainReference = celoChain,
) {
  const chainId = resolveChainId(chain);
  return {
    address: getEscrowContractAddress(chainId),
    abi: protectedPaymentEscrowABI,
    chainId,
  } as const;
}

// ---------------------------------------------------------------------------
// P7.2 — deployment-aware escrow config (V1 vs V2 discriminated).
//
// getEscrowDeploymentConfig takes a resolved EscrowDeployment (see
// src/lib/contracts/escrowIdentity.ts) and returns the matching address+ABI
// pair, discriminated by the deployment's `contract` field so V1 call sites
// cannot accidentally use V2-only functions (executeAutoRelease,
// getAutoReleaseEligibility, autopilot createPayment) and vice versa.
// Existing getEscrowContractConfig above is UNCHANGED (still V1 canonical).
// ---------------------------------------------------------------------------

/** V1 escrow config (ProtectedPaymentEscrow ABI — no autopilot functions). */
export interface EscrowV1ContractConfig {
  kind: "v1";
  address: `0x${string}`;
  abi: typeof protectedPaymentEscrowABI;
  chainId: number;
}

/** V2 escrow config (ProtectedPaymentEscrowV2 ABI — incl. autopilot). */
export interface EscrowV2ContractConfig {
  kind: "v2";
  address: `0x${string}`;
  abi: typeof protectedPaymentEscrowV2ABI;
  chainId: number;
}

export type EscrowDeploymentConfig =
  | EscrowV1ContractConfig
  | EscrowV2ContractConfig;

/**
 * Returns the discriminated address+ABI config for a resolved deployment.
 */
export function getEscrowDeploymentConfig(
  deployment: EscrowDeployment,
): EscrowDeploymentConfig {
  if (deployment.contract === "ProtectedPaymentEscrowV2") {
    return {
      kind: "v2",
      address: deployment.address,
      abi: protectedPaymentEscrowV2ABI,
      chainId: deployment.chainId,
    };
  }
  return {
    kind: "v1",
    address: deployment.address,
    abi: protectedPaymentEscrowABI,
    chainId: deployment.chainId,
  };
}

/**
 * Returns a wagmi chain config for the escrow deployment.
 */
export function getEscrowChain(
  chain: EscrowChainReference = celoChain,
): Chain {
  return resolveChain(chain);
}

/**
 * Returns the escrow contract's chain ID.
 */
export function getEscrowChainId(
  chain: EscrowChainReference = celoChain,
): number {
  return resolveChainId(chain);
}

// ---------------------------------------------------------------------------
// P4.1a — explicit production defaults (D1 = Celo Mainnet 42220).
// Backward-compat defaults above intentionally remain Sepolia (`celoChain`);
// production / new-payment callers must pass an explicit chainId
// (PRODUCTION_ESCROW_CHAIN_ID) instead of relying on silent defaults.
// ---------------------------------------------------------------------------

/** Production escrow chain ID (Celo Mainnet 42220). Re-exported for callers. */
export { PRODUCTION_ESCROW_CHAIN_ID };

/** Alias for the new-payment default chain (D1 = Celo Mainnet 42220). */
export const DEFAULT_NEW_PAYMENT_CHAIN_ID = PRODUCTION_ESCROW_CHAIN_ID;

/** Production escrow chain ID accessor (Celo Mainnet 42220). */
export function getProductionEscrowChainId(): number {
  return PRODUCTION_ESCROW_CHAIN_ID;
}

/** Production escrow contract config (explicit Celo Mainnet 42220). */
export function getProductionEscrowContractConfig() {
  return getEscrowContractConfig(PRODUCTION_ESCROW_CHAIN_ID);
}

/** Production escrow contract address (explicit Celo Mainnet 42220). */
export function getProductionEscrowContractAddress(): `0x${string}` {
  return getEscrowContractAddress(PRODUCTION_ESCROW_CHAIN_ID);
}
