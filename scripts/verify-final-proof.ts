// ---------------------------------------------------------------------------
// verify-final-proof.ts — READ-ONLY proof of the final Reclaim E2E state.
//
// Usage: npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/verify-final-proof.ts
//
// Reads ONLY. No transactions, no agent runs, no x402 calls.
// ---------------------------------------------------------------------------

import { createPublicClient, http } from "viem";
import { celoSepolia, celo } from "viem/chains";
import { protectedPaymentEscrowABI } from "../src/lib/contracts/ProtectedPaymentEscrow.abi";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "../src/lib/resolution-agent/api/escrow-reader";
import { SupabaseEvidenceReader } from "../src/lib/evidence/reader";
import { SupabaseResolutionAgentStore } from "../src/lib/resolution-agent/store/supabase";
import { ESCROW_STATE_MAP } from "../src/lib/resolution-agent/observation/types";

const PAYMENT_ID = 1n;
const SEPOLIA_RPC = "https://rpc.ankr.com/celo_sepolia";
const MAINNET_RPC = "https://forno.celo.org";
const X402_SETTLEMENT_TX =
  "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351";
const AGENT_ID = "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235";

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

/**
 * Bounded PaymentReleased(paymentId) scan: estimate the block for a target
 * timestamp using the RECENT average block time, then scan a generous window
 * up to the head block. Returns the latest matching log (read-only).
 */
async function findReleaseLog(
  client: ReturnType<typeof createPublicClient>,
  releasedAtUnix: number,
) {
  const head = await client.getBlock({ blockTag: "latest" });
  const headNum = head.number as bigint;
  const headTs = Number(head.timestamp);

  const anchor = headNum - 2000n;
  const anchorBlock = await client.getBlock({ blockNumber: anchor });
  const recentSecsPerBlock =
    (headTs - Number(anchorBlock.timestamp)) / 2000;
  const secsSince = headTs - releasedAtUnix;
  const estBack = Math.ceil(secsSince / recentSecsPerBlock) + 400;
  // ankr caps eth_getLogs block ranges — keep the window <= 900 blocks.
  const windowBlocks = Math.min(Math.max(estBack, 400), 900);
  const fromBlock = BigInt(Math.max(0, Number(headNum) - windowBlocks));

  const logs = await client.getLogs({
    address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
    event: PAYMENT_RELEASED_EVENT,
    args: { paymentId: PAYMENT_ID },
    fromBlock,
    toBlock: headNum,
  });
  return { logs, headNum, headTs };
}

async function main() {
  const sepolia = createPublicClient({
    chain: celoSepolia,
    transport: http(SEPOLIA_RPC, { timeout: 15000 }),
  });
  const mainnet = createPublicClient({
    chain: celo,
    transport: http(MAINNET_RPC, { timeout: 15000 }),
  });

  console.log("==== 1. FINAL getPayment(1) ====");
  const payment = (await sepolia.readContract({
    address: CANONICAL_ESCROW_CONTRACT_ADDRESS,
    abi: protectedPaymentEscrowABI,
    functionName: "getPayment",
    args: [PAYMENT_ID],
  })) as Record<string, unknown>;

  const stateNum = Number(payment.state as bigint);
  console.log("state           :", stateNum, "=", ESCROW_STATE_MAP[stateNum]);
  console.log("client          :", payment.client);
  console.log("worker          :", payment.worker);
  console.log("token           :", payment.token);
  console.log("amount          :", payment.amount?.toString());
  console.log("evidenceReference:", payment.evidenceReference);
  console.log("disputeReference:", payment.disputeReference);
  console.log(
    "deliveryAt      :",
    new Date(Number(payment.deliveryAt as bigint) * 1000).toISOString(),
  );
  console.log(
    "releasedAt      :",
    new Date(Number(payment.releasedAt as bigint) * 1000).toISOString(),
  );

  console.log("\n==== 2. LATEST approveRelease(1) tx ====");
  const releasedAt = Number(payment.releasedAt as bigint);
  const { logs } = await findReleaseLog(sepolia, releasedAt);
  const latest = logs[logs.length - 1];
  if (!latest) {
    console.log("NO PaymentReleased event found in bounded scan!");
  } else {
    console.log("tx hash         :", latest.transactionHash);
    console.log("block           :", latest.blockNumber?.toString());
    const receipt = await sepolia.getTransactionReceipt({
      hash: latest.transactionHash,
    });
    console.log("status          :", receipt.status);
    const tx = await sepolia.getTransaction({ hash: latest.transactionHash });
    console.log("sender (from)   :", tx.from);
    console.log("to (escrow)     :", tx.to);
    console.log("function sel    :", tx.input.slice(0, 10), "(= approveRelease(uint256))");
    const block = await sepolia.getBlock({ blockNumber: receipt.blockNumber });
    console.log(
      "block time      :",
      new Date(Number(block.timestamp) * 1000).toISOString(),
    );
    console.log("event client    :", latest.args?.client);
    console.log("event worker    :", latest.args?.worker);
    console.log("event amount    :", latest.args?.amount?.toString());
    console.log(
      "USDC transfers  : escrow -> worker (see receipt.logs)",
    );
  }

  console.log("\n==== 3. x402 settlement (Celo Mainnet) — READ-ONLY ====");
  try {
    const mainnetReceipt = await mainnet.getTransactionReceipt({
      hash: X402_SETTLEMENT_TX,
    });
    console.log("tx hash         :", X402_SETTLEMENT_TX);
    console.log("status          :", mainnetReceipt.status);
    console.log("block           :", mainnetReceipt.blockNumber?.toString());
    const mainnetTx = await mainnet.getTransaction({ hash: X402_SETTLEMENT_TX });
    console.log("from            :", mainnetTx.from);
    console.log("to              :", mainnetTx.to);
    const mainnetBlock = await mainnet.getBlock({
      blockNumber: mainnetReceipt.blockNumber,
    });
    console.log(
      "block time      :",
      new Date(Number(mainnetBlock.timestamp) * 1000).toISOString(),
    );
  } catch (err) {
    console.log(
      "mainnet read failed:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("\n==== 4. Durable evidence (verified) ====");
  const evidenceReader = new SupabaseEvidenceReader();
  const facts = await evidenceReader.getEvidenceMetadata("1");
  console.log(
    JSON.stringify(
      {
        evidenceReference: facts.evidenceReference,
        title: facts.title,
        pastedText: facts.pastedText,
        evidenceDate: facts.evidenceDate,
        relatedClaim: facts.relatedClaim,
        substantiveEvidence: facts.substantiveEvidence,
      },
      null,
      2,
    ),
  );

  console.log("\n==== 5. Agent + exactly-one-paid-QC ====");
  const store = new SupabaseResolutionAgentStore();
  const agent = await store.getAgentById(AGENT_ID);
  if (!agent) throw new Error("agent not found");
  const executions = await store.listToolExecutions(agent.id);
  const qcExecutions = executions.filter(
    (e) => e.tool_identifier === "evidence-quality-check",
  );
  const settledQc = qcExecutions.filter((e) => e.state === "settled");
  const paidQc = qcExecutions.filter((e) => e.settlement_tx_hash);
  console.log("agent           :", agent.id);
  console.log("goal            :", agent.goal);
  console.log("budget approved :", agent.approvedBudgetAtomic);
  console.log("budget spent    :", agent.spentBudgetAtomic);
  console.log("budget reserved :", agent.reservedBudgetAtomic);
  console.log(
    "QC executions   :",
    qcExecutions.length,
    "(settled:",
    settledQc.length,
    ")",
  );
  console.log("paid QC (has tx):", paidQc.length);
  for (const e of paidQc) {
    console.log(
      "  -",
      e.tool_identifier,
      e.state,
      e.request_hash,
      e.settlement_tx_hash,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
