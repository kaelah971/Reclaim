// ---------------------------------------------------------------------------
// I5: AI case context builder — derives verified context from on-chain data
//
// NEVER trusts client-submitted on-chain fields. Reads real data from
// ProtectedPaymentEscrow for every paid dispute brief.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { getEscrowAddress as getEscrowContractAddress } from "@/lib/contracts/addresses";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { parsePaymentData } from "@/lib/contracts/types";
import { formatUSDC } from "@/lib/contracts/types";
import {
  X402_NETWORK,
  X402_USDC_ADDRESS,
} from "@/lib/x402/config";
import type { AICaseContext } from "./types";

// ---------------------------------------------------------------------------
// Build verified AI case context from on-chain payment data + dispute request
// ---------------------------------------------------------------------------

export interface BuildContextInput {
  paymentId: string;
  disputeReason: string;
  requestedOutcome: string;
  evidenceReferences?: string[];
  timelineEntries?: { date: string; description: string }[];
  additionalContext?: string;
}

export async function buildAICaseContext(input: BuildContextInput): Promise<AICaseContext | null> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org";

  const client = createPublicClient({
    chain: celoSepolia,
    transport: http(rpcUrl),
  });

  const escrowAddress = getEscrowContractAddress(11142220);
  if (!escrowAddress) {
    console.error("[ai/context] Escrow contract address not configured");
    return null;
  }

  let escrowPaymentId: bigint;
  try {
    escrowPaymentId = BigInt(input.paymentId);
  } catch {
    console.error(`[ai/context] Invalid payment ID: ${input.paymentId}`);
    return null;
  }

  // Read verified on-chain payment data
  let raw;
  try {
    raw = await client.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [escrowPaymentId],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ai/context] Failed to read payment ${input.paymentId}: ${message}`);
    return null;
  }

  const paymentData = parsePaymentData(raw as Parameters<typeof parsePaymentData>[0]);

  return {
    paymentId: input.paymentId,
    disputeReason: input.disputeReason,
    requestedOutcome: input.requestedOutcome,
    clientAddress: paymentData.client,
    workerAddress: paymentData.worker,
    protectedAmount: formatUSDC(paymentData.amount),
    token: paymentData.token,
    network: X402_NETWORK,
    currentOnChainState: paymentData.state,
    agreementLabel: paymentData.agreementLabel,
    deliverableSummary: paymentData.deliverableSummary,
    releaseRule: paymentData.releaseRule,
    deliveryDeadline: paymentData.deliveryDeadline > BigInt(0)
      ? paymentData.deliveryDeadline.toString()
      : "",
    evidenceReferences: input.evidenceReferences ?? [],
    timelineEntries: input.timelineEntries ?? [],
    additionalContext: input.additionalContext,
  };
}
