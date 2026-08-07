// ---------------------------------------------------------------------------
// Resolution Agent Store — row types matching the SQL schema
// ---------------------------------------------------------------------------

export interface ResolutionAgentRow {
  id: string;
  agent_id: string;
  escrow_chain_id: string;
  escrow_contract_address: string;
  escrow_payment_id: string;
  goal: string;
  status: string;
  case_wallet_address: string;
  encrypted_wallet_secret: Record<string, unknown> | null;
  funder_address: string;
  allowed_tools: string[];
  approved_budget_atomic: number; // PostgreSQL BIGINT comes as number
  spent_budget_atomic: number;
  reserved_budget_atomic: number;
  current_plan: Record<string, unknown> | null;
  observations: Record<string, unknown> | null;
  evidence_version_hash: string | null;
  case_version_hash: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  funded_at: string | null;
  activated_at: string | null;
  paused_at: string | null;
  closed_at: string | null;
  version: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  current_running_tool_id: string | null;
}

export interface AgentEventRow {
  id: string;
  agent_id: string;
  event_type: string;
  reason: string;
  previous_status: string | null;
  next_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ToolExecutionRow {
  id: string;
  agent_id: string;
  tool_identifier: string;
  request_hash: string;
  case_version_hash: string | null;
  evidence_version_hash: string | null;
  state: string;
  price_atomic: number;
  network: string;
  asset_address: string;
  pay_to_address: string;
  payment_reference: string | null;
  settlement_tx_hash: string | null;
  result_reference: string | null;
  result_data: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRequestRow {
  id: string;
  agent_id: string;
  responsible_party: string;
  evidence_item: string;
  reason: string;
  status: string;
  created_case_version_hash: string | null;
  evidence_version_hash: string | null;
  fulfilled_case_version_hash: string | null;
  created_at: string;
  fulfilled_at: string | null;
  cancelled_at: string | null;
}
