// ---------------------------------------------------------------------------
// I4: Legacy settlement migration — inserts the verified historical settlement
//     into the durable Supabase store.
//
// Run with: node scripts/migrate-legacy-settlement.mjs
//
// This script is IDEMPOTENT — running it twice will not create duplicates.
// It verifies the transaction on-chain before inserting.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, parseAbi, decodeEventLog } from "viem";
import { celoSepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (avoid dotenv dependency)
const envPath = resolve(process.cwd(), ".env.local");
if (!existsSync(envPath)) {
  console.error("ERROR: .env.local not found");
  process.exit(1);
}
const envContent = readFileSync(envPath, "utf-8");
const envLines = envContent.split(/\r?\n/);
const env = {};
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
}

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const CELO_RPC_URL = env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Canonical live settlement
// ---------------------------------------------------------------------------

const SETTLEMENT = {
  txHash: "0x392415d5642f5e74327fddbfba6fd1f434b05e7c6d4e084e3f7bcc4fbb9f0d7c",
  buyer: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
  payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
  amount: 10000n,
  amountDisplay: "0.01",
  token: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  chainId: 11142220,
  legacyPaymentId: "pay_legacy_00000000-0000-0000-0000-000000000001",
};

async function verifyTxOnChain() {
  console.log(`Verifying transaction ${SETTLEMENT.txHash} on-chain...`);

  const client = createPublicClient({
    chain: celoSepolia,
    transport: http(CELO_RPC_URL),
  });

  const receipt = await client.getTransactionReceipt({ hash: SETTLEMENT.txHash });
  if (!receipt || receipt.status !== "success") {
    throw new Error(`Transaction ${SETTLEMENT.txHash} not found or not successful`);
  }

  const erc20EventABI = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);

  let matched = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SETTLEMENT.token.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: erc20EventABI,
        data: log.data,
        topics: log.topics,
        eventName: "Transfer",
      });
      const args = decoded.args;
      if (
        args.from.toLowerCase() === SETTLEMENT.buyer.toLowerCase() &&
        args.to.toLowerCase() === SETTLEMENT.payTo.toLowerCase() &&
        args.value === SETTLEMENT.amount
      ) {
        matched = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!matched) {
    throw new Error("Transaction verified but no matching USDC Transfer event found");
  }

  console.log(`  Verified: ${SETTLEMENT.amountDisplay} USDC from ${SETTLEMENT.buyer} to ${SETTLEMENT.payTo}`);
  return receipt;
}

async function migrate() {
  console.log("I4 Legacy Settlement Migration");
  console.log("==============================");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  // Step 1: Verify tx on-chain
  const receipt = await verifyTxOnChain();

  // Step 2: Check if legacy payment already exists
  const { data: existing } = await supabase
    .from("x402_payments")
    .select("payment_identifier")
    .eq("payment_identifier", SETTLEMENT.legacyPaymentId)
    .maybeSingle();

  if (existing) {
    console.log(`Legacy payment ${SETTLEMENT.legacyPaymentId} already exists — skipping.`);
  } else {
    // Step 3: Insert legacy payment record
    const { error: insertError } = await supabase
      .from("x402_payments")
      .insert({
        payment_identifier: SETTLEMENT.legacyPaymentId,
        service_identifier: "reclaim-dispute-brief-v1",
        escrow_payment_id: "1",
        payer_address: SETTLEMENT.buyer,
        pay_to_address: SETTLEMENT.payTo,
        network: `eip155:${SETTLEMENT.chainId}`,
        chain_id: SETTLEMENT.chainId,
        token_address: SETTLEMENT.token,
        token_symbol: "USDC",
        token_decimals: 6,
        amount_atomic: SETTLEMENT.amount.toString(),
        amount_display: SETTLEMENT.amountDisplay,
        state: "settled",
        transaction_hash: SETTLEMENT.txHash,
        block_number: Number(receipt.blockNumber),
        settlement_receipt: {
          txHash: SETTLEMENT.txHash,
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          status: "success",
          from: SETTLEMENT.buyer,
          to: SETTLEMENT.payTo,
          amount: SETTLEMENT.amount.toString(),
          tokenAddress: SETTLEMENT.token,
        },
        settled_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(`Failed to insert legacy payment: ${insertError.message}`);
    }
    console.log(`Inserted legacy payment: ${SETTLEMENT.legacyPaymentId}`);
  }

  // Step 4: Check if txHash already consumed
  const { data: existingConsumed } = await supabase
    .from("x402_consumed_transactions")
    .select("transaction_hash")
    .eq("transaction_hash", SETTLEMENT.txHash)
    .maybeSingle();

  if (existingConsumed) {
    console.log(`Transaction ${SETTLEMENT.txHash} already consumed — skipping.`);
  } else {
    const { error: consumedError } = await supabase
      .from("x402_consumed_transactions")
      .insert({
        transaction_hash: SETTLEMENT.txHash,
        payment_identifier: SETTLEMENT.legacyPaymentId,
        escrow_payment_id: "1",
        payer_address: SETTLEMENT.buyer,
        pay_to_address: SETTLEMENT.payTo,
        token_address: SETTLEMENT.token,
        amount_atomic: SETTLEMENT.amount.toString(),
        recovery_type: "legacy_recovered_settlement",
        metadata: {
          provenance: "I4_legacy_recovered_settlement",
          recoveredAt: new Date().toISOString(),
          originalChainId: SETTLEMENT.chainId,
        },
        consumed_at: new Date().toISOString(),
      });

    if (consumedError) {
      throw new Error(`Failed to record consumed tx: ${consumedError.message}`);
    }
    console.log(`Marked ${SETTLEMENT.txHash} as consumed (legacy, one-time)`);
  }

  console.log("\nLegacy migration complete — idempotent, safe to re-run.");
  console.log(`  Payment: ${SETTLEMENT.legacyPaymentId}`);
  console.log(`  Transaction: ${SETTLEMENT.txHash}`);
  console.log(`  Bound to: Payment #1, buyer ${SETTLEMENT.buyer}, ${SETTLEMENT.amountDisplay} USDC`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
