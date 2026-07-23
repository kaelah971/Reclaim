import { CELO_CHAIN_ID } from "@/lib/web3/chains";

/**
 * Canonical deployed contract addresses per chain.
 *
 * Celo Sepolia V1 deployment (historical — no dispute resolution):
 * - Deploy tx: 0xa452b3d39fa00356f4c13bb4f46988c2de281640800d0856e6e67b3bc5924312
 * - Block:     31013036
 * - Address:   0x0fA826256a58F19Ad24Fc9384d81D313f2266F79
 * - Record:    contracts/deployments/celo-sepolia.json
 *
 * Celo Sepolia V2 deployment (current — with resolveDispute):
 * - Deploy tx: 0x20ec89bc474ae6f4c72caedfb9878d3e80e1773e2efcf4a23dab18fa0b48b102
 * - Block:     31902616
 * - Address:   0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F
 * - Record:    contracts/deployments/celo-sepolia.json
 */
export const DEPLOYED_ADDRESSES = {
  [11142220]: {
    /** V2 — current canonical escrow with dispute resolution. */
    protectedPaymentEscrow:
      "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F" as `0x${string}`,
    /** V1 — historical escrow without resolveDispute. */
    protectedPaymentEscrowV1:
      "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79" as `0x${string}`,
  },
} as const;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Optional environment override for the escrow address. Falls back to the
 * canonical deployed address for the active chain when unset or malformed.
 */
const ENV_ESCROW_ADDRESS =
  process.env.NEXT_PUBLIC_PROTECTED_PAYMENT_ESCROW_ADDRESS;

export function getEscrowAddress(chainId: number): `0x${string}` | undefined {
  if (
    chainId === CELO_CHAIN_ID &&
    ENV_ESCROW_ADDRESS &&
    ADDRESS_PATTERN.test(ENV_ESCROW_ADDRESS)
  ) {
    return ENV_ESCROW_ADDRESS as `0x${string}`;
  }
  const chain = (
    DEPLOYED_ADDRESSES as Record<
      number,
      { protectedPaymentEscrow: `0x${string}` }
    >
  )[chainId];
  return chain?.protectedPaymentEscrow;
}
