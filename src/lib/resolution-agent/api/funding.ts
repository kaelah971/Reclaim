// ---------------------------------------------------------------------------
// Resolution Agent API — Celo Mainnet USDC balance reader
//
// SERVER-ONLY — uses viem's createPublicClient to read ERC-20 balances from
// the Celo Mainnet chain.  Read-only, no write, no signing, no transfer.
//
// The FundingReader interface allows the service layer to determine whether
// an agent's case wallet has been sufficiently funded with USDC.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

// ---------------------------------------------------------------------------
// Canonical on-chain values
// ---------------------------------------------------------------------------

/** Celo Mainnet chain ID (42220). */
export const FUNDING_CHAIN_ID = 42220;

/**
 * Canonical USDC token contract address on Celo Mainnet.
 * Matches AGENT_MAINNET_USDC_ADDRESS in the types module.
 */
export const USDC_MAINNET_ADDRESS: `0x${string}` =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

// ---------------------------------------------------------------------------
// Minimal ERC-20 ABI — only balanceOf(address)
// ---------------------------------------------------------------------------

const erc20BalanceOfAbi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for reading USDC balances on-chain.
 *
 * Implementations:
 *  - {@link CeloMainnetFundingReader} — production, queries Celo Mainnet.
 *  - {@link MockFundingReader} — test double with a programmable balance map.
 */
export interface FundingReader {
  /**
   * Returns the USDC balance of `address` in atomic units (6 decimals).
   *
   * @throws if the RPC is unreachable or the contract read reverts.
   */
  getUsdcBalanceAtomic(address: string): Promise<bigint>;
}

// ---------------------------------------------------------------------------
// Production implementation — Celo Mainnet
// ---------------------------------------------------------------------------

/** Default Celo Mainnet RPC endpoint (public). */
const DEFAULT_CELO_MAINNET_RPC = "https://forno.celo.org";

/**
 * Reads USDC balances from the Celo Mainnet USDC contract via a viem
 * public client.  Uses `eth_call` under the hood — no transaction is
 * submitted, no gas is consumed, no private key is needed.
 */
export class CeloMainnetFundingReader implements FundingReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  /** The Celo Mainnet chain ID (42220), exposed for test assertions. */
  public readonly chainId: number = FUNDING_CHAIN_ID;

  /**
   * @param rpcUrl — Optional RPC endpoint override.  Defaults to the
   *   public Forno endpoint (`https://forno.celo.org`).
   */
  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: celo,
      transport: http(rpcUrl ?? DEFAULT_CELO_MAINNET_RPC),
    });
  }

  /**
   * Reads the raw `balanceOf` for the given address.
   *
   * @returns The USDC balance in atomic units (bigint).  USDC on Celo
   *          uses 6 decimals, so 1 USDC = 1_000_000 atomic units.
   * @throws if the RPC is unreachable or the address is invalid.
   */
  async getUsdcBalanceAtomic(address: string): Promise<bigint> {
    const balance = await this.client.readContract({
      address: USDC_MAINNET_ADDRESS,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });

    return balance;
  }

  /**
   * Legacy alias for {@link getUsdcBalanceAtomic}.  Provided for backward
   * compatibility with tests that reference `balanceOf`.
   * @deprecated Use {@link getUsdcBalanceAtomic} instead.
   */
  async balanceOf(address: string): Promise<bigint> {
    return this.getUsdcBalanceAtomic(address);
  }
}

// ---------------------------------------------------------------------------
// Test double — MockFundingReader
// ---------------------------------------------------------------------------

/**
 * In-memory funding reader for unit tests.
 *
 * Constructor overloads:
 *  - `new MockFundingReader()` — all addresses return `0n`.
 *  - `new MockFundingReader(bigint)` — single default balance for all addresses.
 *  - `new MockFundingReader(Map<string, bigint>)` — per-address balance map;
 *    addresses not in the map default to `0n`.
 *
 * Both `getUsdcBalanceAtomic(address)` (canonical) and `balanceOf(address)`
 * (legacy alias) are available.
 */
export class MockFundingReader implements FundingReader {
  private readonly balanceMap: Map<string, bigint>;
  private readonly defaultBalance: bigint;

  constructor(balances?: Map<string, bigint> | bigint) {
    if (balances instanceof Map) {
      this.balanceMap = balances;
      this.defaultBalance = 0n;
    } else if (typeof balances === "bigint") {
      this.balanceMap = new Map();
      this.defaultBalance = balances;
    } else {
      this.balanceMap = new Map();
      this.defaultBalance = 0n;
    }
  }

  /** Canonical funding reader method. */
  async getUsdcBalanceAtomic(address: string): Promise<bigint> {
    const normalized = address.toLowerCase();
    return this.balanceMap.get(normalized) ?? this.defaultBalance;
  }

  /**
   * Legacy alias for {@link getUsdcBalanceAtomic}.  Provided for backward
   * compatibility with tests that reference `balanceOf`.
   * @deprecated Use {@link getUsdcBalanceAtomic} instead.
   */
  async balanceOf(address: string): Promise<bigint> {
    return this.getUsdcBalanceAtomic(address);
  }
}
