// ---------------------------------------------------------------------------
// Celo Mainnet USDC Reclaim Transfer Client
//
// Real production implementation that pays gas in USDC via Celo's fee-currency
// abstraction (CIP-64).  Uses viem to construct, sign, and broadcast ERC-20
// transfers on Celo Mainnet.
//
// SERVER-ONLY — imports viem, never use in browser bundles.
// ---------------------------------------------------------------------------

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { ReclaimTransferClient } from "../api/service";

// ---------------------------------------------------------------------------
// Canonical Celo Mainnet constants
// ---------------------------------------------------------------------------

/** Celo Mainnet native USDC token address. */
const USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;

/** Official Celo USDC fee-currency adapter (CIP-64). */
const USDC_FEE_CURRENCY_ADAPTER =
  "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as const;

/** Public Celo Mainnet Forno RPC endpoint. */
const CELO_MAINNET_RPC = "https://forno.celo.org";

/** Estimated gas limit for a simple ERC-20 transfer via fee currency. */
const ESTIMATED_GAS_LIMIT = 200_000n;

/** ERC-20 transfer ABI fragment. */
const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
]);

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Real Celo Mainnet USDC reclaim transfer client.
 *
 * Transfers the full available USDC balance (minus estimated gas paid in USDC)
 * from the case wallet to the funder, using Celo's feeCurrency mechanism so
 * gas is paid in USDC rather than requiring a separate CELO balance.
 *
 * Crash safety:
 *  - If `storedNonce` is provided (retry after crash), the client constructs
 *    the transaction with the SAME nonce.  If the original tx already mined,
 *    the new broadcast will fail with "nonce too low", preventing duplicates.
 */
export class CeloReclaimTransferClient implements ReclaimTransferClient {
  private readonly rpcUrl: string;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl ?? CELO_MAINNET_RPC;
  }

  async fetchNonce(from: string): Promise<number> {
    const publicClient = createPublicClient({
      chain: celo,
      transport: http(this.rpcUrl),
    });
    return publicClient.getTransactionCount({
      address: from as `0x${string}`,
    });
  }

  /**
   * Transfer USDC from the case wallet to the funder.
   *
   * Fee estimation: Uses `estimateFeesPerGas` on Celo to get the current
   * gas price in fee-currency units.  The transfer amount is
   * `balance - estimated_fee`, ensuring the wallet can cover gas without
   * a separate CELO balance.
   */
  async transferUsdc(params: {
    privateKey: string;
    from: string;
    to: string;
    amountAtomic: bigint;
    storedNonce?: number;
  }): Promise<{ txHash: string; nonce: number }> {
    const { privateKey, from, to, amountAtomic, storedNonce } = params;

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const fromAddr = from as `0x${string}`;
    const toAddr = to as `0x${string}`;

    if (account.address.toLowerCase() !== fromAddr.toLowerCase()) {
      throw new Error("Private key does not match the from address.");
    }

    // 1. Create clients
    const publicClient = createPublicClient({
      chain: celo,
      transport: http(this.rpcUrl),
    });

    // 2. Read current USDC balance
    const balance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_TRANSFER_ABI,
      functionName: "balanceOf",
      args: [fromAddr],
    })) as bigint;

    if (balance === 0n) {
      throw new Error("Wallet has zero USDC balance — nothing to transfer.");
    }

    // 3. Estimate gas fees
    const feeResult = await publicClient.estimateFeesPerGas();

    let gasPrice: bigint;
    if (feeResult && typeof feeResult === "object" && "maxFeePerGas" in feeResult) {
      gasPrice = (feeResult as { maxFeePerGas: bigint }).maxFeePerGas ?? 20_000_000_000n;
    } else if (feeResult && typeof feeResult === "object" && "gasPrice" in feeResult) {
      gasPrice = (feeResult as { gasPrice: bigint }).gasPrice;
    } else {
      gasPrice = 20_000_000_000n; // 20 gwei fallback
    }

    const estimatedFee = gasPrice * ESTIMATED_GAS_LIMIT;

    // 4. Calculate safe transfer amount (leave room for gas)
    let transferAmount: bigint;
    if (amountAtomic > balance - estimatedFee && balance > estimatedFee) {
      transferAmount = balance - estimatedFee;
    } else if (balance <= estimatedFee) {
      throw new Error(
        `Wallet balance (${balance} atomic USDC) is too low to cover the estimated transfer fee (${estimatedFee}).`,
      );
    } else {
      transferAmount = amountAtomic;
    }

    // 5. Encode ERC-20 transfer
    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [toAddr, transferAmount],
    });

    // 6. Get nonce
    const nonce = storedNonce ?? (await publicClient.getTransactionCount({
      address: fromAddr,
    }));

    // 7. Create wallet client for signing
    const walletClient = createWalletClient({
      account,
      chain: celo,
      transport: http(this.rpcUrl),
    });

    // 8. Send transaction with feeCurrency
    const txHash = await walletClient.sendTransaction({
      account,
      to: USDC_ADDRESS,
      data: transferData,
      value: 0n,
      gas: ESTIMATED_GAS_LIMIT,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice / 2n,
      nonce,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      feeCurrency: USDC_FEE_CURRENCY_ADAPTER as any,
      chain: celo,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    return { txHash: txHash as string, nonce };
  }
}
