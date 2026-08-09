// ---------------------------------------------------------------------------
// rebuild-review-packet.ts — Rebuild the durable human-review packet for
// Payment #1 (RA1R.8D) from PERSISTED data only (no payment):
//   - verified evidence facts (manifest-derived pasted text / claim / date)
//   - the ORIGINAL settled QC execution (result + provenance)
// Contradictory QC statements are marked as inconsistencies, never rewritten.
//
// Usage: npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/rebuild-review-packet.ts
// ---------------------------------------------------------------------------

import { SupabaseResolutionAgentStore } from "../src/lib/resolution-agent/store/supabase";
import { SupabaseEvidenceReader } from "../src/lib/evidence/reader";
import { ESCROW_STATE_MAP } from "../src/lib/resolution-agent/observation/types";
import { buildReviewPacket } from "../src/lib/evidence/reviewPacket";
import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import { protectedPaymentEscrowABI } from "../src/lib/contracts/ProtectedPaymentEscrow.abi";

const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";
const ESCROW_ADDRESS = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const RPC_URL = "https://rpc.ankr.com/celo_sepolia";
const TOOL_ID = "evidence-quality-check";

async function main() {
  const store = new SupabaseResolutionAgentStore();
  const evidenceReader = new SupabaseEvidenceReader();

  const agent = await store.getAgentById(AGENT_ID);
  if (!agent) throw new Error(`Agent not found: ${AGENT_ID}`);
  console.log(`Agent: ${agent.id} | status: ${agent.status}`);

  // ---- 1. Verified evidence facts -----------------------------------------
  const facts = await evidenceReader.getEvidenceMetadata(
    agent.identity.escrowPaymentId,
  );
  console.log("\n-- verified evidence facts --");
  console.log(
    JSON.stringify(
      {
        title: facts.title,
        evidenceType: facts.evidenceType,
        description: facts.description,
        relatedClaim: facts.relatedClaim,
        pastedText: facts.pastedText,
        evidenceDate: facts.evidenceDate,
        externalRef: facts.externalRef,
        fileHash: facts.fileHash,
        fileCount: facts.fileCount,
        substantiveEvidence: facts.substantiveEvidence,
      },
      null,
      2,
    ),
  );

  // ---- 2. Original settled QC execution (never rewritten) ------------------
  const executions = await store.listToolExecutions(agent.id);
  const qc = executions.find(
    (e) => e.tool_identifier === TOOL_ID && e.state === "settled",
  );
  if (!qc) throw new Error(`No settled ${TOOL_ID} execution found`);
  const result = (qc.result_data ?? {}) as Record<string, unknown>;
  console.log("\n-- settled QC execution --");
  console.log(
    JSON.stringify(
      {
        state: qc.state,
        requestHash: qc.request_hash,
        paymentReference: qc.payment_reference,
        settlementTxHash: qc.settlement_tx_hash,
        resultReference: qc.result_reference,
        result: result,
      },
      null,
      2,
    ),
  );

  // ---- 3. On-chain case parties + state ------------------------------------
  const viemClient = createPublicClient({
    chain: celoSepolia,
    transport: http(RPC_URL, { timeout: 10000 }),
  });
  const payment = (await viemClient.readContract({
    address: ESCROW_ADDRESS,
    abi: protectedPaymentEscrowABI,
    functionName: "getPayment",
    args: [BigInt(agent.identity.escrowPaymentId)],
  })) as Record<string, unknown>;
  const state = ESCROW_STATE_MAP[Number(payment.state as bigint)] ?? "unknown";

  // ---- 4. Build the packet -------------------------------------------------
  const packet = buildReviewPacket({
    agentId: agent.id,
    agentObjective: agent.goal,
    escrowChainId: agent.identity.escrowChainId,
    escrowContractAddress: agent.identity.escrowContractAddress,
    escrowPaymentId: agent.identity.escrowPaymentId,
    escrowState: state,
    client: payment.client as string,
    worker: payment.worker as string,
    amountAtomic: String(payment.amount as bigint),
    evidence: {
      evidenceReference: facts.evidenceReference,
      title: facts.title,
      evidenceType: facts.evidenceType,
      description: facts.description,
      relatedClaim: facts.relatedClaim,
      pastedText: facts.pastedText,
      evidenceDate: facts.evidenceDate,
      externalRef: facts.externalRef,
      fileHash: facts.fileHash,
      fileCount: facts.fileCount,
      availability: facts.substantiveEvidence ? "package_available" : "missing",
      substantiveEvidence: facts.substantiveEvidence,
      caseVersionHash: agent.caseVersionHash,
      evidenceVersionHash: agent.evidenceVersionHash,
    },
    qualityCheck: {
      toolId: TOOL_ID,
      executionRequestHash: qc.request_hash,
      readiness: (result.readiness as string) ?? null,
      missingEvidence: Array.isArray(result.missingEvidence)
        ? (result.missingEvidence as string[])
        : [],
      ambiguities: Array.isArray(result.ambiguities) ? (result.ambiguities as string[]) : [],
      reviewerQuestions: Array.isArray(result.reviewerQuestions)
        ? (result.reviewerQuestions as string[])
        : [],
      recommendedImprovements: Array.isArray(result.recommendedImprovements)
        ? (result.recommendedImprovements as string[])
        : [],
      settlementTxHash: qc.settlement_tx_hash,
      paymentReference: qc.payment_reference,
      resultReference: qc.result_reference,
    },
  });

  console.log("\n-- review packet (qcInconsistency) --");
  console.log(JSON.stringify(packet.qcInconsistency, null, 2));

  // ---- 5. Append the durable packet event ---------------------------------
  await store.appendEvent(
    agent.id,
    "review_packet_prepared",
    "Rebuilt durable human review packet with verified evidence facts (RA1R.8D); contradictions with the pre-facts QC run are marked as inconsistencies.",
    null,
    null,
    packet,
  );
  console.log("\nreview_packet_prepared event appended.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
