import { celoChain, CELO_CHAIN_ID } from "@/lib/web3/chains";
import { getEscrowAddress } from "./addresses";
import { protectedPaymentEscrowABI } from "./ProtectedPaymentEscrow.abi";
import type { Chain } from "viem/chains";

// ---------------------------------------------------------------------------
// Deployed contract configuration — single source of truth for the frontend.
// The address comes from src/lib/contracts/addresses.ts (canonical deployment
// record) with an optional NEXT_PUBLIC_PROTECTED_PAYMENT_ESCROW_ADDRESS
// environment override.
// ---------------------------------------------------------------------------

/**
 * Returns the deployed escrow contract address as a checksummed address.
 */
export function getEscrowContractAddress(): `0x${string}` {
  const address = getEscrowAddress(CELO_CHAIN_ID);
  if (!address) {
    throw new Error(
      `ProtectedPaymentEscrow is not deployed on chain ${CELO_CHAIN_ID}.`,
    );
  }
  return address;
}

/**
 * Returns a full wagmi contract config object suitable for use with
 * useReadContract / useWriteContract.
 */
export function getEscrowContractConfig() {
  return {
    address: getEscrowContractAddress(),
    abi: protectedPaymentEscrowABI,
  } as const;
}

/**
 * Returns a wagmi chain config for the escrow deployment.
 */
export function getEscrowChain(): Chain {
  return celoChain;
}

/**
 * Returns the escrow contract's chain ID.
 */
export function getEscrowChainId(): number {
  return celoChain.id;
}
