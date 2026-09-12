// ---------------------------------------------------------------------------
// Durable Supabase implementation of the x402 payment store.
// ---------------------------------------------------------------------------

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SettlementReceipt } from "./types";
import type { DisputeBrief } from "./disputeBrief";
import {
  assertPaymentMetadataPersistable,
  assertPaymentMetadataMatches,
  assertSettlementReceiptMatchesMetadata,
  assertSettlementReceiptPersistable,
  InMemoryPaymentStore,
  type ConsumedTxRecord,
  type PaymentCreateResult,
  type PaymentIdentifier,
  type PaymentMetadata,
  type PaymentRecord,
  type PaymentState,
  type PaymentStatus,
  type PaymentStore,
  type SettlementClaim,
  PaymentStoreConflictError,
} from "./paymentStore";

interface X402PaymentRow {
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
  state: PaymentState;
  transaction_hash: string | null;
  block_number: number | string | null;
  settlement_receipt: SettlementReceipt | null;
  brief: DisputeBrief | null;
  error_message: string | null;
  created_at: string;
}

interface ConsumedTxDbRow {
  transaction_hash: string;
  payment_identifier: string;
  payer_address: string;
  request_hash: string | null;
  consumed_at: string;
  recovery_type: string;
}

function throwDbError(operation: string, error: { message: string; code?: string }): never {
  throw new Error(`[SupabasePaymentStore] ${operation} failed: ${error.message}`);
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

export class SupabasePaymentStore implements PaymentStore {
  private getClient() {
    return getSupabaseClient();
  }

  createPaymentId(): PaymentIdentifier {
    return `pay_${crypto.randomUUID()}`;
  }

  async recordPending(paymentId: PaymentIdentifier, metadata?: PaymentMetadata): Promise<PaymentCreateResult> {
    if (!metadata) {
      throw new Error("Durable x402 pending creation requires complete payment metadata.");
    }
    assertPaymentMetadataPersistable(metadata);

    const { error } = await this.getClient().from("x402_payments").insert({
      payment_identifier: paymentId,
      service_identifier: metadata.service,
      escrow_payment_id: metadata.escrowPaymentId ?? null,
      payer_address: metadata.payerAddress,
      pay_to_address: metadata.payToAddress,
      network: metadata.network,
      chain_id: metadata.chainId,
      token_address: metadata.tokenAddress,
      token_symbol: metadata.tokenSymbol,
      token_decimals: metadata.tokenDecimals,
      amount_atomic: metadata.amountAtomic,
      amount_display: metadata.amountDisplay,
      request_hash: metadata.requestHash ?? null,
      dispute_reason: metadata.disputeReason ?? null,
      requested_outcome: metadata.requestedOutcome ?? null,
      authorization_nonce: metadata.authorizationNonce ?? null,
      authorization_deadline: metadata.authorizationDeadline ?? null,
      authorization_status: "pending",
      state: "pending",
    });

    if (!error) {
      const row = await this.getRowByPaymentId(paymentId);
      if (!row) throw new Error(`[SupabasePaymentStore] pending payment ${paymentId} was inserted but could not be read.`);
      return { created: true, paymentId, record: dbRowToPaymentRecord(row) };
    }

    if (!isUniqueViolation(error)) throwDbError("recordPending", error);

    // PostgreSQL's unique payment_identifier/request_hash constraints decide
    // the winner. Recover that row rather than attempting another settlement.
    const existingByPaymentId = await this.getRowByPaymentId(paymentId);
    const existingByRequestHash = !existingByPaymentId && metadata.requestHash
      ? await this.getRowByRequestHash(metadata.requestHash)
      : undefined;
    const existing = existingByPaymentId ?? existingByRequestHash;
    if (!existing) throwDbError("recordPending unique-conflict recovery", error);
    const existingMetadata = dbRowToPaymentRecord(existing).metadata;
    if (!existingMetadata) {
      throw new PaymentStoreConflictError(
        `Request hash is already bound to payment ${existing.payment_identifier}, but its server-owned metadata is unavailable for comparison.`,
      );
    }
    assertPaymentMetadataMatches(existingMetadata, metadata);
    return {
      created: false,
      paymentId: existing.payment_identifier,
      record: dbRowToPaymentRecord(existing),
    };
  }

  async recordAuthorizationVerified(paymentId: PaymentIdentifier): Promise<void> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({ state: "authorization_verified", authorization_status: "verified", updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .eq("state", "pending")
      .select("*")
      .maybeSingle();
    if (error) throwDbError("recordAuthorizationVerified", error);
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.state === "authorization_verified" || existing.state === "settlement_submitted" || existing.state === "paid_pending_brief" || existing.state === "settled") return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} cannot be authorization-verified from ${existing.state}.`);
  }

  async claimSettlement(paymentId: PaymentIdentifier, requestHash?: string): Promise<SettlementClaim> {
    let query = this.getClient()
      .from("x402_payments")
      .update({ state: "settlement_submitted", updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified"])
      .select("*");
    if (requestHash) query = query.eq("request_hash", requestHash);
    const { data, error } = await query.maybeSingle();
    if (error) throwDbError("claimSettlement", error);
    if (data) return { claimed: true, state: "settlement_submitted" };

    const existing = await this.requireRow(paymentId);
    if (requestHash && existing.request_hash !== requestHash) {
      throw new PaymentStoreConflictError(`Payment ${paymentId} is bound to a different request hash.`);
    }
    return {
      claimed: false,
      state: existing.state,
      receipt: existing.settlement_receipt ?? undefined,
      brief: existing.brief ?? undefined,
    };
  }

  async getState(paymentId: PaymentIdentifier): Promise<PaymentState | undefined> {
    const row = await this.getRowByPaymentId(paymentId);
    return row?.state;
  }

  async recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): Promise<void> {
    await this.recordSettlementReceipt(paymentId, receipt);
    await this.recordBrief(paymentId, brief);
  }

  async recordFailed(paymentId: PaymentIdentifier, errorMessage: string): Promise<void> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({ state: "failed", error_message: errorMessage, failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified"])
      .select("*")
      .maybeSingle();
    if (error) throwDbError("recordFailed", error);
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.state === "failed" || existing.state === "paid_pending_brief" || existing.state === "settled") return;
    if (existing.state === "settlement_submitted") return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} cannot be marked failed from ${existing.state}.`);
  }

  async recordSettlementFailed(paymentId: PaymentIdentifier, errorMessage: string): Promise<void> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({ state: "failed", error_message: errorMessage, failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .eq("state", "settlement_submitted")
      .select("*")
      .maybeSingle();
    if (error) throwDbError("recordSettlementFailed", error);
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.state === "failed" || existing.state === "paid_pending_brief" || existing.state === "settled") return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} cannot be marked settlement-failed from ${existing.state}.`);
  }

  async getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined> {
    const row = await this.getRowByPaymentId(paymentId);
    return row ? statusForState(row.state) : undefined;
  }

  async getResult(paymentId: PaymentIdentifier): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    const row = await this.getRowByPaymentId(paymentId);
    if (!row || !row.settlement_receipt) return undefined;
    const status = statusForState(row.state);
    return status === "settled" || status === "paid_pending_brief"
      ? { receipt: row.settlement_receipt, brief: row.brief ?? undefined }
      : undefined;
  }

  async getError(paymentId: PaymentIdentifier): Promise<string | undefined> {
    const row = await this.getRowByPaymentId(paymentId);
    return row?.state === "failed" ? row.error_message ?? undefined : undefined;
  }

  async recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): Promise<void> {
    // Validate before issuing any mutation. Incomplete or reverted receipts
    // must never become durable payment records.
    assertSettlementReceiptPersistable(receipt);
    const existingBeforeUpdate = await this.requireRow(paymentId);
    if (existingBeforeUpdate.settlement_receipt) {
      if (existingBeforeUpdate.settlement_receipt.txHash.toLowerCase() === receipt.txHash.toLowerCase()) return;
      throw new PaymentStoreConflictError(`Payment ${paymentId} already has a different settlement receipt.`);
    }
    assertSettlementReceiptMatchesMetadata(
      dbRowToPaymentRecord(existingBeforeUpdate).metadata!,
      receipt,
    );
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({
        state: "paid_pending_brief",
        transaction_hash: receipt.txHash,
        block_number: receipt.blockNumber.toString(),
        settlement_receipt: receipt as unknown as Record<string, unknown>,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_identifier", paymentId)
      .in("state", ["pending", "authorization_verified", "settlement_submitted"])
      .is("transaction_hash", null)
      .is("settlement_receipt", null)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        const owner = await this.findByTxHash(receipt.txHash);
        if (owner?.paymentId === paymentId && owner.record.receipt?.txHash.toLowerCase() === receipt.txHash.toLowerCase()) {
          return;
        }
        throw new PaymentStoreConflictError(
          `Settlement transaction ${receipt.txHash} is already bound to another payment.`,
        );
      }
      throwDbError("recordSettlementReceipt", error);
    }
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.settlement_receipt) {
      if (existing.settlement_receipt.txHash.toLowerCase() === receipt.txHash.toLowerCase()) return;
      throw new PaymentStoreConflictError(`Payment ${paymentId} already has a different settlement receipt.`);
    }
    throw new PaymentStoreConflictError(`Payment ${paymentId} is not eligible for settlement receipt persistence from ${existing.state}.`);
  }

  async recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({ state: "settled", brief: brief as unknown as Record<string, unknown>, delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .eq("state", "paid_pending_brief")
      .select("*")
      .maybeSingle();
    if (error) throwDbError("recordBrief", error);
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.state === "settled" && existing.brief) return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} cannot record a brief from ${existing.state}.`);
  }

  async getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>> {
    const { data, error } = await this.getClient().from("x402_payments").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throwDbError("getAllEntries", error);
    const entries = new Map<PaymentIdentifier, PaymentRecord>();
    for (const row of (data ?? []) as X402PaymentRow[]) entries.set(row.payment_identifier, dbRowToPaymentRecord(row));
    return entries;
  }

  async findByTxHash(txHash: string): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined> {
    const { data, error } = await this.getClient().from("x402_payments").select("*").ilike("transaction_hash", txHash).maybeSingle();
    if (error) throwDbError("findByTxHash", error);
    if (!data) return undefined;
    const row = data as X402PaymentRow;
    return { paymentId: row.payment_identifier, record: dbRowToPaymentRecord(row) };
  }

  async isTxHashConsumed(txHash: string): Promise<boolean> {
    const { count, error } = await this.getClient().from("x402_consumed_transactions").select("transaction_hash", { count: "exact", head: true }).ilike("transaction_hash", txHash);
    if (error) throwDbError("isTxHashConsumed", error);
    return (count ?? 0) > 0;
  }

  async consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): Promise<void> {
    const { error } = await this.getClient().from("x402_consumed_transactions").insert({
      transaction_hash: txHash,
      payment_identifier: paymentId,
      payer_address: metadata?.recoveredPayer || "unknown",
      pay_to_address: "unknown",
      token_address: "unknown",
      amount_atomic: "0",
      request_hash: metadata?.recoveredRequestHash ?? null,
      recovery_type: metadata?.legacyRecovery ? "legacy_recovered_settlement" : "standard",
      metadata: metadata as unknown as Record<string, unknown> ?? null,
    });
    if (!error) return;
    if (isUniqueViolation(error)) {
      const existingByHash = await this.getConsumedTxRowByHash(txHash);
      if (existingByHash?.payment_identifier === paymentId) return;
      const existingByPayment = await this.getConsumedTxRowByPaymentId(paymentId);
      if (existingByPayment) {
        throw new PaymentStoreConflictError(
          `Payment ${paymentId} already consumed transaction ${existingByPayment.transaction_hash}.`,
        );
      }
      throw new PaymentStoreConflictError(
        `Transaction ${txHash} is already consumed for another payment.`,
      );
    }
    throwDbError("consumeTxHash", error);
  }

  async findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined> {
    const { data, error } = await this.getClient().from("x402_consumed_transactions").select("*").ilike("transaction_hash", txHash).maybeSingle();
    if (error) throwDbError("findConsumedTx", error);
    if (!data) return undefined;
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

  async setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void> {
    const { data, error } = await this.getClient()
      .from("x402_payments")
      .update({ request_hash: requestHash, updated_at: new Date().toISOString() })
      .eq("payment_identifier", paymentId)
      .is("request_hash", null)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) throw new PaymentStoreConflictError(`Request hash is already bound to another payment.`);
      throwDbError("setRequestHash", error);
    }
    if (data) return;

    const existing = await this.requireRow(paymentId);
    if (existing.request_hash === requestHash) return;
    if (existing.request_hash) throw new PaymentStoreConflictError(`Payment ${paymentId} is bound to a different request hash.`);
    throw new PaymentStoreConflictError(`Payment ${paymentId} could not bind its request hash.`);
  }

  async getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined> {
    const row = await this.getRowByPaymentId(paymentId);
    return row?.request_hash ?? undefined;
  }

  async findByRequestHash(requestHash: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    const row = await this.getRowByRequestHash(requestHash);
    return row ? resultFor(row) : undefined;
  }

  async findByDisputeFields(escrowPaymentId: string, disputeReason: string, requestedOutcome: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    const { data, error } = await this.getClient().from("x402_payments").select("*").eq("escrow_payment_id", escrowPaymentId).eq("dispute_reason", disputeReason).eq("requested_outcome", requestedOutcome).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throwDbError("findByDisputeFields", error);
    return data ? resultFor(data as X402PaymentRow) : undefined;
  }

  private async getRowByPaymentId(paymentId: string): Promise<X402PaymentRow | undefined> {
    const { data, error } = await this.getClient().from("x402_payments").select("*").eq("payment_identifier", paymentId).maybeSingle();
    if (error) throwDbError("read payment", error);
    return data ? data as X402PaymentRow : undefined;
  }

  private async getRowByRequestHash(requestHash: string): Promise<X402PaymentRow | undefined> {
    const { data, error } = await this.getClient().from("x402_payments").select("*").eq("request_hash", requestHash).maybeSingle();
    if (error) throwDbError("read request hash", error);
    return data ? data as X402PaymentRow : undefined;
  }

  private async getConsumedTxRowByHash(txHash: string): Promise<ConsumedTxDbRow | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_consumed_transactions")
      .select("*")
      .ilike("transaction_hash", txHash)
      .maybeSingle();
    if (error) throwDbError("read consumed transaction hash", error);
    return data ? data as ConsumedTxDbRow : undefined;
  }

  private async getConsumedTxRowByPaymentId(paymentId: string): Promise<ConsumedTxDbRow | undefined> {
    const { data, error } = await this.getClient()
      .from("x402_consumed_transactions")
      .select("*")
      .eq("payment_identifier", paymentId)
      .maybeSingle();
    if (error) throwDbError("read consumed transaction payment", error);
    return data ? data as ConsumedTxDbRow : undefined;
  }

  private async requireRow(paymentId: string): Promise<X402PaymentRow> {
    const row = await this.getRowByPaymentId(paymentId);
    if (!row) throw new Error(`[SupabasePaymentStore] Payment ${paymentId} does not exist.`);
    return row;
  }
}

function statusForState(state: PaymentState): PaymentStatus {
  if (state === "paid_pending_brief") return "paid_pending_brief";
  if (state === "settled") return "settled";
  if (state === "failed") return "failed";
  return "pending";
}

function resultFor(row: X402PaymentRow) {
  return {
    paymentId: row.payment_identifier,
    status: statusForState(row.state),
    receipt: row.settlement_receipt ?? undefined,
    brief: row.brief ?? undefined,
  };
}

function dbRowToPaymentRecord(row: X402PaymentRow): PaymentRecord {
  const metadata: PaymentMetadata = {
    service: row.service_identifier,
    payerAddress: row.payer_address,
    payToAddress: row.pay_to_address,
    network: row.network,
    chainId: row.chain_id,
    tokenAddress: row.token_address,
    tokenSymbol: row.token_symbol === "USDC" ? "USDC" : "USDC",
    tokenDecimals: row.token_decimals,
    amountAtomic: row.amount_atomic,
    amountDisplay: row.amount_display,
    escrowPaymentId: row.escrow_payment_id ?? undefined,
    requestHash: row.request_hash ?? undefined,
    disputeReason: row.dispute_reason ?? undefined,
    requestedOutcome: row.requested_outcome ?? undefined,
    authorizationNonce: row.authorization_nonce ?? undefined,
    authorizationDeadline: row.authorization_deadline ?? undefined,
  };
  return {
    status: statusForState(row.state),
    state: row.state,
    receipt: row.settlement_receipt ?? undefined,
    brief: row.brief ?? undefined,
    error: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    metadata,
    requestHash: row.request_hash ?? undefined,
  };
}

let cachedStore: PaymentStore | undefined;

export function getPaymentStore(): PaymentStore {
  if (cachedStore) return cachedStore;
  cachedStore = isSupabaseConfigured() ? new SupabasePaymentStore() : new InMemoryPaymentStore();
  return cachedStore;
}
