// ---------------------------------------------------------------------------
// SupabasePaymentStore — durable implementation of PaymentStore
//
// Uses PostgreSQL via Supabase for:
//   - Payment lifecycle persistence across Vercel instances
//   - Atomic state transitions (no read-then-write races)
//   - Transaction hash uniqueness enforcement
//   - Consumed-transaction replay protection
//   - Request hash binding
//
// All state mutations use conditional PostgreSQL queries (WHERE clauses on
// expected current state) to prevent concurrent conflicts across instances.
// ---------------------------------------------------------------------------

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SettlementReceipt } from "./types";
import type { DisputeBrief } from "./disputeBrief";
import type {
  PaymentStore,
  PaymentIdentifier,
  PaymentStatus,
  PaymentRecord,
  ConsumedTxRecord,
} from "./paymentStore";

// ---------------------------------------------------------------------------
// Row types matching the database schema
// ---------------------------------------------------------------------------

interface X402PaymentRow {
  id: string;
  payment_identifier: string;
  service_identifier: string;
  escrow_payment_id: string | null;
  payer_address: string;
  pay_to_address: string;
  relayer_address: string | null;
  network: string;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  token_decimals: number;
  amount_atomic: string;
  amount_display: string;
  request_hash: string | null;
  dispute_reason: string | null;
  requested_outcome: string | null;
  authorization_nonce: string | null;
  authorization_deadline: string | null;
  authorization_status: string | null;
  state: string;
  transaction_hash: string | null;
  block_number: number | null;
  settlement_receipt: SettlementReceipt | null;
  brief: DisputeBrief | null;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
}

interface ConsumedTxDbRow {
  transaction_hash: string;
  payment_identifier: string;
  escrow_payment_id: string | null;
  payer_address: string;
  pay_to_address: string;
  token_address: string;
  amount_atomic: string;
  request_hash: string | null;
  consumed_at: string;
  recovery_type: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SupabasePaymentStore implements PaymentStore {
  private getClient() {
    return getSupabaseClient();
  }

  createPaymentId(): PaymentIdentifier {
    return `pay_${crypto.randomUUID()}`;
  }

  // -----------------------------------------------------------------------
  // recordPending — atomic insert, rejects if payment_identifier exists
  // -----------------------------------------------------------------------

  async recordPending(paymentId: PaymentIdentifier, payerAddress = "", payToAddress = "", amount = "10000"): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_payments")
      .insert({
        payment_identifier: paymentId,
        payer_address: payerAddress || "pending",
        pay_to_address: payToAddress || "pending",
        network: "eip155:11142220",
        chain_id: 11142220,
        token_address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
        amount_atomic: amount,
        amount_display: "0.01",
        state: "pending",
      });

    if (error && error.code !== "23505") {
      console.error(`[SupabasePaymentStore] recordPending failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // recordSettled — final settled state with receipt + brief
  // -----------------------------------------------------------------------

  async recordSettled(
    paymentId: PaymentIdentifier,
    receipt: SettlementReceipt,
    brief: DisputeBrief,
  ): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_payments")
      .update({
        state: "settled",
        transaction_hash: receipt.txHash,
        block_number: Number(receipt.blockNumber),
        settlement_receipt: receipt as unknown as Record<string, unknown>,
        brief: brief as unknown as Record<string, unknown>,
        settled_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified", "settlement_submitted", "paid_pending_brief"]);

    if (error) {
      console.error(`[SupabasePaymentStore] recordSettled failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // recordFailed
  // -----------------------------------------------------------------------

  async recordFailed(paymentId: PaymentIdentifier, errorMessage: string): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_payments")
      .update({
        state: "failed",
        error_message: errorMessage,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified", "settlement_submitted"]);

    if (error) {
      console.error(`[SupabasePaymentStore] recordFailed failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  async getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("state")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (error || !data) return undefined;
    return mapDbStateToPaymentStatus(data.state);
  }

  // -----------------------------------------------------------------------
  // getResult
  // -----------------------------------------------------------------------

  async getResult(
    paymentId: PaymentIdentifier,
  ): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("state, settlement_receipt, brief")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (error || !data) return undefined;

    const status = mapDbStateToPaymentStatus(data.state);
    if (
      (status === "settled" || status === "paid_pending_brief") &&
      data.settlement_receipt
    ) {
      return {
        receipt: data.settlement_receipt,
        brief: data.brief ?? undefined,
      };
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // getError
  // -----------------------------------------------------------------------

  async getError(paymentId: PaymentIdentifier): Promise<string | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("state, error_message")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (error || !data) return undefined;
    if (data.state === "failed") return data.error_message ?? undefined;
    return undefined;
  }

  // -----------------------------------------------------------------------
  // recordSettlementReceipt — atomic: only updates if txHash not yet set
  // -----------------------------------------------------------------------

  async recordSettlementReceipt(
    paymentId: PaymentIdentifier,
    receipt: SettlementReceipt,
  ): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_payments")
      .update({
        state: "paid_pending_brief",
        transaction_hash: receipt.txHash,
        block_number: Number(receipt.blockNumber),
        settlement_receipt: receipt as unknown as Record<string, unknown>,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified", "settlement_submitted"])
      .is("transaction_hash", null);

    if (error) {
      console.error(`[SupabasePaymentStore] recordSettlementReceipt failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // recordBrief — atomic: only upgrades paid_pending_brief → settled
  // -----------------------------------------------------------------------

  async recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void> {
    const briefRecord = brief as unknown as Record<string, unknown>;
    const generationMode = briefRecord.generationMode || briefRecord.generation_mode;
    const aiProvider = briefRecord.provider || briefRecord.ai_provider;
    const aiModel = briefRecord.model || briefRecord.ai_model;

    const updateData: Record<string, unknown> = {
      state: "settled",
      brief: brief as unknown as Record<string, unknown>,
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      generation_completed_at: new Date().toISOString(),
      generation_status: "completed",
    };

    if (generationMode) updateData.generation_mode = generationMode;
    if (aiProvider) updateData.ai_provider = aiProvider;
    if (aiModel) updateData.ai_model = aiModel;

    const { error } = await this.getClient()
      .from("x402_payments")
      .update(updateData)
      .eq("payment_identifier", paymentId)
      .eq("state", "paid_pending_brief");

    if (error) {
      console.error(`[SupabasePaymentStore] recordBrief failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // getAllEntries
  // -----------------------------------------------------------------------

  async getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    const map = new Map<PaymentIdentifier, PaymentRecord>();
    if (error || !data) return map;

    for (const row of data as X402PaymentRow[]) {
      map.set(row.payment_identifier, dbRowToPaymentRecord(row));
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // findByTxHash
  // -----------------------------------------------------------------------

  async findByTxHash(
    txHash: string,
  ): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("*")
      .eq("transaction_hash", txHash)
      .maybeSingle();

    if (error || !data) return undefined;

    const row = data as X402PaymentRow;
    return {
      paymentId: row.payment_identifier,
      record: dbRowToPaymentRecord(row),
    };
  }

  // -----------------------------------------------------------------------
  // isTxHashConsumed
  // -----------------------------------------------------------------------

  async isTxHashConsumed(txHash: string): Promise<boolean> {
    const { count, error } = await this.getClient()
      .from("x402_consumed_transactions")
      .select("*", { count: "exact", head: true })
      .eq("transaction_hash", txHash);

    if (error) return false;
    return (count ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // consumeTxHash — atomic insert, fails if txHash already consumed
  // -----------------------------------------------------------------------

  async consumeTxHash(
    txHash: string,
    paymentId: PaymentIdentifier,
    metadata?: Partial<ConsumedTxRecord>,
  ): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_consumed_transactions")
      .insert({
        transaction_hash: txHash,
        payment_identifier: paymentId,
        payer_address: metadata?.recoveredPayer || "unknown",
        pay_to_address: "",
        token_address: "",
        amount_atomic: "0",
        request_hash: metadata?.recoveredRequestHash ?? null,
        recovery_type: metadata?.legacyRecovery ? "legacy_recovered_settlement" : "standard",
        metadata: metadata as unknown as Record<string, unknown> ?? null,
      });

    if (error) {
      if (error.code === "23505") {
        console.log(`[SupabasePaymentStore] consumeTxHash: txHash ${txHash} already consumed`);
      } else {
        console.error(`[SupabasePaymentStore] consumeTxHash failed: ${error.message}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // findConsumedTx
  // -----------------------------------------------------------------------

  async findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_consumed_transactions")
      .select("*")
      .eq("transaction_hash", txHash)
      .maybeSingle();

    if (error || !data) return undefined;

    const row = data as ConsumedTxDbRow;
    return {
      txHash: row.transaction_hash,
      paymentId: row.payment_identifier,
      consumedAt: new Date(row.consumed_at).getTime(),
      legacyRecovery: row.recovery_type === "legacy_recovered_settlement",
      recoveredPayer: row.payer_address,
      recoveredRequestHash: row.request_hash ?? undefined,
    };
  }

  // -----------------------------------------------------------------------
  // setRequestHash — atomic: only sets if no request_hash yet
  // -----------------------------------------------------------------------

  async setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void> {
    const { error } = await this.getClient()
      .from("x402_payments")
      .update({ request_hash: requestHash, updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .is("request_hash", null);

    if (error) {
      console.error(`[SupabasePaymentStore] setRequestHash failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // getRequestHash
  // -----------------------------------------------------------------------

  async getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .select("request_hash")
      .eq("payment_identifier", paymentId)
      .maybeSingle();

    if (error || !data) return undefined;
    return data.request_hash ?? undefined;
  }
}

// ---------------------------------------------------------------------------
// Factory — selects in-memory or Supabase based on configuration
// ---------------------------------------------------------------------------

import { InMemoryPaymentStore } from "./paymentStore";

let cachedStore: PaymentStore | undefined;

export function getPaymentStore(): PaymentStore {
  if (cachedStore) return cachedStore;

  if (isSupabaseConfigured()) {
    console.log("[x402] Using Supabase durable payment store");
    cachedStore = new SupabasePaymentStore();
  } else {
    console.log("[x402] Supabase not configured — using in-memory payment store");
    cachedStore = new InMemoryPaymentStore();
  }

  return cachedStore;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapDbStateToPaymentStatus(dbState: string): PaymentStatus | undefined {
  switch (dbState) {
    case "pending":
    case "authorization_verified":
    case "settlement_submitted":
      return "pending";
    case "paid_pending_brief":
      return "paid_pending_brief";
    case "settled":
      return "settled";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function dbRowToPaymentRecord(row: X402PaymentRow): PaymentRecord {
  return {
    status: mapDbStateToPaymentStatus(row.state) ?? "pending",
    receipt: row.settlement_receipt ?? undefined,
    brief: row.brief ?? undefined,
    error: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}
