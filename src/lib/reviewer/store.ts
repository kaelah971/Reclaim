// ---------------------------------------------------------------------------
// I6A: Reviewer decision store — Supabase persistence layer
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase/client";

export type DecisionValue =
  | "release_to_worker"
  | "refund_to_client"
  | "partial_resolution"
  | "needs_more_evidence";

export type DecisionStatus = "draft" | "submitted" | "ready_for_execution" | "superseded";

export interface ReviewerDecisionRecord {
  id: string;
  payment_identifier: string;
  dispute_identifier: string | null;
  reviewer_address: string;
  reviewer_auth_method: string;
  decision: DecisionValue;
  rationale: string;
  evidence_notes: string | null;
  conditions: string | null;
  client_amount: string | null;
  worker_amount: string | null;
  decision_status: DecisionStatus;
  source_brief_version: string | null;
  source_request_hash: string | null;
  onchain_payment_id: string | null;
  chain_id: number | null;
  contract_address: string | null;
  onchain_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  finalized_at: string | null;
}

export interface CreateDecisionInput {
  payment_identifier: string;
  dispute_identifier?: string;
  reviewer_address: string;
  decision: DecisionValue;
  rationale: string;
  evidence_notes?: string;
  conditions?: string;
  client_amount?: string;
  worker_amount?: string;
  source_brief_version?: string;
  source_request_hash?: string;
  onchain_payment_id?: string;
  chain_id?: number;
  contract_address?: string;
  onchain_snapshot?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Escrow identity binding
//
// `payment_identifier` is an x402 service UUID. It is intentionally kept
// separate from `escrowPaymentId`, which is the uint256 ID allocated by the
// escrow contract. Never use the former as an on-chain identifier.
// ---------------------------------------------------------------------------

export interface ReviewerOnchainBinding {
  chainId: number;
  contractAddress: string;
  escrowPaymentId: string;
  client: string;
  worker: string;
  amount: string;
  token: string;
  state: string;
}

export type ReviewerOnchainSnapshot = Omit<ReviewerOnchainBinding, "escrowPaymentId"> & {
  id: string;
  verifiedAt: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Normalize a contract uint256 represented by a database value.
 *
 * Leading zeroes are harmless and normalized, but signs, decimals, UUIDs,
 * `pay_*` identifiers, and scientific notation are rejected.
 */
export function normalizeEscrowPaymentId(value: unknown): string | null {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  try {
    return BigInt(normalized).toString();
  } catch {
    return null;
  }
}

function normalizeUnsignedDecimal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!UNSIGNED_DECIMAL_PATTERN.test(normalized)) return null;

  try {
    return BigInt(normalized).toString();
  } catch {
    return null;
  }
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

function addMismatch(mismatches: string[], field: string): void {
  if (!mismatches.includes(field)) mismatches.push(field);
}

/** Validate the shape of the live binding before it is persisted. */
export function validateReviewerOnchainBinding(binding: ReviewerOnchainBinding): string[] {
  const mismatches: string[] = [];

  if (normalizeEscrowPaymentId(binding.escrowPaymentId) === null) {
    addMismatch(mismatches, "escrow_payment_id");
  }
  if (!Number.isSafeInteger(binding.chainId) || binding.chainId <= 0) {
    addMismatch(mismatches, "chain_id");
  }
  if (!normalizeAddress(binding.contractAddress)) {
    addMismatch(mismatches, "contract_address");
  }
  if (!normalizeAddress(binding.client)) addMismatch(mismatches, "client");
  if (!normalizeAddress(binding.worker)) addMismatch(mismatches, "worker");
  if (normalizeUnsignedDecimal(binding.amount) === null) addMismatch(mismatches, "amount");
  if (!normalizeAddress(binding.token)) addMismatch(mismatches, "token");
  if (binding.state !== "Disputed") addMismatch(mismatches, "state");

  return mismatches;
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * Compare a decision's persisted binding with a fresh live escrow binding.
 *
 * An entirely unbound draft is allowed because submit binds it atomically.
 * Once any binding field or snapshot exists, the binding must be complete and
 * every persisted field must agree with the live chain data.
 */
export function getReviewerBindingMismatches(
  decision: Pick<ReviewerDecisionRecord, "onchain_payment_id" | "chain_id" | "contract_address" | "onchain_snapshot"> | Record<string, unknown>,
  expected: ReviewerOnchainBinding,
  options: { requireComplete?: boolean } = {},
): string[] {
  const mismatches = validateReviewerOnchainBinding(expected);
  const hasAnyPersistedBinding =
    decision.onchain_payment_id != null ||
    decision.chain_id != null ||
    decision.contract_address != null ||
    decision.onchain_snapshot != null;
  const requireComplete = options.requireComplete === true || hasAnyPersistedBinding;

  if (decision.onchain_payment_id == null) {
    if (requireComplete) addMismatch(mismatches, "escrow_payment_id is missing");
  } else if (normalizeEscrowPaymentId(decision.onchain_payment_id) !== normalizeEscrowPaymentId(expected.escrowPaymentId)) {
    addMismatch(mismatches, "escrow_payment_id");
  }

  if (decision.chain_id == null) {
    if (requireComplete) addMismatch(mismatches, "chain_id is missing");
  } else if (decision.chain_id !== expected.chainId) {
    addMismatch(mismatches, "chain_id");
  }

  if (decision.contract_address == null) {
    if (requireComplete) addMismatch(mismatches, "contract_address is missing");
  } else if (normalizeAddress(decision.contract_address) !== normalizeAddress(expected.contractAddress)) {
    addMismatch(mismatches, "contract_address");
  }

  const snapshot = snapshotRecord(decision.onchain_snapshot);
  if (!snapshot) {
    if (requireComplete) addMismatch(mismatches, "onchain_snapshot is missing");
    return mismatches;
  }

  const snapshotFields: Array<[string, unknown, unknown]> = [
    ["escrow_payment_id", snapshot.id, expected.escrowPaymentId],
    ["chain_id", snapshot.chainId, expected.chainId],
    ["contract_address", snapshot.contractAddress, expected.contractAddress],
    ["client", snapshot.client, expected.client],
    ["worker", snapshot.worker, expected.worker],
    ["amount", snapshot.amount, expected.amount],
    ["token", snapshot.token, expected.token],
    ["state", snapshot.state, expected.state],
  ];

  for (const [field, actual, wanted] of snapshotFields) {
    if (actual == null) {
      if (requireComplete) addMismatch(mismatches, `onchain_snapshot.${field} is missing`);
      continue;
    }

    const equal = field === "escrow_payment_id"
      ? normalizeEscrowPaymentId(actual) === normalizeEscrowPaymentId(wanted)
      : field === "chain_id"
        ? actual === wanted
        : field === "amount"
          ? normalizeUnsignedDecimal(actual) === normalizeUnsignedDecimal(wanted)
          : ["contract_address", "client", "worker", "token"].includes(field)
            ? normalizeAddress(actual) === normalizeAddress(wanted)
            : actual === wanted;

    if (!equal) addMismatch(mismatches, field === "escrow_payment_id" ? "escrow_payment_id" : field);
  }

  return mismatches;
}

export function createReviewerOnchainSnapshot(
  binding: ReviewerOnchainBinding,
  verifiedAt = new Date().toISOString(),
): ReviewerOnchainSnapshot {
  return {
    id: normalizeEscrowPaymentId(binding.escrowPaymentId) as string,
    chainId: binding.chainId,
    contractAddress: binding.contractAddress,
    client: binding.client,
    worker: binding.worker,
    amount: binding.amount,
    token: binding.token,
    state: binding.state,
    verifiedAt,
  };
}

const client = () => getSupabaseClient();

export async function createDraftDecision(input: CreateDecisionInput): Promise<ReviewerDecisionRecord | null> {
  const onchainPaymentId = input.onchain_payment_id == null
    ? null
    : normalizeEscrowPaymentId(input.onchain_payment_id);
  if (input.onchain_payment_id != null && onchainPaymentId === null) {
    console.error("[reviewer/store] createDraftDecision rejected a nonnumeric escrow payment ID");
    return null;
  }

  const { data, error } = await client()
    .from("reviewer_decisions")
    .insert({
      payment_identifier: input.payment_identifier,
      dispute_identifier: input.dispute_identifier || null,
      reviewer_address: input.reviewer_address,
      reviewer_auth_method: "wallet_signature",
      decision: input.decision,
      rationale: input.rationale,
      evidence_notes: input.evidence_notes || null,
      conditions: input.conditions || null,
      client_amount: input.client_amount || null,
      worker_amount: input.worker_amount || null,
      decision_status: "draft",
      source_brief_version: input.source_brief_version || null,
      source_request_hash: input.source_request_hash || null,
      onchain_payment_id: onchainPaymentId,
      chain_id: input.chain_id || null,
      contract_address: input.contract_address || null,
      onchain_snapshot: input.onchain_snapshot || null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[reviewer/store] createDraftDecision failed:", error.message);
    return null;
  }
  return data as ReviewerDecisionRecord;
}

export async function submitDecision(
  decisionId: string,
  reviewerAddress: string,
  binding: ReviewerOnchainBinding,
): Promise<ReviewerDecisionRecord | null> {
  if (!binding || validateReviewerOnchainBinding(binding).length > 0) {
    console.error("[reviewer/store] submitDecision rejected an invalid escrow binding");
    return null;
  }

  const now = new Date().toISOString();
  const { data, error } = await client()
    .from("reviewer_decisions")
    .update({
      decision_status: "ready_for_execution",
      onchain_payment_id: normalizeEscrowPaymentId(binding.escrowPaymentId),
      chain_id: binding.chainId,
      contract_address: binding.contractAddress,
      onchain_snapshot: createReviewerOnchainSnapshot(binding, now),
      submitted_at: now,
      finalized_at: now,
      updated_at: now,
    })
    .eq("id", decisionId)
    .eq("reviewer_address", reviewerAddress)
    .eq("decision_status", "draft")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[reviewer/store] submitDecision failed:", error.message);
    return null;
  }
  return data as ReviewerDecisionRecord;
}

export async function supersedeDecision(
  decisionId: string,
  reviewerAddress: string,
  newDecision: CreateDecisionInput,
): Promise<ReviewerDecisionRecord | null> {
  // Mark old as superseded
  await client()
    .from("reviewer_decisions")
    .update({ decision_status: "superseded", updated_at: new Date().toISOString() })
    .eq("id", decisionId)
    .eq("reviewer_address", reviewerAddress)
    .in("decision_status", ["submitted", "ready_for_execution"]);

  // Create new
  return createDraftDecision(newDecision);
}

export async function getDecision(
  decisionId: string,
): Promise<ReviewerDecisionRecord | null> {
  const { data, error } = await client()
    .from("reviewer_decisions")
    .select("*")
    .eq("id", decisionId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ReviewerDecisionRecord;
}

export async function getDecisionsForPayment(
  paymentIdentifier: string,
): Promise<ReviewerDecisionRecord[]> {
  const { data, error } = await client()
    .from("reviewer_decisions")
    .select("*")
    .eq("payment_identifier", paymentIdentifier)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as ReviewerDecisionRecord[];
}

export async function getReviewablePayments(): Promise<string[]> {
  // Get payments that are in a disputable state and have an AI brief
  const { data, error } = await client()
    .from("x402_payments")
    .select("payment_identifier")
    .in("state", ["paid_pending_brief", "settled"])
    .not("brief", "is", null)
    .not("escrow_payment_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];
  return (data as Array<{ payment_identifier: string }>).map((r) => r.payment_identifier);
}

export async function updateDraftDecision(
  decisionId: string,
  reviewerAddress: string,
  updates: Partial<Pick<CreateDecisionInput, "decision" | "rationale" | "evidence_notes" | "conditions" | "client_amount" | "worker_amount">>,
): Promise<ReviewerDecisionRecord | null> {
  const { data, error } = await client()
    .from("reviewer_decisions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", decisionId)
    .eq("reviewer_address", reviewerAddress)
    .eq("decision_status", "draft")
    .select("*")
    .maybeSingle();

  if (error || !data) return null;
  return data as ReviewerDecisionRecord;
}
