// ---------------------------------------------------------------------------
// I6B: Dispute resolution executor — on-chain settlement via resolveDispute
// ---------------------------------------------------------------------------

import { createPublicClient, createWalletClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { privateKeyToAccount } from "viem/accounts";

const ESCROW_V2_ADDRESS = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F" as `0x${string}`;
const ESCROW_V1_ADDRESS = "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79" as `0x${string}`;
// V2: current canonical escrow with resolveDispute support.
// V1: historical — no resolveDispute. Payments on V1 report resolutionUnsupportedForContractVersion.
const CHAIN_ID = 11142220;

function getContractAddress(): `0x${string}` {
  return ESCROW_V2_ADDRESS;
}

function isContractResolutionSupported(address: string): boolean {
  return address.toLowerCase() === ESCROW_V2_ADDRESS.toLowerCase();
}

export type ExecutionStatus = "pending" | "submitting" | "submitted" | "confirmed" | "failed" | "cancelled";

export interface ExecutionEligibility {
  eligible: boolean;
  reason?: string;
  decision?: Record<string, unknown>;
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

function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";
}

function getPublicClient() {
  return createPublicClient({ chain: celoSepolia, transport: http(getRpcUrl()) });
}

function isDryRun(): boolean {
  return process.env.ESCROW_EXECUTION_DRY_RUN === "true";
}

function getExecutorKey(): `0x${string}` | null {
  const key = process.env.ESCROW_EXECUTOR_PRIVATE_KEY || "";
  if (!key) return null;
  const n = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(n) ? (n as `0x${string}`) : null;
}

function mapAmounts(decision: string, total: string, ca: string | null, wa: string | null): { clientAmount: string; workerAmount: string } | null {
  const t = BigInt(total);
  switch (decision) {
    case "release_to_worker": return { clientAmount: "0", workerAmount: total };
    case "refund_to_client": return { clientAmount: total, workerAmount: "0" };
    case "partial_resolution": {
      if (!ca || !wa) return null;
      const c = BigInt(ca), w = BigInt(wa);
      if (c + w !== t) return null;
      return { clientAmount: ca, workerAmount: wa };
    }
    default: return null;
  }
}

export async function checkExecutionEligibility(paymentId: string, decisionId: string): Promise<ExecutionEligibility> {
  const sb = getSupabaseClient();
  const { data: d } = await sb.from("reviewer_decisions").select("*").eq("id", decisionId).eq("payment_identifier", paymentId).maybeSingle();
  if (!d) return { eligible: false, reason: "Decision not found." };
  const dec = d as Record<string, unknown>;

  if (dec.decision_status !== "ready_for_execution") return { eligible: false, reason: `Status is "${dec.decision_status}".` };
  if (dec.decision === "needs_more_evidence") return { eligible: false, reason: "needs_more_evidence is not executable." };

    const { data: existing } = await sb.from("review_executions").select("id,status").eq("payment_identifier", paymentId).in("status", ["pending", "submitting", "submitted", "confirmed"]).maybeSingle();
    if (existing) return { eligible: false, reason: `Execution already exists (${(existing as Record<string, unknown>).status}).` };

    // Check contract version: only V2 supports resolveDispute
    const contractAddr = (dec.contract_address as string) || getContractAddress();
    if (!isContractResolutionSupported(contractAddr)) {
      return { eligible: false, reason: "resolutionUnsupportedForContractVersion — this payment is on Escrow V1 (no resolveDispute)." };
    }

  try {
    const escrowId = (dec.onchain_payment_id || dec.escrow_payment_id || paymentId) as string;
    const pc = getPublicClient();
    const raw = await pc.readContract({ address: getContractAddress(), abi: protectedPaymentEscrowABI, functionName: "getPayment", args: [BigInt(escrowId)] }) as unknown as Parameters<typeof parsePaymentData>[0];
    const pd = parsePaymentData(raw);

    if (pd.state !== "Disputed") return { eligible: false, reason: `On-chain state is "${pd.state}".` };

    const amts = mapAmounts(dec.decision as string, pd.amount.toString(), (dec.client_amount as string) ?? null, (dec.worker_amount as string) ?? null);
    if (!amts) return { eligible: false, reason: `Cannot compute amounts for "${dec.decision}".` };

    return {
      eligible: true,
      decision: { id: dec.id, decision: dec.decision, totalAmount: pd.amount.toString(), clientAmount: amts.clientAmount, workerAmount: amts.workerAmount },
      onchainData: { state: pd.state, client: pd.client, worker: pd.worker, amount: pd.amount.toString(), token: pd.token },
    };
  } catch (err: unknown) {
    return { eligible: false, reason: `On-chain read failed: ${err instanceof Error ? err.message : "Unknown"}` };
  }
}

export async function executeDisputeResolution(paymentId: string, decisionId: string): Promise<ExecutionResult> {
  const dryRun = isDryRun();
  const pk = getExecutorKey();
  if (!pk) return { success: false, status: "failed", errorCode: "MISSING_KEY", errorMessage: "ESCROW_EXECUTOR_PRIVATE_KEY not set.", dryRun: false, method: "resolveDispute", args: {} };

  const eligibility = await checkExecutionEligibility(paymentId, decisionId);
  if (!eligibility.eligible) return { success: false, status: "failed", errorCode: "NOT_ELIGIBLE", errorMessage: eligibility.reason ?? "Unknown", dryRun, method: "resolveDispute", args: {} };

  const dec = eligibility.decision!;
  const clientAmt = dec.clientAmount as string;
  const escrowId = (dec as Record<string, unknown>).onchainPaymentId as string || paymentId;

  const sb = getSupabaseClient();
  const account = privateKeyToAccount(pk);

    const { data: execRow } = await sb.from("review_executions").insert({
      reviewer_decision_id: decisionId, payment_identifier: paymentId, onchain_payment_id: escrowId,
      decision: dec.decision, status: "pending", expected_amount: dec.totalAmount,
      client_amount: clientAmt, worker_amount: dec.workerAmount,
      executor_address: account.address, chain_id: CHAIN_ID, contract_address: getContractAddress(),
      started_at: new Date().toISOString(),
    }).select("id").maybeSingle();

  if (!execRow) return { success: false, status: "failed", errorCode: "DB_FAILED", errorMessage: "Failed to create execution.", dryRun, method: "resolveDispute", args: {} };

  const execId = (execRow as Record<string, unknown>).id as string;

  if (dryRun) {
    return { success: false, status: "cancelled", errorCode: "DRY_RUN", errorMessage: `Would call resolveDispute(${escrowId}, ${clientAmt})`, dryRun: true, method: "resolveDispute", args: { paymentId: escrowId, clientAmount: clientAmt } };
  }

  await sb.from("review_executions").update({ status: "submitting" }).eq("id", execId);

  try {
    const pc = getPublicClient();
    const escrowAddr = getContractAddress();

    const { request } = await pc.simulateContract({
      address: escrowAddr, abi: protectedPaymentEscrowABI, functionName: "resolveDispute",
      args: [BigInt(escrowId), BigInt(clientAmt)], account,
    });

    const wc = createWalletClient({ chain: celoSepolia, transport: http(getRpcUrl()), account });
    const txHash = await wc.writeContract(request);

    await sb.from("review_executions").update({ status: "submitted", transaction_hash: txHash, submitted_at: new Date().toISOString() }).eq("id", execId);

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      await sb.from("review_executions").update({ status: "failed", execution_error_code: "TX_REVERTED", failed_at: new Date().toISOString(), gas_used: receipt.gasUsed, block_number: receipt.blockNumber }).eq("id", execId);
      return { success: false, status: "failed", transactionHash: txHash, errorCode: "TX_REVERTED", errorMessage: "Transaction reverted.", dryRun: false, method: "resolveDispute", args: { paymentId: escrowId, clientAmount: clientAmt } };
    }

    const raw = await pc.readContract({ address: escrowAddr, abi: protectedPaymentEscrowABI, functionName: "getPayment", args: [BigInt(escrowId)] }) as unknown as Parameters<typeof parsePaymentData>[0];
    const pd = parsePaymentData(raw);
    if (pd.state !== "Resolved") {
      await sb.from("review_executions").update({ status: "failed", execution_error_code: "STATE_MISMATCH", failed_at: new Date().toISOString() }).eq("id", execId);
      return { success: false, status: "failed", transactionHash: txHash, errorCode: "STATE_MISMATCH", errorMessage: `State is "${pd.state}", expected Resolved.`, dryRun: false, method: "resolveDispute", args: { paymentId: escrowId, clientAmount: clientAmt } };
    }

    await sb.from("review_executions").update({ status: "confirmed", confirmed_at: new Date().toISOString(), block_number: receipt.blockNumber, gas_used: receipt.gasUsed }).eq("id", execId);

    return { success: true, status: "confirmed", transactionHash: txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, dryRun: false, method: "resolveDispute", args: { paymentId: escrowId, clientAmount: clientAmt } };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown";
    await sb.from("review_executions").update({ status: "failed", execution_error_code: "TX_FAILED", execution_error_message: msg.slice(0, 500), failed_at: new Date().toISOString() }).eq("id", execId);
    return { success: false, status: "failed", errorCode: "TX_FAILED", errorMessage: msg, dryRun: false, method: "resolveDispute", args: { paymentId: escrowId, clientAmount: clientAmt } };
  }
}
