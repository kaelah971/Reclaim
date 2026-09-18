// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/receipt
//
// Public-safe, READ-ONLY: returns the canonical final receipt for a payment.
// The receipt is composed from DURABLE, VERIFIED sources only:
//   - live on-chain escrow state + release/evidence tx proofs (read-only)
//   - verified evidence metadata (evidence_metadata table) — HASH-ONLY (P4.3D)
//   - the resolution agent's durable review packet (QC provenance hash-only;
//     QC free text redacted — P4.3D)
//
// Plaintext delivery evidence is NEVER returned here; parties use the
// wallet-challenge .../evidence/plaintext endpoint.
//
// No signing, no mutation, no re-execution, no x402 calls.
// Missing sources produce null fields — nothing is fabricated.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  CeloEscrowCaseReader,
  CeloSepoliaEscrowCaseReader,
} from "@/lib/resolution-agent/api/escrow-reader";
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import {
  CeloChainFinalProofReader,
  CeloSepoliaChainFinalProofReader,
} from "@/lib/evidence/chainProvenance";
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
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  getCeloExplorerTxUrl,
  getCeloExplorerAddressUrl,
  getCeloMainnetExplorerAddressUrl,
  getCeloMainnetExplorerTxUrl,
  isSupportedChain,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";
import { fromBytes32Label } from "@/lib/contracts/types";
import {
  sanitizeReceiptEvidenceForPublic,
  sanitizeReceiptQualityCheckForPublic,
} from "@/lib/evidence/publicSanitize";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

/**
 * Resolve an explicit chainId (?chainId=). Defaults to Celo Sepolia to
 * preserve behavior. Validated against the canonical supported-chain mapping;
 * unsupported values are rejected (never trust the URL chain alone).
 */
function resolveReceiptChainId(request: NextRequest): number | null {
  let raw: string | null = null;
  try {
    const url = new URL(request.url);
    raw =
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId");
  } catch {
    raw = null;
  }
  if (raw === null || raw.trim() === "") return CELO_CHAIN_ID;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (!isSupportedChain(parsed)) return null;
  return parsed;
}

const PACKET_EVENT_TYPE = "review_packet_prepared";
const TOOL_ID = "evidence-quality-check";
const MAINNET_RPC = "https://forno.celo.org";

const EMPTY_EVENT_PROOF = {
  txHash: null,
  status: null,
  sender: null,
  blockNumber: null,
  blockTime: null,
} as const;

function displayEscrowState(stateLabel: string | null, state: string): string {
  const labels: Record<string, string> = {
    created: "Created",
    funded: "Funded",
    accepted: "Accepted",
    delivered: "Delivery submitted",
    release_requested: "Release requested",
    released: "Released",
    disputed: "Disputed",
    cancelled: "Cancelled",
    resolved: "Resolved",
  };
  return labels[stateLabel ?? ""] ?? stateLabel ?? state;
}

function financialOutcome(
  stateLabel: string | null,
  resolution: { clientAmount?: string | null; workerAmount?: string | null },
): string {
  if (stateLabel === "released") return "Released to worker";
  if (stateLabel === "cancelled") return "Cancelled";
  if (stateLabel === "disputed") return "Disputed — funds remain locked";
  if (stateLabel === "resolved") {
    const clientAmount = resolution.clientAmount ?? null;
    const workerAmount = resolution.workerAmount ?? null;
    if (clientAmount === null || workerAmount === null) return "Resolved";
    if (clientAmount === "0") return "Released to worker";
    if (workerAmount === "0") return "Refunded to client";
    return "Partially resolved";
  }
  return "Pending";
}

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

    // ---- 0. Chain scope (explicit ?chainId=, Sepolia default) -------------
    const chainId = resolveReceiptChainId(request);
    if (chainId === null) {
      return NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      );
    }
    const isMainnet = chainId === CELO_MAINNET_CHAIN_ID;

    // ---- 1. On-chain final state + release/evidence proofs (read-only) ----
    // Sepolia default path is preserved exactly; Mainnet verifies against the
    // canonical Mainnet escrow via the chain-aware reader.
    const proofReader = isMainnet
      ? new CeloChainFinalProofReader(chainId)
      : new CeloSepoliaChainFinalProofReader();
    const proof = await proofReader.readFinalProof(BigInt(paymentId));
    if (!proof) {
      return NextResponse.json({ found: false, paymentId }, { status: 200 });
    }

    const escrowReader = isMainnet
      ? new CeloEscrowCaseReader(
          chainId,
          process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL,
        )
      : new CeloSepoliaEscrowCaseReader(
          process.env.CELO_SEPOLIA_RPC_URL,
        );

    // ---- 2. Verified evidence metadata -------------------------------------
    const evidenceReader = new SupabaseEvidenceReader();
    const facts = await evidenceReader.getEvidenceMetadata(
      paymentId,
      String(chainId),
    );

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
    // P4.3D: qcInconsistency free text may quote worker content, so it is
    // redacted from the public receipt (see sanitizeReceiptQualityCheckForPublic).
    // The durable packet itself is unchanged.

    // Older callers/tests may provide a release-only proof bundle. Treat
    // omitted non-release proofs as absent rather than inferring an outcome.
    const resolutionProof = proof.resolution ?? {
      ...EMPTY_EVENT_PROOF,
      clientAmount: null,
      workerAmount: null,
    };
    const disputeProof = proof.dispute ?? {
      ...EMPTY_EVENT_PROOF,
      disputeReference: null,
    };
    const cancellationProof = proof.cancellation ?? EMPTY_EVENT_PROOF;
    const escrowStateLabel = proof.state.stateLabel;
    const finalState = displayEscrowState(escrowStateLabel, proof.state.state);
    const outcome = financialOutcome(escrowStateLabel, resolutionProof);

    // ---- 4. QC execution (exactly one paid) — real price/provenance --------
    let qcPriceAtomic: bigint | null = null;
    let qcCaseVersionHash: string | null = null;
    let qcEvidenceVersionHash: string | null = null;
    let qcSettlementTxHash: string | null = null;
    let qcPaymentReference: string | null = null;
    let qcResultReference: string | null = null;
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
      // Settlement provenance comes from the durable execution row, not from
      // mutable/generated packet metadata. The adapter only reaches `settled`
      // after validating the facilitator receipt and tx hash.
      qcSettlementTxHash = settledQc?.settlement_tx_hash ?? null;
      qcPaymentReference = settledQc?.payment_reference ?? null;
      qcResultReference = settledQc?.result_reference ?? null;
    }

    // ---- 5. Human decision attribution -------------------------------------
    const token = getPaymentTokenConfig(chainId);
    const amountHuman = fromAtomicUnits(
      BigInt(proof.state.amount),
      token.decimals,
    );
    // ---- 6. x402 QC settlement block time (real, best-effort) --------------
    const qcSettlementAt = await readMainnetBlockTime(
      qcSettlementTxHash,
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
      finalState,
      releasedAt: escrowStateLabel === "released" ? proof.state.releasedAt : null,
      escrowState: proof.state.state,
      financialOutcome: outcome,
      resolvedAt: escrowStateLabel === "resolved" ? proof.state.releasedAt : null,
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

    // P4.3D: public receipt is hash-only. Plaintext delivery evidence
    // (title/claim/date/pasted text) and QC free text that may quote worker
    // content are redacted here. Party plaintext reads use the wallet-challenge
    // .../evidence/plaintext endpoint. Safe fields (hash, availability,
    // counts, provenance, readiness enum) are preserved.
    const evidence: ReceiptEvidence = sanitizeReceiptEvidenceForPublic({
      evidenceReference: proof.state.evidenceReference || null,
      availability: facts.substantiveEvidence ? "package_available" : null,
      evidenceType: (facts.evidenceType as string | null) ?? null,
      submittedAt: facts.latestUpdateTimestamp
        ? new Date(facts.latestUpdateTimestamp).toISOString()
        : null,
      submitter: (facts.submitterAddress as string | null) ?? null,
      submissionTxHash: proof.evidenceSubmission.txHash,
    });

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

    const qualityCheck: ReceiptQualityCheck = sanitizeReceiptQualityCheckForPublic({
      toolId: (packetQc.toolId as string | null) ?? TOOL_ID,
      priceHuman: qcPriceAtomic !== null ? `$${fromAtomicUnits(qcPriceAtomic)} USDC` : null,
      network: "Celo Mainnet",
      facilitatorUrl: facilitatorClient.url,
      executionRequestHash: (packetQc.executionRequestHash as string | null) ?? null,
      readiness: (packetQc.readiness as string | null) ?? null,
      settlementTxHash: qcSettlementTxHash,
      paymentReference: qcPaymentReference,
      resultReference: qcResultReference,
    });

    const actionProof =
      escrowStateLabel === "released"
        ? proof.release
        : escrowStateLabel === "resolved"
          ? resolutionProof
          : escrowStateLabel === "cancelled"
            ? cancellationProof
            : null;
    const actionSender = actionProof?.sender ?? null;
    const actionAuthority =
      escrowStateLabel === "released"
        ? actionSender
          ? actionSender.toLowerCase() === proof.state.client.toLowerCase()
            ? "client"
            : "wallet"
          : "unknown"
        : escrowStateLabel === "resolved"
          ? actionSender
            ? "escrow_owner"
            : "unknown"
          : escrowStateLabel === "cancelled"
            ? actionSender
              ? actionSender.toLowerCase() === proof.state.client.toLowerCase()
                ? "client"
                : "wallet"
              : "unknown"
            : null;
    const humanDecision: ReceiptHumanDecision = {
      decision:
        escrowStateLabel === "released"
          ? "Approve release"
          : escrowStateLabel === "resolved"
            ? resolutionProof.txHash
              ? "Resolve dispute"
              : null
            : escrowStateLabel === "cancelled"
              ? cancellationProof.txHash
                ? "Cancel unfunded payment"
                : null
              : null,
      authority: actionAuthority,
      txHash: actionProof?.txHash ?? null,
      sender: actionSender,
      blockNumber: actionProof?.blockNumber ?? null,
      blockTime: actionProof?.blockTime ?? null,
      status: actionProof?.status ?? null,
      finalRecipient: escrowStateLabel === "released" ? proof.state.worker : null,
      outcome: finalState,
      clientAmount: resolutionProof.clientAmount ?? null,
      workerAmount: resolutionProof.workerAmount ?? null,
      clientAmountHuman: resolutionProof.clientAmount
        ? `${fromAtomicUnits(BigInt(resolutionProof.clientAmount), token.decimals)} ${token.symbol}`
        : null,
      workerAmountHuman: resolutionProof.workerAmount
        ? `${fromAtomicUnits(BigInt(resolutionProof.workerAmount), token.decimals)} ${token.symbol}`
        : null,
    };

    const audit: ReceiptAudit = {
      explorerLinks: {
        escrowContract: isMainnet
          ? getCeloMainnetExplorerAddressUrl(escrowReader.contractAddress)
          : getCeloExplorerAddressUrl(escrowReader.contractAddress),
        client: isMainnet
          ? getCeloMainnetExplorerAddressUrl(proof.state.client)
          : getCeloExplorerAddressUrl(proof.state.client),
        worker: isMainnet
          ? getCeloMainnetExplorerAddressUrl(proof.state.worker)
          : getCeloExplorerAddressUrl(proof.state.worker),
        releaseTransaction: escrowStateLabel === "released" && proof.release.txHash
          ? isMainnet
            ? getCeloMainnetExplorerTxUrl(proof.release.txHash)
            : getCeloExplorerTxUrl(proof.release.txHash)
          : null,
        evidenceSubmissionTransaction: proof.evidenceSubmission.txHash
          ? isMainnet
            ? getCeloMainnetExplorerTxUrl(proof.evidenceSubmission.txHash)
            : getCeloExplorerTxUrl(proof.evidenceSubmission.txHash)
          : null,
        x402SettlementTransaction: qualityCheck.settlementTxHash
          ? getCeloMainnetExplorerTxUrl(qualityCheck.settlementTxHash)
          : null,
        disputeTransaction: disputeProof.txHash
          ? isMainnet
            ? getCeloMainnetExplorerTxUrl(disputeProof.txHash)
            : getCeloExplorerTxUrl(disputeProof.txHash)
          : null,
        resolutionTransaction: resolutionProof.txHash
          ? isMainnet
            ? getCeloMainnetExplorerTxUrl(resolutionProof.txHash)
            : getCeloExplorerTxUrl(resolutionProof.txHash)
          : null,
        cancellationTransaction: cancellationProof.txHash
          ? isMainnet
            ? getCeloMainnetExplorerTxUrl(cancellationProof.txHash)
            : getCeloExplorerTxUrl(cancellationProof.txHash)
          : null,
      },
      timestamps: {
        evidenceSubmittedAt: evidence.submittedAt,
        releaseAt: escrowStateLabel === "released" ? proof.state.releasedAt : null,
        qcSettlementAt,
        disputedAt: disputeProof.blockTime,
        resolvedAt: escrowStateLabel === "resolved" ? resolutionProof.blockTime : null,
        cancelledAt: cancellationProof.blockTime,
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
