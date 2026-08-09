// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/receipt
//
// Public-safe, READ-ONLY: returns the canonical final receipt for a payment.
// The receipt is composed from DURABLE, VERIFIED sources only:
//   - live on-chain escrow state + release/evidence tx proofs (read-only)
//   - verified evidence metadata (evidence_metadata table)
//   - the resolution agent's durable review packet (QC provenance incl.
//     recorded QC-vs-verified-evidence inconsistencies)
//
// No signing, no mutation, no re-execution, no x402 calls.
// Missing sources produce null fields — nothing is fabricated.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";
import { getSupabaseClient } from "@/lib/supabase/client";
import { CeloSepoliaEscrowCaseReader } from "@/lib/resolution-agent/api/escrow-reader";
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import { CeloSepoliaChainFinalProofReader } from "@/lib/evidence/chainProvenance";
import {
  buildFinalReceipt,
  AGENT_STATEMENT,
  type ReceiptAgreement,
  type ReceiptAudit,
  type ReceiptEvidence,
  type ReceiptHumanDecision,
  type ReceiptProtectedPayment,
  type ReceiptQualityCheck,
  type ReceiptResolutionAgent,
} from "@/lib/evidence/finalReceipt";
import { fromAtomicUnits, facilitatorClient } from "@/lib/x402/config";
import {
  getCeloExplorerTxUrl,
  getCeloExplorerAddressUrl,
  getCeloMainnetExplorerTxUrl,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import { fromBytes32Label } from "@/lib/contracts/types";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const PACKET_EVENT_TYPE = "review_packet_prepared";
const TOOL_ID = "evidence-quality-check";
const MAINNET_RPC = "https://forno.celo.org";

/** Load the latest durable review packet event for an agent (read-only). */
async function loadLatestReviewPacket(agentId: string) {
  const supabase = getSupabaseClient();
  const { data: events } = await supabase
    .from("resolution_agent_events")
    .select("id, created_at, metadata, reason")
    .eq("agent_id", agentId)
    .eq("event_type", PACKET_EVENT_TYPE)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = Array.isArray(events) && events.length > 0 ? events[0] : null;
  if (!latest) return null;
  return {
    id: (latest as Record<string, unknown>).id as string,
    createdAt: (latest as Record<string, unknown>).created_at as string,
    metadata: (latest as Record<string, unknown>).metadata as Record<string, unknown> | null,
  };
}

/** Best-effort block time of a Celo Mainnet tx (real audit data). */
async function readMainnetBlockTime(txHash: string | null): Promise<string | null> {
  if (!txHash) return null;
  try {
    const client = createPublicClient({
      chain: celo,
      transport: http(MAINNET_RPC, { timeout: 10000 }),
    });
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
    if (!paymentId || !/^\d+$/.test(paymentId)) {
      return NextResponse.json(
        { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    // ---- 1. On-chain final state + release/evidence proofs (read-only) ----
    const proofReader = new CeloSepoliaChainFinalProofReader();
    const proof = await proofReader.readFinalProof(BigInt(paymentId));
    if (!proof) {
      return NextResponse.json({ found: false, paymentId }, { status: 200 });
    }

    const escrowReader = new CeloSepoliaEscrowCaseReader(
      process.env.CELO_SEPOLIA_RPC_URL,
    );

    // ---- 2. Verified evidence metadata -------------------------------------
    const evidenceReader = new SupabaseEvidenceReader();
    const facts = await evidenceReader.getEvidenceMetadata(paymentId);

    // ---- 3. Resolution agent + durable review packet -----------------------
    const store = new SupabaseResolutionAgentStore();
    const agent = await store.getAgentByCaseIdentity(
      String(escrowReader.chainId),
      escrowReader.contractAddress,
      paymentId,
    );
    const packetEvent = agent ? await loadLatestReviewPacket(agent.id) : null;
    const packet = packetEvent?.metadata ?? null;
    const packetEvidence = (packet?.evidence ?? {}) as Record<string, unknown>;
    const packetQc = (packet?.qualityCheck ?? {}) as Record<string, unknown>;
    const qcInconsistency = Array.isArray(packet?.qcInconsistency)
      ? (packet.qcInconsistency as string[])
      : [];

    // ---- 4. QC execution (exactly one paid) — real price/provenance --------
    let qcPriceAtomic: bigint | null = null;
    let qcCaseVersionHash: string | null = null;
    let qcEvidenceVersionHash: string | null = null;
    if (agent) {
      const executions = await store.listToolExecutions(agent.id);
      const settledQc = executions.find(
        (e) => e.tool_identifier === TOOL_ID && e.state === "settled",
      );
      qcPriceAtomic =
        settledQc && typeof settledQc.price_atomic === "number"
          ? BigInt(settledQc.price_atomic)
          : null;
      qcCaseVersionHash = settledQc?.case_version_hash ?? null;
      qcEvidenceVersionHash = settledQc?.evidence_version_hash ?? null;
    }

    // ---- 5. Human decision attribution -------------------------------------
    const token = getPaymentTokenConfig();
    const amountHuman = fromAtomicUnits(
      BigInt(proof.state.amount),
      token.decimals,
    );
    const sender = proof.release.sender ?? null;
    const authority =
      sender && sender.toLowerCase() === proof.state.client.toLowerCase()
        ? "client"
        : sender
          ? "wallet"
          : "unknown";

    // ---- 6. x402 QC settlement block time (real, best-effort) --------------
    const qcSettlementAt = await readMainnetBlockTime(
      (packetQc.settlementTxHash as string | null) ?? null,
    );

    // ---- 7. Compose the receipt --------------------------------------------
    const protectedPayment: ReceiptProtectedPayment = {
      paymentId: proof.paymentId,
      amountAtomic: proof.state.amount,
      amountHuman: `${amountHuman} ${token.symbol}`,
      asset: token.symbol,
      client: proof.state.client,
      worker: proof.state.worker,
      escrowContractAddress: escrowReader.contractAddress,
      chainId: `eip155:${escrowReader.chainId}`,
      network: proofReader.network,
      finalState: proof.state.stateLabel === "released" ? "Released" : (proof.state.stateLabel ?? proof.state.state),
      releasedAt: proof.state.releasedAt,
    };

    const agreement: ReceiptAgreement = {
      deliverable: proof.state.deliverableSummary
        ? fromBytes32Label(proof.state.deliverableSummary as `0x${string}`)
        : null,
      deliveryFormat: proof.state.deliveryFormat
        ? fromBytes32Label(proof.state.deliveryFormat as `0x${string}`)
        : null,
      releaseRule: proof.state.releaseRule
        ? fromBytes32Label(proof.state.releaseRule as `0x${string}`)
        : null,
      evidenceExpectation: proof.state.evidenceExpectation
        ? fromBytes32Label(proof.state.evidenceExpectation as `0x${string}`)
        : null,
      deadline: proof.state.deliveryDeadline ?? null,
      autoReleaseSeconds: proof.state.autoReleaseSeconds,
      disputeWindowSeconds: proof.state.disputeWindowSeconds,
    };

    const evidence: ReceiptEvidence = {
      title: (facts.title as string | null) ?? null,
      claim: (facts.relatedClaim as string | null) ?? null,
      date: (facts.evidenceDate as string | null) ?? null,
      pastedText: (facts.pastedText as string | null) ?? null,
      evidenceReference: proof.state.evidenceReference || null,
      availability: facts.substantiveEvidence ? "package_available" : null,
      evidenceType: (facts.evidenceType as string | null) ?? null,
      submittedAt: facts.latestUpdateTimestamp
        ? new Date(facts.latestUpdateTimestamp).toISOString()
        : null,
      submitter: (facts.submitterAddress as string | null) ?? null,
      submissionTxHash: proof.evidenceSubmission.txHash,
    };

    const resolutionAgent: ReceiptResolutionAgent = {
      agentId: agent?.id ?? null,
      objective: agent?.goal ?? null,
      statement: AGENT_STATEMENT,
      caseVersionHash:
        (packetEvidence.caseVersionHash as string | null) ?? qcCaseVersionHash,
      evidenceVersionHash:
        (packetEvidence.evidenceVersionHash as string | null) ??
        qcEvidenceVersionHash,
    };

    const qualityCheck: ReceiptQualityCheck = {
      toolId: (packetQc.toolId as string | null) ?? TOOL_ID,
      priceHuman: qcPriceAtomic !== null ? `$${fromAtomicUnits(qcPriceAtomic)} USDC` : null,
      network: "Celo Mainnet",
      facilitatorUrl: facilitatorClient.url,
      executionRequestHash: (packetQc.executionRequestHash as string | null) ?? null,
      readiness: (packetQc.readiness as string | null) ?? null,
      reviewerQuestions: Array.isArray(packetQc.reviewerQuestions)
        ? (packetQc.reviewerQuestions as string[])
        : [],
      ambiguities: Array.isArray(packetQc.ambiguities)
        ? (packetQc.ambiguities as string[])
        : [],
      recommendedImprovements: Array.isArray(packetQc.recommendedImprovements)
        ? (packetQc.recommendedImprovements as string[])
        : [],
      settlementTxHash: (packetQc.settlementTxHash as string | null) ?? null,
      paymentReference: (packetQc.paymentReference as string | null) ?? null,
      resultReference: (packetQc.resultReference as string | null) ?? null,
      // Recorded contradictions with verified evidence — never hidden.
      inconsistencies: qcInconsistency,
    };

    const humanDecision: ReceiptHumanDecision = {
      decision: "Approve release",
      authority,
      txHash: proof.release.txHash,
      sender,
      blockNumber: proof.release.blockNumber,
      blockTime: proof.release.blockTime,
      status: proof.release.status,
      finalRecipient: proof.state.worker,
      outcome: "Released",
    };

    const audit: ReceiptAudit = {
      explorerLinks: {
        escrowContract: getCeloExplorerAddressUrl(escrowReader.contractAddress),
        client: getCeloExplorerAddressUrl(proof.state.client),
        worker: getCeloExplorerAddressUrl(proof.state.worker),
        releaseTransaction: proof.release.txHash
          ? getCeloExplorerTxUrl(proof.release.txHash)
          : null,
        evidenceSubmissionTransaction: proof.evidenceSubmission.txHash
          ? getCeloExplorerTxUrl(proof.evidenceSubmission.txHash)
          : null,
        x402SettlementTransaction: qualityCheck.settlementTxHash
          ? getCeloMainnetExplorerTxUrl(qualityCheck.settlementTxHash)
          : null,
      },
      timestamps: {
        evidenceSubmittedAt: evidence.submittedAt,
        releaseAt: proof.state.releasedAt,
        qcSettlementAt,
      },
    };

    const receipt = buildFinalReceipt({
      protectedPayment,
      agreement,
      evidence,
      resolutionAgent,
      qualityCheck,
      humanDecision,
      audit,
    });

    return NextResponse.json(
      {
        found: true,
        paymentId,
        agentId: agent?.id ?? null,
        packetEventId: packetEvent?.id ?? null,
        receiptCreatedAt: packetEvent?.createdAt ?? null,
        receipt,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[receipt]", err);
    return NextResponse.json(
      { error: "Failed to load the receipt.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
