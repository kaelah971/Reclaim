// ---------------------------------------------------------------------------
// SERVER-ONLY â€” Final-settlement chain provenance (RA1R.8F)
//
// Read-only proof of the escrow outcome for a payment:
//   - getPayment(paymentId) â€” authoritative final state
//   - PaymentReleased / PaymentDisputed / PaymentResolved / PaymentCancelled
//     lifecycle transaction proofs
//   - DeliveryEvidenceSubmitted(paymentId) â€” the evidence submission tx
//
// All reads only. No transactions, no agent runs, no x402 calls.
//
// NOTE: Celo Sepolia public RPCs cap eth_getLogs ranges, so the log lookup
// is bounded to a window around the on-chain timestamps (releasedAt /
// deliveryAt), estimated from the recent average block time.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { getEscrowAddress } from "@/lib/contracts/addresses";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  celoMainnetChain,
  celoSepoliaChain,
  getCeloChain,
  isSupportedChain,
} from "@/lib/web3/chains";

/**
 * Minimal structural view of the public client used here. Kept loose on
 * purpose: the receipt proof reader only needs read calls, and viem's
 * generic chains make exact public-client typing brittle across versions.
 */
export interface ChainReadClient {
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
const DEFAULT_MAINNET_RPC = "https://forno.celo.org";

/** Resolve the default read-only RPC for a supported escrow chain. */
function getDefaultRpcForChain(chainId: number): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL || DEFAULT_MAINNET_RPC;
  }
  return (
    process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    DEFAULT_SEPOLIA_RPC
  );
}

/**
 * Resolve and validate a chain-aware provenance config.
 *
 * Never trusts a URL chain alone: the chain must be in the canonical
 * supported mapping and must have a deployed escrow address.
 *
 * @throws when the chain is unsupported or has no deployed escrow.
 */
export function resolveChainProvenanceConfig(chainId: number): {
  chainId: number;
  contractAddress: `0x${string}`;
} {
  if (!isSupportedChain(chainId)) {
    throw new Error(`Unsupported escrow chain ${chainId}.`);
  }
  const contractAddress = getEscrowAddress(chainId);
  if (!contractAddress) {
    throw new Error(
      `ProtectedPaymentEscrow is not deployed on chain ${chainId}.`,
    );
  }
  return { chainId, contractAddress };
}

/** Parse an explicit chainId input, defaulting to Celo Sepolia. */
export function parseProvenanceChainId(raw: unknown): number {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return CELO_SEPOLIA_CHAIN_ID;
  }
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported escrow chain ${String(raw)}.`);
  }
  return resolveChainProvenanceConfig(parsed).chainId;
}

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

const PAYMENT_DISPUTED_EVENT = {
  type: "event",
  name: "PaymentDisputed",
  inputs: [
    { type: "uint256", indexed: true, name: "paymentId" },
    { type: "address", indexed: true, name: "disputer" },
    { type: "bytes32", indexed: false, name: "disputeReference" },
  ],
} as const;

const PAYMENT_RESOLVED_EVENT = {
  type: "event",
  name: "PaymentResolved",
  inputs: [
    { type: "uint256", indexed: true, name: "paymentId" },
    { type: "address", indexed: true, name: "resolver" },
    { type: "address", indexed: false, name: "client" },
    { type: "address", indexed: false, name: "worker" },
    { type: "uint256", indexed: false, name: "clientAmount" },
    { type: "uint256", indexed: false, name: "workerAmount" },
  ],
} as const;

const PAYMENT_CANCELLED_EVENT = {
  type: "event",
  name: "PaymentCancelled",
  inputs: [
    { type: "uint256", indexed: true, name: "paymentId" },
    { type: "address", indexed: true, name: "client" },
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

/** Proof shared by non-release escrow lifecycle events. */
export interface ChainEventProof {
  txHash: string | null;
  status: "success" | "reverted" | null;
  sender: string | null;
  blockNumber: string | null;
  blockTime: string | null;
}

export interface ChainDisputeProof extends ChainEventProof {
  disputeReference: string | null;
}

export interface ChainResolutionProof extends ChainEventProof {
  clientAmount: string | null;
  workerAmount: string | null;
}

export type ChainCancellationProof = ChainEventProof;

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
  createdAt: string | null;
}

export interface ChainFinalProof {
  paymentId: string;
  state: ChainFinalState;
  release: ChainReleaseProof;
  evidenceSubmission: ChainEvidenceProof;
  dispute: ChainDisputeProof;
  resolution: ChainResolutionProof;
  cancellation: ChainCancellationProof;
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
  contractAddress: `0x${string}`,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  paymentId: bigint,
  targetUnix: number,
): Promise<FoundLog | null> {
  const { fromBlock, toBlock } = await estimateLogWindow(client, targetUnix);
  const logs = await client.getLogs({
    address: contractAddress,
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

function emptyEventProof(): ChainEventProof {
  return {
    txHash: null,
    status: null,
    sender: null,
    blockNumber: null,
    blockTime: null,
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Read receipt, sender, and block time for a lifecycle event log. */
async function readEventProof(
  client: ChainReadClient,
  log: FoundLog,
): Promise<ChainEventProof> {
  const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
  const tx = await client.getTransaction({ hash: log.transactionHash });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber ?? log.blockNumber });
  return {
    txHash: log.transactionHash,
    status: receipt.status,
    sender: tx.from,
    blockNumber: receipt.blockNumber?.toString() ?? log.blockNumber.toString(),
    blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Production reader — chain-aware (Sepolia default, Mainnet supported)
// ---------------------------------------------------------------------------

export interface CeloChainFinalProofReaderOptions {
  chainId?: number;
  rpcUrl?: string;
  client?: ChainReadClient;
}

/**
 * Chain-aware final-proof reader.
 *
 * Contract address + RPC resolve from the canonical per-chain config
 * (src/lib/contracts/addresses.ts + src/lib/web3/chains.ts). Sepolia is the
 * default to preserve existing behavior; pass 42220 for Celo Mainnet.
 */
export class CeloChainFinalProofReader {
  private readonly client: ChainReadClient;

  /** Canonical escrow chain ID for this reader. */
  public readonly chainId: number;

  /** Canonical escrow contract address for this reader's chain. */
  public readonly contractAddress: `0x${string}`;

  /** Human-readable chain label for receipts. */
  public readonly network: string;

  constructor(
    chainIdOrOptions?: number | CeloChainFinalProofReaderOptions,
    rpcUrl?: string,
    client?: ChainReadClient,
  ) {
    let chainId: number = CELO_SEPOLIA_CHAIN_ID;
    let resolvedRpcUrl = rpcUrl;
    let resolvedClient = client;
    if (
      typeof chainIdOrOptions === "object" &&
      chainIdOrOptions !== null
    ) {
      if (chainIdOrOptions.chainId !== undefined) chainId = chainIdOrOptions.chainId;
      if (chainIdOrOptions.rpcUrl !== undefined) resolvedRpcUrl = chainIdOrOptions.rpcUrl;
      if (chainIdOrOptions.client !== undefined) resolvedClient = chainIdOrOptions.client;
    } else if (typeof chainIdOrOptions === "number") {
      chainId = chainIdOrOptions;
    }

    const { contractAddress } = resolveChainProvenanceConfig(chainId);
    const chainDefinition =
      getCeloChain(chainId) ??
      (chainId === CELO_MAINNET_CHAIN_ID ? celoMainnetChain : celoSepoliaChain);

    this.chainId = chainId;
    this.contractAddress = contractAddress;
    this.network =
      chainId === CELO_MAINNET_CHAIN_ID ? "Celo Mainnet" : "Celo Sepolia";
    this.client =
      resolvedClient ??
      createPublicClient({
        chain: chainDefinition,
        transport: http(resolvedRpcUrl ?? getDefaultRpcForChain(chainId), {
          timeout: 15000,
        }),
      });
  }

  /** Read the authoritative final state via getPayment(paymentId). */
  async getFinalState(paymentId: bigint): Promise<ChainFinalState | null> {
    try {
      const payment = (await this.client.readContract({
        address: this.contractAddress,
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
        8: "resolved",
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
          createdAt: this.toIso(payment.createdAt as bigint),
        };
    } catch {
      return null; // PaymentNotFound or RPC failure â€” treated as absent.
    }
  }

  /** Prove the approveRelease transaction for a released payment. */
  async getReleaseProof(paymentId: bigint, releasedAtUnix: number): Promise<ChainReleaseProof> {
    try {
      const log = await findLatestLog(this.client, this.contractAddress, PAYMENT_RELEASED_EVENT, paymentId, releasedAtUnix);
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

  /** Prove the PaymentDisputed transaction for a disputed payment. */
  async getDisputeProof(paymentId: bigint, disputedAtUnix = 0): Promise<ChainDisputeProof> {
    try {
      const log = await findLatestLog(this.client, this.contractAddress, PAYMENT_DISPUTED_EVENT, paymentId, disputedAtUnix);
      if (!log) return { ...emptyEventProof(), disputeReference: null };
      const proof = await readEventProof(this.client, log);
      return {
        ...proof,
        disputeReference: stringValue(log.args.disputeReference),
      };
    } catch {
      return { ...emptyEventProof(), disputeReference: null };
    }
  }

  /** Prove the PaymentResolved transaction and its client/worker allocations. */
  async getResolutionProof(paymentId: bigint, resolvedAtUnix: number): Promise<ChainResolutionProof> {
    try {
      const log = await findLatestLog(this.client, this.contractAddress, PAYMENT_RESOLVED_EVENT, paymentId, resolvedAtUnix);
      if (!log) return { ...emptyEventProof(), clientAmount: null, workerAmount: null };
      const proof = await readEventProof(this.client, log);
      return {
        ...proof,
        clientAmount: stringValue(log.args.clientAmount),
        workerAmount: stringValue(log.args.workerAmount),
      };
    } catch {
      return { ...emptyEventProof(), clientAmount: null, workerAmount: null };
    }
  }

  /** Prove the PaymentCancelled transaction for an unfunded payment. */
  async getCancellationProof(paymentId: bigint, createdAtUnix = 0): Promise<ChainCancellationProof> {
    try {
      const log = await findLatestLog(this.client, this.contractAddress, PAYMENT_CANCELLED_EVENT, paymentId, createdAtUnix);
      if (!log) return emptyEventProof();
      return readEventProof(this.client, log);
    } catch {
      return emptyEventProof();
    }
  }

  /** Prove the on-chain evidence submission (DeliveryEvidenceSubmitted). */
  async getEvidenceSubmissionProof(
    paymentId: bigint,
    deliveryAtUnix: number,
  ): Promise<ChainEvidenceProof> {
    try {
      const log = await findLatestLog(this.client, this.contractAddress, EVIDENCE_SUBMITTED_EVENT, paymentId, deliveryAtUnix);
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

    const [release, evidenceSubmission, dispute, resolution, cancellation] = await Promise.all([
      state.stateLabel === "released"
        ? this.getReleaseProof(paymentId, releasedAtUnix)
        : { txHash: null, status: null, sender: null, blockNumber: null, blockTime: null },
      this.getEvidenceSubmissionProof(paymentId, deliveryAtUnix),
      state.stateLabel === "disputed"
        ? this.getDisputeProof(paymentId, deliveryAtUnix)
        : { ...emptyEventProof(), disputeReference: null },
      state.stateLabel === "resolved"
        ? this.getResolutionProof(paymentId, releasedAtUnix)
        : { ...emptyEventProof(), clientAmount: null, workerAmount: null },
      state.stateLabel === "cancelled"
        ? this.getCancellationProof(
            paymentId,
            state.createdAt ? Math.floor(new Date(state.createdAt).getTime() / 1000) : 0,
          )
        : emptyEventProof(),
    ]);

    return {
      paymentId: paymentId.toString(),
      state,
      release,
      evidenceSubmission,
      dispute,
      resolution,
      cancellation,
    };
  }

  private toIso(unixBigint: bigint): string | null {
    const n = Number(unixBigint);
    if (n <= 0) return null;
    return new Date(n * 1000).toISOString();
  }
}

/**
 * Backward-compatible Celo Sepolia reader. Existing callers intentionally
 * keep using Sepolia when no chain is specified. Preserves the exact legacy
 * default RPC when no override is given (no env lookup on this path).
 */
export class CeloSepoliaChainFinalProofReader extends CeloChainFinalProofReader {
  constructor(rpcUrl?: string, client?: ChainReadClient) {
    super({ chainId: CELO_SEPOLIA_CHAIN_ID, rpcUrl: rpcUrl ?? DEFAULT_SEPOLIA_RPC, client });
  }
}

