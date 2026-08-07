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

const USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;
const USDC_FEE_CURRENCY_ADAPTER =
  "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as const;
const CELO_MAINNET_RPC = "https://forno.celo.org";
const ESTIMATED_GAS_LIMIT = 200_000n;
const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
]);

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

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

  async transferUsdc(params: {
    privateKey: string;
    from: string;
    to: string;
    amountAtomic: bigint;
    storedNonce?: number;
  }): Promise<{ txHash: string; nonce: number; transferAmount: bigint }> {
    const { privateKey, from, to, amountAtomic, storedNonce } = params;
    const isRetry = storedNonce !== undefined;

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const fromAddr = from as `0x${string}`;
    const toAddr = to as `0x${string}`;

    if (account.address.toLowerCase() !== fromAddr.toLowerCase()) {
      throw new Error("Private key does not match the from address.");
    }

    const publicClient = createPublicClient({
      chain: celo,
      transport: http(this.rpcUrl),
    });

    // The transfer amount is the FROZEN reclaimAmountAtomic from the
    // caller (closeResolutionAgent).  It is never mutated by this client.
    // On retry, the EXACT same amount, destination, and nonce are reused.
    let transferAmount = amountAtomic;

    if (!isRetry) {
      // First attempt: validate wallet has enough USDC to cover transfer + gas.
      // If amountAtomic doesn't leave enough room for gas, reduce to
      // balance - estimatedFee so the transaction can proceed.
      const balance = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_TRANSFER_ABI,
        functionName: "balanceOf",
        args: [fromAddr],
      })) as bigint;

      if (balance === 0n) {
        throw new Error("Wallet has zero USDC balance — nothing to transfer.");
      }

      const feeResult = await publicClient.estimateFeesPerGas();
      let gasPrice: bigint;
      if (feeResult && typeof feeResult === "object" && "maxFeePerGas" in feeResult) {
        gasPrice = (feeResult as { maxFeePerGas: bigint }).maxFeePerGas ?? 20_000_000_000n;
      } else if (feeResult && typeof feeResult === "object" && "gasPrice" in feeResult) {
        gasPrice = (feeResult as { gasPrice: bigint }).gasPrice;
      } else {
        gasPrice = 20_000_000_000n;
      }
      const estimatedFee = gasPrice * ESTIMATED_GAS_LIMIT;

      if (balance < estimatedFee) {
        throw new Error(
          `Wallet balance (${balance}) is too low to cover the estimated fee (${estimatedFee}).`,
        );
      }

      // Cap the transfer amount so that balance covers both transfer and gas
      const maxTransferable = balance - estimatedFee;
      if (amountAtomic > maxTransferable) {
        transferAmount = maxTransferable;
      }
    }

    // Estimate gas price (needed for the transaction on both first and retry)
    const feeResult = await publicClient.estimateFeesPerGas();
    let gasPrice: bigint;
    if (feeResult && typeof feeResult === "object" && "maxFeePerGas" in feeResult) {
      gasPrice = (feeResult as { maxFeePerGas: bigint }).maxFeePerGas ?? 20_000_000_000n;
    } else if (feeResult && typeof feeResult === "object" && "gasPrice" in feeResult) {
      gasPrice = (feeResult as { gasPrice: bigint }).gasPrice;
    } else {
      gasPrice = 20_000_000_000n;
    }

    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [toAddr, transferAmount],
    });

    const nonce = storedNonce ?? (await publicClient.getTransactionCount({
      address: fromAddr,
    }));

    const walletClient = createWalletClient({
      account,
      chain: celo,
      transport: http(this.rpcUrl),
    });

    const txHash = await walletClient.sendTransaction({
      account,
      to: USDC_ADDRESS,
      data: transferData,
      value: 0n,
      gas: ESTIMATED_GAS_LIMIT,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice / 2n,
      nonce,
      feeCurrency: USDC_FEE_CURRENCY_ADAPTER as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      chain: celo,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    return { txHash: txHash as string, nonce, transferAmount };
  }
}
