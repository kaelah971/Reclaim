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

const client = () => getSupabaseClient();

export async function createDraftDecision(input: CreateDecisionInput): Promise<ReviewerDecisionRecord | null> {
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
      onchain_payment_id: input.onchain_payment_id || null,
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
): Promise<ReviewerDecisionRecord | null> {
  const now = new Date().toISOString();
  const { data, error } = await client()
    .from("reviewer_decisions")
    .update({
      decision_status: "ready_for_execution",
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
