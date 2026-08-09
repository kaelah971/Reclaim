// ---------------------------------------------------------------------------
// SERVER-ONLY â€” Final-settlement chain provenance (RA1R.8F)
//
// Read-only proof of the escrow outcome for a released payment:
//   - getPayment(paymentId) â€” authoritative final state
//   - PaymentReleased(paymentId) â€” the release transaction (approveRelease)
//   - DeliveryEvidenceSubmitted(paymentId) â€” the evidence submission tx
//
// All reads only. No transactions, no agent runs, no x402 calls.
//
// NOTE: Celo Sepolia public RPCs cap eth_getLogs ranges, so the log lookup
// is bounded to a window around the on-chain timestamps (releasedAt /
// deliveryAt), estimated from the recent average block time.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "@/lib/resolution-agent/api/escrow-reader";

/**
 * Minimal structural view of the public client used here. Kept loose on
 * purpose: the receipt proof reader only needs read calls, and viem's
 * generic chains make exact public-client typing brittle across versions.
 */
interface ChainReadClient {
  getBlock(args: unknown): Promise<{ number: bigint | null; timestamp: bigint }>;
  getLogs(args: unknown): Promise<
    Array<{ transactionHash: `0x${string}`; blockNumber: bigint | null; args?: Record<string, unknown> | null }>
  >;
  getTransactionReceipt(args: unknown): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint | null;
  }>;
  getTransaction(args: unknown): Promise<{ from: `0x${string}` }>;
  readContract(args: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Canonical constants
// ---------------------------------------------------------------------------

const DEFAULT_SEPOLIA_RPC = "https://rpc.ankr.com/celo_sepolia";

const PAYMENT_RELEASED_EVENT = {
  type: "event",
  name: "PaymentReleased",
  inputs: [
    { type: "uint256", indexed: true, name: "paymentId" },
    { type: "address", indexed: true, name: "client" },
    { type: "address", indexed: true, name: "worker" },
    { type: "uint256", indexed: false, name: "amount" },
  ],
} as const;

const EVIDENCE_SUBMITTED_EVENT = {
  type: "event",
  name: "DeliveryEvidenceSubmitted",
  inputs: [
    { type: "uint256", indexed: true, name: "paymentId" },
    { type: "bytes32", indexed: false, name: "evidenceReference" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ChainReleaseProof {
  txHash: string | null;
  status: "success" | "reverted" | null;
  sender: string | null;
  blockNumber: string | null;
  blockTime: string | null;
}

export interface ChainEvidenceProof {
  txHash: string | null;
  blockNumber: string | null;
  blockTime: string | null;
}

export interface ChainFinalState {
  state: string;
  stateLabel: string | null;
  client: string;
  worker: string;
  token: string;
  amount: string;
  evidenceReference: string;
  disputeReference: string;
  deliveryAt: string | null;
  releaseRequestedAt: string | null;
  releasedAt: string | null;
  agreementLabel: string | null;
  deliverableSummary: string | null;
  deliveryFormat: string | null;
  releaseRule: string | null;
  evidenceExpectation: string | null;
  deliveryDeadline: string | null;
  autoReleaseSeconds: string | null;
  disputeWindowSeconds: string | null;
}

export interface ChainFinalProof {
  paymentId: string;
  state: ChainFinalState;
  release: ChainReleaseProof;
  evidenceSubmission: ChainEvidenceProof;
}

// ---------------------------------------------------------------------------
// Bounded log scan helper
// ---------------------------------------------------------------------------

/**
 * Find the latest block whose timestamp is <= targetUnix via binary search
 * over block numbers (block timestamps are non-decreasing).
 */
async function findBlockAtOrBeforeTimestamp(
  client: ChainReadClient,
  headNum: bigint,
  targetUnix: number,
): Promise<bigint> {
  let lo = 1n;
  let hi = headNum;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) <= targetUnix) {
      lo = mid;
    } else {
      hi = mid - 1n;
    }
  }
  return lo;
}

/**
 * Build a narrow window around the block for a target timestamp, staying
 * within the head block and small enough for public RPC log limits.
 */
async function estimateLogWindow(
  client: ChainReadClient,
  targetUnix: number,
): Promise<{ fromBlock: bigint; toBlock: bigint }> {
  const head = await client.getBlock({ blockTag: "latest" });
  const headNum = head.number as bigint;
  const headTs = Number(head.timestamp);

  if (targetUnix <= 0 || headTs <= targetUnix) {
    // No timestamp yet (or in the future) — scan the most recent window only.
    return {
      fromBlock: BigInt(Math.max(0, Number(headNum) - 200)),
      toBlock: headNum,
    };
  }

  const targetBlock = await findBlockAtOrBeforeTimestamp(client, headNum, targetUnix);
  // Scan a tight window around the target block (±100 blocks), clamped to head.
  const fromBlock = BigInt(Math.max(1, Number(targetBlock) - 100));
  const toBlock = BigInt(Math.min(Number(headNum), Number(targetBlock) + 100));
  return { fromBlock, toBlock };
}

interface FoundLog {
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  args: Record<string, unknown>;
}

/** Find the latest event log for a payment within the estimated window. */
async function findLatestLog(
  client: ChainReadClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  paymentId: bigint,
  targetUnix: number,
): Promise<FoundLog | null> {
  const { fromBlock, toBlock } = await estimateLogWindow(client, targetUnix);
  const logs = await client.getLogs({
    address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
    event,
    args: { paymentId },
    fromBlock,
    toBlock,
  });
  const latest = logs[logs.length - 1];
  if (!latest) return null;
  return {
    transactionHash: latest.transactionHash,
    blockNumber: latest.blockNumber as bigint,
    args: latest.args as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Production reader
// ---------------------------------------------------------------------------

export class CeloSepoliaChainFinalProofReader {
  private readonly client: ChainReadClient;

  /** Chain label for the canonical escrow (Celo Sepolia). */
  public readonly network = "Celo Sepolia";

  constructor(rpcUrl?: string) {
    this.client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl ?? DEFAULT_SEPOLIA_RPC, { timeout: 15000 }),
    });
  }

  /** Read the authoritative final state via getPayment(paymentId). */
  async getFinalState(paymentId: bigint): Promise<ChainFinalState | null> {
    try {
      const payment = (await this.client.readContract({
        address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        abi: protectedPaymentEscrowABI,
        functionName: "getPayment",
        args: [paymentId],
      })) as Record<string, unknown>;

      const stateNum = Number(payment.state as bigint);
      const stateLabels: Record<number, string> = {
        0: "created",
        1: "funded",
        2: "accepted",
        3: "delivered",
        4: "release_requested",
        5: "released",
        6: "disputed",
        7: "cancelled",
        8: "refunded",
      };
      return {
        state: String(stateNum),
        stateLabel: stateLabels[stateNum] ?? null,
        client: payment.client as string,
        worker: payment.worker as string,
        token: payment.token as string,
        amount: (payment.amount as bigint).toString(),
        evidenceReference: payment.evidenceReference as string,
        disputeReference: payment.disputeReference as string,
        deliveryAt: this.toIso(payment.deliveryAt as bigint),
        releaseRequestedAt: this.toIso(payment.releaseRequestedAt as bigint),
        releasedAt: this.toIso(payment.releasedAt as bigint),
        agreementLabel: payment.agreementLabel as string | null,
        deliverableSummary: payment.deliverableSummary as string | null,
        deliveryFormat: payment.deliveryFormat as string | null,
        releaseRule: payment.releaseRule as string | null,
        evidenceExpectation: payment.evidenceExpectation as string | null,
        deliveryDeadline: this.toIso(payment.deliveryDeadline as bigint),
        autoReleaseSeconds: (payment.autoReleaseSeconds as bigint)?.toString() ?? null,
        disputeWindowSeconds: (payment.disputeWindowSeconds as bigint)?.toString() ?? null,
      };
    } catch {
      return null; // PaymentNotFound or RPC failure â€” treated as absent.
    }
  }

  /** Prove the approveRelease transaction for a released payment. */
  async getReleaseProof(paymentId: bigint, releasedAtUnix: number): Promise<ChainReleaseProof> {
    try {
      const log = await findLatestLog(this.client, PAYMENT_RELEASED_EVENT, paymentId, releasedAtUnix);
      if (!log) return { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null };

      const receipt = await this.client.getTransactionReceipt({ hash: log.transactionHash });
      const tx = await this.client.getTransaction({ hash: log.transactionHash });
      const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
      return {
        txHash: log.transactionHash,
        status: receipt.status,
        sender: tx.from,
        blockNumber: receipt.blockNumber?.toString() ?? null,
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    } catch {
      return { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null };
    }
  }

  /** Prove the on-chain evidence submission (DeliveryEvidenceSubmitted). */
  async getEvidenceSubmissionProof(
    paymentId: bigint,
    deliveryAtUnix: number,
  ): Promise<ChainEvidenceProof> {
    try {
      const log = await findLatestLog(this.client, EVIDENCE_SUBMITTED_EVENT, paymentId, deliveryAtUnix);
      if (!log) return { txHash: null, blockNumber: null, blockTime: null };
      const block = await this.client.getBlock({ blockNumber: log.blockNumber });
      return {
        txHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    } catch {
      return { txHash: null, blockNumber: null, blockTime: null };
    }
  }

  /** Full read-only proof bundle for a payment. */
  async readFinalProof(paymentId: bigint): Promise<ChainFinalProof | null> {
    const state = await this.getFinalState(paymentId);
    if (!state) return null;

    const releasedAtUnix = state.releasedAt
      ? Math.floor(new Date(state.releasedAt).getTime() / 1000)
      : 0;
    const deliveryAtUnix = state.deliveryAt
      ? Math.floor(new Date(state.deliveryAt).getTime() / 1000)
      : 0;

    const [release, evidenceSubmission] = await Promise.all([
      this.getReleaseProof(paymentId, releasedAtUnix),
      this.getEvidenceSubmissionProof(paymentId, deliveryAtUnix),
    ]);

    return {
      paymentId: paymentId.toString(),
      state,
      release,
      evidenceSubmission,
    };
  }

  private toIso(unixBigint: bigint): string | null {
    const n = Number(unixBigint);
    if (n <= 0) return null;
    return new Date(n * 1000).toISOString();
  }
}

