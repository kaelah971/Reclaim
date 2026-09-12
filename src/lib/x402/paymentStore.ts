// ---------------------------------------------------------------------------
// x402 payment store — idempotency, durable metadata, and settlement claims
// ---------------------------------------------------------------------------

import type { SettlementReceipt } from "./types";
import type { DisputeBrief } from "./disputeBrief";

export type PaymentIdentifier = string;

/** Database lifecycle state. Provider settlement is allowed only after claim. */
export type PaymentState =
  | "pending"
  | "authorization_verified"
  | "settlement_submitted"
  | "paid_pending_brief"
  | "settled"
  | "failed";

/** Public compatibility status. Intermediate authorization states are pending. */
export type PaymentStatus = "pending" | "settled" | "failed" | "paid_pending_brief";

/** Complete server-owned payment terms persisted at pending creation. */
export interface PaymentMetadata {
  service: string;
  payerAddress: string;
  payToAddress: string;
  network: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: "USDC";
  tokenDecimals: number;
  amountAtomic: string;
  amountDisplay: string;
  /** Escrow identifier, never the x402 payment UUID. */
  escrowPaymentId?: string;
  requestHash?: string;
  disputeReason?: string;
  requestedOutcome?: string;
  authorizationNonce?: string;
  authorizationDeadline?: string;
}

export interface PaymentRecord {
  status: PaymentStatus;
  state: PaymentState;
  receipt?: SettlementReceipt;
  brief?: DisputeBrief;
  error?: string;
  createdAt: number;
  metadata?: PaymentMetadata;
  requestHash?: string;
}

export interface ConsumedTxRecord {
  txHash: string;
  paymentId: PaymentIdentifier;
  consumedAt: number;
  legacyRecovery?: boolean;
  recoveredPayer?: string;
  recoveredRequestHash?: string;
}

export interface PaymentCreateResult {
  created: boolean;
  paymentId: PaymentIdentifier;
  record: PaymentRecord;
}

export interface SettlementClaim {
  claimed: boolean;
  state: PaymentState;
  receipt?: SettlementReceipt;
  brief?: DisputeBrief;
}

export class PaymentStoreConflictError extends Error {
  readonly code = "PAYMENT_STORE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "PaymentStoreConflictError";
  }
}

export interface PaymentStore {
  createPaymentId(): PaymentIdentifier;
  recordPending(
    paymentId: PaymentIdentifier,
    metadata?: PaymentMetadata,
  ): Promise<PaymentCreateResult>;
  recordAuthorizationVerified(paymentId: PaymentIdentifier): Promise<void>;
  claimSettlement(
    paymentId: PaymentIdentifier,
    requestHash?: string,
  ): Promise<SettlementClaim>;
  getState(paymentId: PaymentIdentifier): Promise<PaymentState | undefined>;
  recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): Promise<void>;
  recordFailed(paymentId: PaymentIdentifier, error: string): Promise<void>;
  /** Mark a previously claimed settlement as failed without allowing a
   * verification race to regress an in-flight settlement. */
  recordSettlementFailed(paymentId: PaymentIdentifier, error: string): Promise<void>;
  getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined>;
  getResult(paymentId: PaymentIdentifier): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined>;
  getError(paymentId: PaymentIdentifier): Promise<string | undefined>;
  recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): Promise<void>;
  recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void>;
  getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>>;
  findByTxHash(txHash: string): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined>;
  isTxHashConsumed(txHash: string): Promise<boolean>;
  consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): Promise<void>;
  findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined>;
  setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void>;
  getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined>;
  findByRequestHash(requestHash: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined>;
  findByDisputeFields(escrowPaymentId: string, disputeReason: string, requestedOutcome: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined>;
}

const store = new Map<PaymentIdentifier, PaymentRecord>();
const consumedTxs = new Map<string, ConsumedTxRecord>();
const requestHashStore = new Map<PaymentIdentifier, string>();
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Clear process-local state between isolated test cases. Production callers
 * should use the Supabase-backed store when state must survive a restart.
 */
export function resetInMemoryPaymentStore(): void {
  store.clear();
  consumedTxs.clear();
  requestHashStore.clear();
}

const ESCROW_SCOPED_SERVICES = new Set([
  "reclaim-dispute-brief-v1",
  "evidence-quality-check",
  "case-refresh",
]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function assertNumericEscrowPaymentId(service: string, paymentId: string | undefined): void {
  if (!ESCROW_SCOPED_SERVICES.has(service)) return;
  if (!paymentId || !/^[0-9]+$/.test(paymentId)) {
    throw new PaymentStoreConflictError(
      `A numeric escrow payment ID is required for ${service}; x402 payment identifiers are not escrow IDs.`,
    );
  }
}

export function assertPaymentMetadataPersistable(metadata: PaymentMetadata): void {
  if (!metadata.service) throw new Error("x402 payment service is required.");
  assertNumericEscrowPaymentId(metadata.service, metadata.escrowPaymentId);
  if (!ADDRESS_RE.test(metadata.payerAddress) || !ADDRESS_RE.test(metadata.payToAddress)) {
    throw new Error("x402 payment metadata contains an invalid address.");
  }
  if (!/^eip155:[0-9]+$/.test(metadata.network)) {
    throw new Error("x402 payment metadata contains an invalid network.");
  }
  if (!Number.isInteger(metadata.chainId) || metadata.chainId <= 0) {
    throw new Error("x402 payment metadata contains an invalid chain ID.");
  }
  if (metadata.network !== `eip155:${metadata.chainId}`) {
    throw new Error("x402 payment network and chain ID do not match.");
  }
  if (!ADDRESS_RE.test(metadata.tokenAddress)) {
    throw new Error("x402 payment metadata contains an invalid token address.");
  }
  if (metadata.tokenSymbol !== "USDC" || metadata.tokenDecimals !== 6) {
    throw new Error("x402 payment metadata must describe USDC with 6 decimals.");
  }
  if (!/^[0-9]+$/.test(metadata.amountAtomic) || BigInt(metadata.amountAtomic) <= 0n) {
    throw new Error("x402 payment metadata contains an invalid atomic amount.");
  }
  if (!metadata.amountDisplay) throw new Error("x402 payment display amount is required.");
}

/**
 * Payment terms and request identity are immutable once a payment row exists.
 * A retry must therefore either describe the exact same payment or be rejected;
 * it must never silently reuse an identifier for a different payer, asset, or
 * charge.
 */
export function assertPaymentMetadataMatches(
  existing: PaymentMetadata,
  incoming: PaymentMetadata,
): void {
  const fields: Array<keyof PaymentMetadata> = [
    "service",
    "payerAddress",
    "payToAddress",
    "network",
    "chainId",
    "tokenAddress",
    "tokenSymbol",
    "tokenDecimals",
    "amountAtomic",
    "amountDisplay",
    "escrowPaymentId",
    "requestHash",
    "disputeReason",
    "requestedOutcome",
    "authorizationNonce",
    "authorizationDeadline",
  ];

  for (const field of fields) {
    const left = existing[field];
    const right = incoming[field];
    const equal = typeof left === "string" && typeof right === "string"
      ? left.toLowerCase() === right.toLowerCase() &&
        (field === "payerAddress" || field === "payToAddress" || field === "tokenAddress" || field === "requestHash"
          ? true
          : left === right)
      : left === right;
    if (!equal) {
      throw new PaymentStoreConflictError(
        `Payment metadata field '${field}' does not match the existing payment.`,
      );
    }
  }
}

/** Reject incomplete/reverted receipts before either store can persist them. */
export function assertSettlementReceiptPersistable(receipt: SettlementReceipt): void {
  if (receipt.status !== "success") {
    throw new Error("Only successful settlement receipts may be persisted.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.txHash)) {
    throw new Error("Settlement receipt is incomplete: transaction hash is missing or invalid.");
  }
  if (!ADDRESS_RE.test(receipt.from) || !ADDRESS_RE.test(receipt.to)) {
    throw new Error("Settlement receipt contains an invalid address.");
  }
  if (!ADDRESS_RE.test(receipt.tokenAddress)) {
    throw new Error("Settlement receipt contains an invalid token address.");
  }
  if (!/^[0-9]+$/.test(receipt.amount) || BigInt(receipt.amount) <= 0n) {
    throw new Error("Settlement receipt contains an invalid amount.");
  }
  if (receipt.blockNumber < 0n) {
    throw new Error("Settlement receipt contains an invalid block number.");
  }
}

/** A successful receipt must prove the immutable terms stored for its payment. */
export function assertSettlementReceiptMatchesMetadata(
  metadata: PaymentMetadata,
  receipt: SettlementReceipt,
): void {
  if (
    metadata.payerAddress.toLowerCase() !== receipt.from.toLowerCase() ||
    metadata.payToAddress.toLowerCase() !== receipt.to.toLowerCase() ||
    metadata.tokenAddress.toLowerCase() !== receipt.tokenAddress.toLowerCase() ||
    metadata.amountAtomic !== receipt.amount
  ) {
    throw new PaymentStoreConflictError(
      "Settlement receipt does not match the payment's immutable terms.",
    );
  }
}

function resultFor(record: PaymentRecord, paymentId: PaymentIdentifier) {
  return {
    paymentId,
    status: record.status,
    receipt: record.receipt,
    brief: record.brief,
  };
}

export class InMemoryPaymentStore implements PaymentStore {
  createPaymentId(): PaymentIdentifier {
    return `pay_${crypto.randomUUID()}`;
  }

  async recordPending(paymentId: PaymentIdentifier, metadata?: PaymentMetadata): Promise<PaymentCreateResult> {
    pruneExpired();
    if (metadata) assertPaymentMetadataPersistable(metadata);

    const existingForId = store.get(paymentId);
    if (existingForId) {
      if (metadata) {
        if (existingForId.metadata) {
          assertPaymentMetadataMatches(existingForId.metadata, metadata);
        } else if (existingForId.requestHash !== metadata.requestHash) {
          throw new PaymentStoreConflictError(`Payment ${paymentId} is already bound to a different request hash.`);
        }
      }
      return { created: false, paymentId, record: existingForId };
    }

    const requestHash = metadata?.requestHash;
    if (requestHash) {
      const existingForHash = this.findRecordByRequestHash(requestHash);
      if (existingForHash) {
        if (!existingForHash.record.metadata) {
          throw new PaymentStoreConflictError(
            `Request hash is already bound to payment ${existingForHash.paymentId}, but its server-owned metadata is unavailable for comparison.`,
          );
        }
        assertPaymentMetadataMatches(existingForHash.record.metadata, metadata!);
        return {
          created: false,
          paymentId: existingForHash.paymentId,
          record: existingForHash.record,
        };
      }
    }

    const record: PaymentRecord = {
      status: "pending",
      state: "pending",
      createdAt: Date.now(),
      // Keep the server-owned snapshot independent of the caller's mutable
      // object. The stored terms must not be alterable after creation.
      metadata: metadata ? { ...metadata } : undefined,
      requestHash,
    };
    store.set(paymentId, record);
    if (requestHash) requestHashStore.set(paymentId, requestHash);
    return { created: true, paymentId, record };
  }

  async recordAuthorizationVerified(paymentId: PaymentIdentifier): Promise<void> {
    const record = requireRecord(paymentId);
    if (record.state === "pending") {
      record.state = "authorization_verified";
      record.status = "pending";
      return;
    }
    if (record.state === "authorization_verified" || record.state === "settlement_submitted") return;
    if (record.state === "paid_pending_brief" || record.state === "settled") return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} cannot be authorization-verified from ${record.state}.`);
  }

  async claimSettlement(paymentId: PaymentIdentifier, requestHash?: string): Promise<SettlementClaim> {
    const record = requireRecord(paymentId);
    if (requestHash && record.requestHash !== requestHash) {
      throw new PaymentStoreConflictError(`Payment ${paymentId} is bound to a different request hash.`);
    }
    // This synchronous check-and-set is one critical section on the JS event
    // loop, so concurrent callers cannot both claim the provider call.
    if (record.state === "pending" || record.state === "authorization_verified") {
      record.state = "settlement_submitted";
      record.status = "pending";
      return { claimed: true, state: record.state };
    }
    return {
      claimed: false,
      state: record.state,
      receipt: record.receipt,
      brief: record.brief,
    };
  }

  async getState(paymentId: PaymentIdentifier): Promise<PaymentState | undefined> {
    pruneExpired();
    return store.get(paymentId)?.state;
  }

  async recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): Promise<void> {
    await this.recordSettlementReceipt(paymentId, receipt);
    await this.recordBrief(paymentId, brief);
  }

  async recordFailed(paymentId: PaymentIdentifier, error: string): Promise<void> {
    const record = store.get(paymentId);
    if (!record) {
      store.set(paymentId, {
        status: "failed",
        state: "failed",
        error,
        createdAt: Date.now(),
      });
      return;
    }
    // A verification failure racing with a claimed settlement must not regress
    // an in-flight payment to failed: another request may already be sending
    // funds. Settlement failures use recordSettlementFailed instead.
    if (record.state === "settlement_submitted" || record.state === "paid_pending_brief" || record.state === "settled") return;
    record.state = "failed";
    record.status = "failed";
    record.error = error;
  }

  async recordSettlementFailed(paymentId: PaymentIdentifier, error: string): Promise<void> {
    const record = requireRecord(paymentId);
    if (record.state === "failed" || record.state === "paid_pending_brief" || record.state === "settled") return;
    if (record.state !== "settlement_submitted") {
      throw new PaymentStoreConflictError(
        `Payment ${paymentId} cannot be marked settlement-failed from ${record.state}.`,
      );
    }
    record.state = "failed";
    record.status = "failed";
    record.error = error;
  }

  async getStatus(paymentId: PaymentIdentifier): Promise<PaymentStatus | undefined> {
    pruneExpired();
    return store.get(paymentId)?.status;
  }

  async getResult(paymentId: PaymentIdentifier): Promise<{ receipt: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    pruneExpired();
    const record = store.get(paymentId);
    if ((record?.state === "paid_pending_brief" || record?.state === "settled") && record.receipt) {
      return { receipt: record.receipt, brief: record.brief };
    }
    return undefined;
  }

  async getError(paymentId: PaymentIdentifier): Promise<string | undefined> {
    pruneExpired();
    const record = store.get(paymentId);
    return record?.state === "failed" ? record.error : undefined;
  }

  async recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): Promise<void> {
    persistSettlementReceiptInMemory(paymentId, receipt);
  }

  async recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): Promise<void> {
    const record = store.get(paymentId);
    if (!record || !record.receipt) return;
    if (record.state === "settled") return; // terminal: never overwrite a delivered result
    if (record.state !== "paid_pending_brief") {
      throw new PaymentStoreConflictError(`Payment ${paymentId} cannot record a brief from ${record.state}.`);
    }
    record.brief = brief;
    record.state = "settled";
    record.status = "settled";
  }

  async getAllEntries(): Promise<ReadonlyMap<PaymentIdentifier, PaymentRecord>> {
    pruneExpired();
    return store;
  }

  async findByTxHash(txHash: string): Promise<{ paymentId: PaymentIdentifier; record: PaymentRecord } | undefined> {
    pruneExpired();
    for (const [paymentId, record] of store) {
      if (record.receipt?.txHash?.toLowerCase() === txHash.toLowerCase()) return { paymentId, record };
    }
    return undefined;
  }

  async isTxHashConsumed(txHash: string): Promise<boolean> {
    return consumedTxs.has(txHash.toLowerCase());
  }

  async consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): Promise<void> {
    const key = txHash.toLowerCase();
    const existing = consumedTxs.get(key);
    if (existing) {
      if (existing.paymentId !== paymentId) {
        throw new PaymentStoreConflictError(
          `Transaction ${txHash} is already consumed for payment ${existing.paymentId}.`,
        );
      }
      return;
    }
    consumedTxs.set(key, { txHash, paymentId, consumedAt: Date.now(), ...metadata });
  }

  async findConsumedTx(txHash: string): Promise<ConsumedTxRecord | undefined> {
    return consumedTxs.get(txHash.toLowerCase());
  }

  async setRequestHash(paymentId: PaymentIdentifier, requestHash: string): Promise<void> {
    // Legacy callers bind the hash after creating only an identifier. Keep
    // that API compatible by creating a minimal pending record; production
    // routes bind the hash atomically as part of recordPending(metadata).
    const record = store.get(paymentId) ?? {
      status: "pending" as const,
      state: "pending" as const,
      createdAt: Date.now(),
    };
    store.set(paymentId, record);
    if (record.requestHash) {
      if (record.requestHash !== requestHash) {
        throw new PaymentStoreConflictError(`Payment ${paymentId} is bound to a different request hash.`);
      }
      return;
    }
    const existing = this.findRecordByRequestHash(requestHash);
    if (existing && existing.paymentId !== paymentId) {
      throw new PaymentStoreConflictError(
        `Request hash is already bound to payment ${existing.paymentId}.`,
      );
    }
    record.requestHash = requestHash;
    if (record.metadata) record.metadata.requestHash = requestHash;
    requestHashStore.set(paymentId, requestHash);
  }

  async getRequestHash(paymentId: PaymentIdentifier): Promise<string | undefined> {
    return store.get(paymentId)?.requestHash ?? requestHashStore.get(paymentId);
  }

  async findByRequestHash(requestHash: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    pruneExpired();
    const found = this.findRecordByRequestHash(requestHash);
    return found ? resultFor(found.record, found.paymentId) : undefined;
  }

  async findByDisputeFields(escrowPaymentId: string, disputeReason: string, requestedOutcome: string): Promise<{ paymentId: PaymentIdentifier; status: PaymentStatus; receipt?: SettlementReceipt; brief?: DisputeBrief } | undefined> {
    pruneExpired();
    for (const [paymentId, record] of store) {
      const metadata = record.metadata;
      if (metadata?.escrowPaymentId === escrowPaymentId && metadata.disputeReason === disputeReason && metadata.requestedOutcome === requestedOutcome) {
        return resultFor(record, paymentId);
      }
    }
    return undefined;
  }

  private findRecordByRequestHash(requestHash: string): { paymentId: string; record: PaymentRecord } | undefined {
    for (const [paymentId, record] of store) {
      if (record.requestHash === requestHash || requestHashStore.get(paymentId) === requestHash) return { paymentId, record };
    }
    return undefined;
  }

}

function requireRecord(paymentId: string): PaymentRecord {
  const record = store.get(paymentId);
  if (!record) throw new PaymentStoreConflictError(`Payment ${paymentId} does not exist.`);
  return record;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now - record.createdAt > MAX_AGE_MS) {
      store.delete(key);
      requestHashStore.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy synchronous exports. New routes use getPaymentStore().
// ---------------------------------------------------------------------------

const legacyStore = new InMemoryPaymentStore();

export function createPaymentId(): PaymentIdentifier { return legacyStore.createPaymentId(); }
export function recordPending(paymentId: PaymentIdentifier): void { void legacyStore.recordPending(paymentId); }
export function recordSettled(paymentId: PaymentIdentifier, receipt: SettlementReceipt, brief: DisputeBrief): void {
  // Keep the historical synchronous API synchronous while retaining the same
  // validation and no-overwrite guarantees as the async store methods.
  persistSettlementReceiptInMemory(paymentId, receipt);
  const record = store.get(paymentId)!;
  if (record.state !== "settled") {
    record.brief = record.brief ?? brief;
    record.state = "settled";
    record.status = "settled";
  }
}
export function recordFailed(paymentId: PaymentIdentifier, error: string): void { void legacyStore.recordFailed(paymentId, error); }
export function getStatus(paymentId: PaymentIdentifier): PaymentStatus | undefined { return store.get(paymentId)?.status; }
export function getResult(paymentId: PaymentIdentifier): { receipt: SettlementReceipt; brief?: DisputeBrief } | undefined {
  const record = store.get(paymentId);
  return record && (record.state === "paid_pending_brief" || record.state === "settled") && record.receipt
    ? { receipt: record.receipt, brief: record.brief }
    : undefined;
}
export function getError(paymentId: PaymentIdentifier): string | undefined {
  const record = store.get(paymentId);
  return record?.state === "failed" ? record.error : undefined;
}
export function recordSettlementReceipt(paymentId: PaymentIdentifier, receipt: SettlementReceipt): void {
  persistSettlementReceiptInMemory(paymentId, receipt);
}
export function recordBrief(paymentId: PaymentIdentifier, brief: DisputeBrief): void { void legacyStore.recordBrief(paymentId, brief); }
export function getAllEntries(): ReadonlyMap<PaymentIdentifier, PaymentRecord> { return store; }
export function findByTxHash(txHash: string): { paymentId: PaymentIdentifier; record: PaymentRecord } | undefined {
  for (const [paymentId, record] of store) if (record.receipt?.txHash?.toLowerCase() === txHash.toLowerCase()) return { paymentId, record };
  return undefined;
}
export function isTxHashConsumed(txHash: string): boolean { return consumedTxs.has(txHash.toLowerCase()); }
export function consumeTxHash(txHash: string, paymentId: PaymentIdentifier, metadata?: Partial<ConsumedTxRecord>): void {
  const key = txHash.toLowerCase();
  const existing = consumedTxs.get(key);
  if (existing) {
    if (existing.paymentId !== paymentId) {
      throw new PaymentStoreConflictError(
        `Transaction ${txHash} is already consumed for payment ${existing.paymentId}.`,
      );
    }
    return;
  }
  consumedTxs.set(key, { txHash, paymentId, consumedAt: Date.now(), ...metadata });
}
export function findConsumedTx(txHash: string): ConsumedTxRecord | undefined { return consumedTxs.get(txHash.toLowerCase()); }
export function setRequestHash(paymentId: PaymentIdentifier, requestHash: string): void {
  const record = store.get(paymentId) ?? {
    status: "pending" as const,
    state: "pending" as const,
    createdAt: Date.now(),
  };
  store.set(paymentId, record);
  if (record.requestHash) {
    if (record.requestHash !== requestHash) {
      throw new PaymentStoreConflictError(`Payment ${paymentId} is bound to a different request hash.`);
    }
    return;
  }
  const owner = [...store.entries()].find(([, entry]) => entry.requestHash === requestHash);
  if (owner && owner[0] !== paymentId) {
    throw new PaymentStoreConflictError(`Request hash is already bound to payment ${owner[0]}.`);
  }
  record.requestHash = requestHash;
  requestHashStore.set(paymentId, requestHash);
}
export function getRequestHash(paymentId: PaymentIdentifier): string | undefined { return store.get(paymentId)?.requestHash ?? requestHashStore.get(paymentId); }

function persistSettlementReceiptInMemory(paymentId: PaymentIdentifier, receipt: SettlementReceipt): void {
  assertSettlementReceiptPersistable(receipt);
  const existing = store.get(paymentId);
  if (existing?.receipt) {
    if (existing.receipt.txHash.toLowerCase() === receipt.txHash.toLowerCase()) return;
    throw new PaymentStoreConflictError(`Payment ${paymentId} already has a different settlement receipt.`);
  }
  if (existing?.state === "failed") {
    throw new PaymentStoreConflictError(`Payment ${paymentId} is failed and cannot receive a settlement receipt.`);
  }
  if (existing?.metadata) assertSettlementReceiptMatchesMetadata(existing.metadata, receipt);

  const existingByTx = findByTxHashInMemory(receipt.txHash);
  if (existingByTx && existingByTx.paymentId !== paymentId) {
    throw new PaymentStoreConflictError(
      `Settlement transaction ${receipt.txHash} is already bound to another payment.`,
    );
  }

  const record: PaymentRecord = existing ?? {
    status: "paid_pending_brief",
    state: "paid_pending_brief",
    createdAt: Date.now(),
  };
  record.state = "paid_pending_brief";
  record.status = "paid_pending_brief";
  record.receipt = receipt;
  store.set(paymentId, record);
}

function findByTxHashInMemory(txHash: string): { paymentId: string; record: PaymentRecord } | undefined {
  const normalized = txHash.toLowerCase();
  for (const [paymentId, record] of store) {
    if (record.receipt?.txHash?.toLowerCase() === normalized) return { paymentId, record };
  }
  return undefined;
}
