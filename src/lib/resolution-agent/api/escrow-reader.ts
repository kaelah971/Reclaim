// ---------------------------------------------------------------------------
// SERVER-ONLY
// Reads authoritative case party info from the canonical escrow contract on
// Celo Sepolia.  The escrow contract is the authoritative source of truth for
// who the client and worker are for a given payment case.
//
// This is used by the service layer to enforce that only legitimate case
// participants (client or worker) may create or view resolution agents.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { getEscrowAddress } from "@/lib/contracts/addresses";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";

// ---------------------------------------------------------------------------
// Canonical constants — server-owned, never user-provided
// ---------------------------------------------------------------------------

/** Canonical escrow chain ID (numeric, for viem contract calls). */
export const CANONICAL_ESCROW_CHAIN_ID = CELO_CHAIN_ID; // 11142220

/** Canonical escrow contract address for the active chain. */
export const CANONICAL_ESCROW_CONTRACT_ADDRESS =
  getEscrowAddress(CELO_CHAIN_ID)!;

// ---------------------------------------------------------------------------
// Case parties result
// ---------------------------------------------------------------------------

/** Authoritative case-party information read directly from the escrow contract. */
export interface CaseParties {
  /** The client (payer) address for this payment. */
  client: `0x${string}`;
  /** The worker (payee) address for this payment. */
  worker: `0x${string}`;
  /** Whether the payment exists on-chain.  When false, client/worker are zero. */
  exists: boolean;
}

// ---------------------------------------------------------------------------
// Reader interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for reading authoritative case-party information.
 *
 * Implementations:
 *  - {@link CeloSepoliaEscrowCaseReader} — production, queries Celo Sepolia.
 *  - {@link MockEscrowCaseReader} — test double with a programmable map.
 */
export interface EscrowCaseAuthorizationReader {
  /**
   * Returns the client and worker addresses for the given escrow payment.
   *
   * @throws if the payment ID is malformed (not numeric).
   * @throws if the RPC is unreachable.
   */
  getCaseParties(caseIdentity: {
    escrowPaymentId: string;
  }): Promise<CaseParties>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Default Celo Sepolia public RPC endpoint (Forno). */
const DEFAULT_CELO_SEPOLIA_RPC = "https://sepolia-forno.celo.org";

/** Zero address sentinel for non-existent payments. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * Parses a raw escrow payment ID string into a bigint suitable for the
 * contract's `getPayment(uint256)` call.  Hyphens and whitespace are
 * stripped before validation so that formatted IDs are accepted, but the
 * underlying value must be numeric.
 */
function parsePaymentIdToBigInt(raw: string): bigint {
  const cleaned = raw.replace(/[-\s]/g, "");
  if (!/^[0-9]+$/.test(cleaned)) {
    throw new Error(
      `Invalid escrow payment ID: "${raw}" — must be a numeric identifier.`,
    );
  }
  return BigInt(cleaned);
}

// ---------------------------------------------------------------------------
// Production implementation — Celo Sepolia escrow contract
// ---------------------------------------------------------------------------

/**
 * Reads case-party information from the canonical ProtectedPaymentEscrow
 * contract on Celo Sepolia via `getPayment(paymentId)`.
 */
export class CeloSepoliaEscrowCaseReader
  implements EscrowCaseAuthorizationReader
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  /** The canonical escrow chain ID (numeric), exposed for test assertions. */
  public readonly chainId: number = CANONICAL_ESCROW_CHAIN_ID;

  /** The canonical escrow contract address, exposed for test assertions. */
  public readonly contractAddress: `0x${string}` = CANONICAL_ESCROW_CONTRACT_ADDRESS;

  /**
   * @param rpcUrl — Optional RPC endpoint override.  Defaults to the
   *   public Celo Sepolia Forno endpoint.
   */
  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl ?? DEFAULT_CELO_SEPOLIA_RPC),
    });
  }

  /**
   * Calls `getPayment(paymentId)` on the canonical escrow contract and
   * extracts the `client` and `worker` addresses from the returned struct.
   *
   * If the payment does not exist on-chain (contract reverts with
   * `PaymentNotFound`), returns `{ exists: false }` with zero addresses.
   */
  async getCaseParties(caseIdentity: {
    escrowPaymentId: string;
  }): Promise<CaseParties> {
    const paymentId = parsePaymentIdToBigInt(caseIdentity.escrowPaymentId);

    try {
      // `getPayment(uint256)` returns the full Payment struct.
      // viem decodes the named tuple components as object properties.
      const payment = (await this.client.readContract({
        address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        abi: protectedPaymentEscrowABI,
        functionName: "getPayment",
        args: [paymentId],
      })) as { client: `0x${string}`; worker: `0x${string}` };

      return { client: payment.client, worker: payment.worker, exists: true };
    } catch (error: unknown) {
      // Contract reverts with PaymentNotFound when the payment ID does not
      // exist.  We also handle generic reverts to avoid crashing.
      const errMsg = error instanceof Error ? error.message : String(error);
      if (
        errMsg.includes("PaymentNotFound") ||
        errMsg.includes("revert") ||
        errMsg.includes("execution reverted")
      ) {
        return {
          client: ZERO_ADDRESS,
          worker: ZERO_ADDRESS,
          exists: false,
        };
      }
      // Re-throw unexpected errors (RPC failures, etc.)
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Test double — MockEscrowCaseReader
// ---------------------------------------------------------------------------

/**
 * In-memory escrow reader for unit tests.
 *
 * Pre-populate the case-parties map via {@link setCaseParties}.  Payment IDs
 * are matched case-insensitively.  Any payment ID not explicitly configured
 * returns `{ exists: false }`.
 */
export class MockEscrowCaseReader implements EscrowCaseAuthorizationReader {
  private readonly casePartiesMap: Map<string, CaseParties>;

  /**
   * @param casePartiesMap — Optional pre-populated map of payment ID →
   *   case parties.  Defaults to an empty map (all payments return
   *   `{ exists: false }`).
   */
  constructor(casePartiesMap?: Map<string, CaseParties>) {
    this.casePartiesMap = casePartiesMap ?? new Map();
  }

  /** Register case parties for a payment ID (case-insensitive key). */
  setCaseParties(paymentId: string, parties: CaseParties): void {
    this.casePartiesMap.set(paymentId.toLowerCase(), parties);
  }

  async getCaseParties(caseIdentity: {
    escrowPaymentId: string;
  }): Promise<CaseParties> {
    const key = caseIdentity.escrowPaymentId.toLowerCase();
    const parties = this.casePartiesMap.get(key);
    if (parties) return parties;
    return {
      client: ZERO_ADDRESS,
      worker: ZERO_ADDRESS,
      exists: false,
    };
  }
}
