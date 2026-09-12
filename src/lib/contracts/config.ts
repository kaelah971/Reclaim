import {
  celoChain,
  celoMainnetChain,
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
} from "@/lib/web3/chains";
import { getEscrowAddress } from "./addresses";
import { protectedPaymentEscrowABI } from "./ProtectedPaymentEscrow.abi";
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
