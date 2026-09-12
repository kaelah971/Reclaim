// ---------------------------------------------------------------------------
// I6B: Dispute resolution executor — on-chain settlement via resolveDispute
// ---------------------------------------------------------------------------

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";
import { getEscrowChain, getEscrowContractAddress } from "@/lib/contracts/config";
import { parsePaymentData } from "@/lib/contracts/types";
import { CELO_MAINNET_CHAIN_ID, CELO_SEPOLIA_CHAIN_ID } from "@/lib/web3/chains";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  getReviewerBindingMismatches,
  normalizeEscrowPaymentId,
  validateReviewerOnchainBinding,
  type ReviewerOnchainBinding,
} from "@/lib/reviewer/store";

// Sepolia V1 is retained as historical data, but it does not expose
// resolveDispute. It must never be silently rebound to the V2 address.
const HISTORICAL_SEPOLIA_ESCROW_V1 = "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79";

export type ExecutionStatus = "pending" | "submitting" | "submitted" | "confirmed" | "failed" | "cancelled";

export interface ExecutionDecision {
  id: string;
  decision: string;
  totalAmount: string;
  clientAmount: string;
  workerAmount: string;
  onchainPaymentId: string;
  chainId: number;
  contractAddress: string;
  client: string;
  worker: string;
  token: string;
}

export interface ExecutionEligibility {
  eligible: boolean;
  reason?: string;
  decision?: ExecutionDecision;
  onchainData?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  status: ExecutionStatus;
  transactionHash?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
  errorCode?: string;
  errorMessage?: string;
  dryRun: boolean;
  method: string;
  args: Record<string, string>;
}

function getRpcUrl(chainId: number): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL || "https://forno.celo.org";
  }
  if (chainId === CELO_SEPOLIA_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL ||
      process.env.NEXT_PUBLIC_CELO_RPC_URL ||
      "https://forno.celo-sepolia.celo-testnet.org";
  }
  throw new Error(`Unsupported escrow chain ${chainId}.`);
}

function getPublicClient(chainId: number) {
  return createPublicClient({
    chain: getEscrowChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
}

function isDryRun(): boolean {
  return process.env.ESCROW_EXECUTION_DRY_RUN === "true";
}

function getExecutorKey(): `0x${string}` | null {
  const key = process.env.ESCROW_EXECUTOR_PRIVATE_KEY || "";
  if (!key) return null;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized as `0x${string}` : null;
}

function mapAmounts(
  decision: string,
  total: string,
  clientAmount: string | null,
  workerAmount: string | null,
): { clientAmount: string; workerAmount: string } | null {
  const normalizedTotal = normalizeEscrowPaymentId(total);
  if (normalizedTotal === null) return null;

  switch (decision) {
    case "release_to_worker":
      return { clientAmount: "0", workerAmount: normalizedTotal };
    case "refund_to_client":
      return { clientAmount: normalizedTotal, workerAmount: "0" };
    case "partial_resolution": {
      const normalizedClient = normalizeEscrowPaymentId(clientAmount);
      const normalizedWorker = normalizeEscrowPaymentId(workerAmount);
      if (normalizedClient === null || normalizedWorker === null) return null;
      if (BigInt(normalizedClient) + BigInt(normalizedWorker) !== BigInt(normalizedTotal)) return null;
      return { clientAmount: normalizedClient, workerAmount: normalizedWorker };
    }
    default:
      return null;
  }
}

function getStoredBinding(decision: Record<string, unknown>): ReviewerOnchainBinding | null {
  const snapshot = decision.onchain_snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const storedSnapshot = snapshot as Record<string, unknown>;

  const chainId = decision.chain_id;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) return null;
  if (typeof decision.contract_address !== "string") return null;

  const binding: ReviewerOnchainBinding = {
    chainId,
    contractAddress: decision.contract_address,
    escrowPaymentId: normalizeEscrowPaymentId(decision.onchain_payment_id) ?? "",
    client: typeof storedSnapshot.client === "string" ? storedSnapshot.client : "",
    worker: typeof storedSnapshot.worker === "string" ? storedSnapshot.worker : "",
    amount: typeof storedSnapshot.amount === "string" ? storedSnapshot.amount : "",
    token: typeof storedSnapshot.token === "string" ? storedSnapshot.token : "",
    state: typeof storedSnapshot.state === "string" ? storedSnapshot.state : "",
  };

  if (validateReviewerOnchainBinding(binding).length > 0) return null;

  const storedId = normalizeEscrowPaymentId(storedSnapshot.id);
  const storedSnapshotChain = storedSnapshot.chainId;
  const storedSnapshotContract = storedSnapshot.contractAddress;
  if (
    storedId === null ||
    storedId !== binding.escrowPaymentId ||
    storedSnapshotChain !== chainId ||
    typeof storedSnapshotContract !== "string" ||
    storedSnapshotContract.toLowerCase() !== binding.contractAddress.toLowerCase()
  ) {
    return null;
  }

  return binding;
}

function executionFailure(
  errorCode: string,
  errorMessage: string,
  dryRun: boolean,
): ExecutionResult {
  return {
    success: false,
    status: "failed",
    errorCode,
    errorMessage,
    dryRun,
    method: "resolveDispute",
    args: {},
  };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23505" || Boolean(error?.message?.toLowerCase().includes("unique"));
}

export async function checkExecutionEligibility(paymentId: string, decisionId: string): Promise<ExecutionEligibility> {
  const sb = getSupabaseClient();
  const { data: decisionRow, error: decisionError } = await sb
    .from("reviewer_decisions")
    .select("*")
    .eq("id", decisionId)
    .eq("payment_identifier", paymentId)
    .maybeSingle();

  if (decisionError) return { eligible: false, reason: "Could not load the reviewer decision." };
  if (!decisionRow) return { eligible: false, reason: "Decision not found." };
  const decision = decisionRow as Record<string, unknown>;

  if (decision.decision_status !== "ready_for_execution") {
    return { eligible: false, reason: `Status is "${decision.decision_status}".` };
  }
  if (decision.decision === "needs_more_evidence") {
    return { eligible: false, reason: "needs_more_evidence is not executable." };
  }

  const { data: existing, error: existingError } = await sb
    .from("review_executions")
    .select("id,status")
    .eq("payment_identifier", paymentId)
    .in("status", ["pending", "submitting", "submitted", "confirmed"])
    .maybeSingle();
  if (existingError) return { eligible: false, reason: "Could not verify existing executions." };
  if (existing) {
    return {
      eligible: false,
      reason: `Execution already exists (${(existing as Record<string, unknown>).status}).`,
    };
  }

  const binding = getStoredBinding(decision);
  if (!binding) {
    return { eligible: false, reason: "Decision has no complete on-chain escrow binding." };
  }

  let configuredContract: string;
  try {
    // This is deliberately evaluated even for a pre-bound record. Mainnet
    // without a deployed address must fail closed, never use Sepolia config.
    configuredContract = getEscrowContractAddress(binding.chainId);
  } catch (err: unknown) {
    return {
      eligible: false,
      reason: `Escrow configuration unavailable: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  if (binding.contractAddress.toLowerCase() === HISTORICAL_SEPOLIA_ESCROW_V1.toLowerCase()) {
    return {
      eligible: false,
      reason: "resolutionUnsupportedForContractVersion — this payment is on Escrow V1 (no resolveDispute).",
    };
  }
  if (binding.contractAddress.toLowerCase() !== configuredContract.toLowerCase()) {
    return { eligible: false, reason: "Escrow contract binding does not match the configured chain deployment." };
  }

  try {
    const publicClient = getPublicClient(binding.chainId);
    const raw = await publicClient.readContract({
      address: binding.contractAddress as `0x${string}`,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [BigInt(binding.escrowPaymentId)],
    }) as unknown as Parameters<typeof parsePaymentData>[0];
    const payment = parsePaymentData(raw);

    if (payment.id.toString() !== binding.escrowPaymentId) {
      return { eligible: false, reason: "Live escrow payment ID differs from the bound payment ID." };
    }

    const liveBinding: ReviewerOnchainBinding = {
      chainId: binding.chainId,
      contractAddress: binding.contractAddress,
      escrowPaymentId: payment.id.toString(),
      client: payment.client,
      worker: payment.worker,
      amount: payment.amount.toString(),
      token: payment.token,
      state: payment.state,
    };
    const bindingMismatches = getReviewerBindingMismatches(decision, liveBinding, { requireComplete: true });
    if (bindingMismatches.length > 0) {
      return {
        eligible: false,
        reason: `Live escrow binding mismatch: ${bindingMismatches.join(", ")}.`,
      };
    }

    if (payment.state !== "Disputed") {
      return { eligible: false, reason: `On-chain state is "${payment.state}".` };
    }

    const amounts = mapAmounts(
      decision.decision as string,
      payment.amount.toString(),
      typeof decision.client_amount === "string" ? decision.client_amount : null,
      typeof decision.worker_amount === "string" ? decision.worker_amount : null,
    );
    if (!amounts) {
      return { eligible: false, reason: `Cannot compute amounts for "${decision.decision}".` };
    }

    // Validate the final allocation independently of the decision branch so
    // every executable decision sums exactly to the live escrow amount.
    if (BigInt(amounts.clientAmount) + BigInt(amounts.workerAmount) !== payment.amount) {
      return { eligible: false, reason: "Decision amounts do not sum to the live escrow amount." };
    }

    if (decision.decision !== "partial_resolution" && (decision.client_amount != null || decision.worker_amount != null)) {
      const storedClient = normalizeEscrowPaymentId(decision.client_amount);
      const storedWorker = normalizeEscrowPaymentId(decision.worker_amount);
      if (storedClient !== amounts.clientAmount || storedWorker !== amounts.workerAmount) {
        return { eligible: false, reason: "Decision allocation does not match the selected resolution." };
      }
    }

    return {
      eligible: true,
      decision: {
        id: decision.id as string,
        decision: decision.decision as string,
        totalAmount: payment.amount.toString(),
        clientAmount: amounts.clientAmount,
        workerAmount: amounts.workerAmount,
        onchainPaymentId: binding.escrowPaymentId,
        chainId: binding.chainId,
        contractAddress: binding.contractAddress,
        client: payment.client,
        worker: payment.worker,
        token: payment.token,
      },
      onchainData: {
        id: payment.id.toString(),
        chainId: binding.chainId,
        contractAddress: binding.contractAddress,
        state: payment.state,
        client: payment.client,
        worker: payment.worker,
        amount: payment.amount.toString(),
        token: payment.token,
      },
    };
  } catch (err: unknown) {
    return { eligible: false, reason: `On-chain read failed: ${err instanceof Error ? err.message : "Unknown"}` };
  }
}

export async function executeDisputeResolution(paymentId: string, decisionId: string): Promise<ExecutionResult> {
  const dryRun = isDryRun();
  const eligibility = await checkExecutionEligibility(paymentId, decisionId);
  if (!eligibility.eligible || !eligibility.decision) {
    return executionFailure("NOT_ELIGIBLE", eligibility.reason ?? "Unknown", dryRun);
  }

  const privateKey = getExecutorKey();
  if (!privateKey) {
    return executionFailure("MISSING_KEY", "ESCROW_EXECUTOR_PRIVATE_KEY not set.", false);
  }

  const decision = eligibility.decision;
  // These values came from the persisted, validated binding. There is no
  // fallback to paymentId, which is an x402 UUID for this endpoint.
  const escrowPaymentId = decision.onchainPaymentId;
  const escrowAddress = decision.contractAddress as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const sb = getSupabaseClient();

  const { data: executionRow, error: insertError } = await sb
    .from("review_executions")
    .insert({
      reviewer_decision_id: decisionId,
      payment_identifier: paymentId,
      onchain_payment_id: escrowPaymentId,
      decision: decision.decision,
      status: "pending",
      expected_amount: decision.totalAmount,
      client_amount: decision.clientAmount,
      worker_amount: decision.workerAmount,
      executor_address: account.address,
      chain_id: decision.chainId,
      contract_address: escrowAddress,
      source_onchain_snapshot: eligibility.onchainData ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      return executionFailure(
        "ALREADY_EXECUTING",
        "An active execution already exists for this payment or decision.",
        dryRun,
      );
    }
    console.error("[reviewer/executor] execution insert failed:", insertError.message);
    return executionFailure("DB_FAILED", "Failed to create execution.", dryRun);
  }
  if (!executionRow) {
    return executionFailure("DB_FAILED", "Failed to create execution.", dryRun);
  }

  const executionId = (executionRow as Record<string, unknown>).id as string;
  const args = { paymentId: escrowPaymentId, clientAmount: decision.clientAmount };

  if (dryRun) {
    await sb.from("review_executions").update({
      status: "cancelled",
      execution_error_code: "DRY_RUN",
      failed_at: new Date().toISOString(),
    }).eq("id", executionId);
    return {
      success: false,
      status: "cancelled",
      errorCode: "DRY_RUN",
      errorMessage: `Would call resolveDispute(${escrowPaymentId}, ${decision.clientAmount})`,
      dryRun: true,
      method: "resolveDispute",
      args,
    };
  }

  await sb.from("review_executions").update({ status: "submitting" }).eq("id", executionId);

  try {
    const publicClient = getPublicClient(decision.chainId);
    const dataSuffix = getAttributionDataSuffix();
    const { request } = await publicClient.simulateContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "resolveDispute",
      args: [BigInt(escrowPaymentId), BigInt(decision.clientAmount)],
      account,
      dataSuffix,
    });

    const walletClient = createWalletClient({
      chain: getEscrowChain(decision.chainId),
      transport: http(getRpcUrl(decision.chainId)),
      account,
    });
    const transactionHash = await walletClient.writeContract({ ...request, dataSuffix });

    await sb.from("review_executions").update({
      status: "submitted",
      transaction_hash: transactionHash,
      submitted_at: new Date().toISOString(),
    }).eq("id", executionId);

    // Do not mark execution complete until the transaction is mined
    // successfully and the contract confirms the terminal Resolved state.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") {
      await sb.from("review_executions").update({
        status: "failed",
        execution_error_code: "TX_REVERTED",
        failed_at: new Date().toISOString(),
        gas_used: receipt.gasUsed,
        block_number: receipt.blockNumber,
      }).eq("id", executionId);
      return {
        success: false,
        status: "failed",
        transactionHash,
        errorCode: "TX_REVERTED",
        errorMessage: "Transaction reverted.",
        dryRun: false,
        method: "resolveDispute",
        args,
      };
    }

    const raw = await publicClient.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [BigInt(escrowPaymentId)],
    }) as unknown as Parameters<typeof parsePaymentData>[0];
    const resolvedPayment = parsePaymentData(raw);
    if (resolvedPayment.id.toString() !== escrowPaymentId || resolvedPayment.state !== "Resolved") {
      await sb.from("review_executions").update({
        status: "failed",
        execution_error_code: "STATE_MISMATCH",
        failed_at: new Date().toISOString(),
      }).eq("id", executionId);
      return {
        success: false,
        status: "failed",
        transactionHash,
        errorCode: "STATE_MISMATCH",
        errorMessage: `State is "${resolvedPayment.state}", expected Resolved for payment ${escrowPaymentId}.`,
        dryRun: false,
        method: "resolveDispute",
        args,
      };
    }

    await sb.from("review_executions").update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      block_number: receipt.blockNumber,
      gas_used: receipt.gasUsed,
    }).eq("id", executionId);

    return {
      success: true,
      status: "confirmed",
      transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      dryRun: false,
      method: "resolveDispute",
      args,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown";
    await sb.from("review_executions").update({
      status: "failed",
      execution_error_code: "TX_FAILED",
      execution_error_message: message.slice(0, 500),
      failed_at: new Date().toISOString(),
    }).eq("id", executionId);
    return {
      success: false,
      status: "failed",
      errorCode: "TX_FAILED",
      errorMessage: message,
      dryRun: false,
      method: "resolveDispute",
      args,
    };
  }
}
