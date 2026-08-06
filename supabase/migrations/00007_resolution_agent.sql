-- ============================================================================
-- 00007: Resolution Agent store — agents, events, tool executions, evidence
-- ============================================================================

-- ============================================================================
-- Enum: resolution_agent_status — canonical agent lifecycle states
-- ============================================================================

CREATE TYPE resolution_agent_status AS ENUM (
  'draft',
  'awaiting_funding',
  'funded',
  'awaiting_activation',
  'active',
  'running_tool',
  'waiting_for_evidence',
  'waiting_for_human_approval',
  'ready_for_human_review',
  'budget_exhausted',
  'expired',
  'paused',
  'closing',
  'closed',
  'failed_recoverable'
);

-- ============================================================================
-- Table: resolution_agents — main agent record
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolution_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_chain_id TEXT NOT NULL,
  escrow_contract_address TEXT NOT NULL,
  escrow_payment_id TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE,
  goal TEXT NOT NULL DEFAULT 'Prepare this payment case for fair human review.',
  status resolution_agent_status NOT NULL DEFAULT 'draft',
  case_wallet_address TEXT NOT NULL DEFAULT '',
  encrypted_wallet_secret JSONB,
  funder_address TEXT NOT NULL,
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  approved_budget_atomic BIGINT NOT NULL DEFAULT 0 CHECK (approved_budget_atomic >= 0),
  spent_budget_atomic BIGINT NOT NULL DEFAULT 0 CHECK (spent_budget_atomic >= 0),
  reserved_budget_atomic BIGINT NOT NULL DEFAULT 0 CHECK (reserved_budget_atomic >= 0),
  current_plan JSONB,
  observations JSONB,
  evidence_version_hash TEXT,
  case_version_hash TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,

  CONSTRAINT ra_one_agent_per_case
    UNIQUE (escrow_chain_id, LOWER(escrow_contract_address), escrow_payment_id),
  CONSTRAINT ra_spent_not_exceed_approved
    CHECK (spent_budget_atomic <= approved_budget_atomic),
  CONSTRAINT ra_spent_plus_reserved_not_exceed_approved
    CHECK (spent_budget_atomic + reserved_budget_atomic <= approved_budget_atomic),
  CONSTRAINT ra_expires_at_whole_second
    CHECK (date_trunc('second', expires_at) = expires_at OR expires_at IS NULL)
);

-- ============================================================================
-- Indexes: resolution_agents
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ra_status
  ON resolution_agents (status);
CREATE INDEX IF NOT EXISTS idx_ra_case
  ON resolution_agents (escrow_chain_id, LOWER(escrow_contract_address), escrow_payment_id);
CREATE INDEX IF NOT EXISTS idx_ra_funder
  ON resolution_agents (LOWER(funder_address));
CREATE INDEX IF NOT EXISTS idx_ra_created
  ON resolution_agents (created_at DESC);

-- ============================================================================
-- Table: resolution_agent_events — immutable audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolution_agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES resolution_agents(agent_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  previous_status resolution_agent_status,
  next_status resolution_agent_status,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Indexes: resolution_agent_events
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ra_events_agent
  ON resolution_agent_events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ra_events_created
  ON resolution_agent_events (created_at DESC);

-- ============================================================================
-- Table: resolution_agent_tool_executions — tool purchase & settlement lifecycle
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolution_agent_tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES resolution_agents(agent_id) ON DELETE CASCADE,
  tool_identifier TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  case_version_hash TEXT,
  evidence_version_hash TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','reserved','settling','paid_pending_result','settled','failed_recoverable','failed_unpaid','cancelled')),
  price_atomic BIGINT NOT NULL CHECK (price_atomic > 0),
  network TEXT NOT NULL,
  asset_address TEXT NOT NULL,
  pay_to_address TEXT NOT NULL,
  payment_reference TEXT,
  settlement_tx_hash TEXT,
  result_reference TEXT,
  result_data JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ra_te_unique_request_per_agent
    UNIQUE (agent_id, request_hash)
);

-- ============================================================================
-- Indexes: resolution_agent_tool_executions
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ra_te_agent
  ON resolution_agent_tool_executions (agent_id);
CREATE INDEX IF NOT EXISTS idx_ra_te_request_hash
  ON resolution_agent_tool_executions (request_hash);

-- ============================================================================
-- Table: resolution_agent_evidence_requests — evidence gathering lifecycle
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolution_agent_evidence_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES resolution_agents(agent_id) ON DELETE CASCADE,
  responsible_party TEXT NOT NULL
    CHECK (responsible_party IN ('client','worker')),
  evidence_item TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','fulfilled','cancelled')),
  created_case_version_hash TEXT,
  fulfilled_case_version_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- ============================================================================
-- Indexes: resolution_agent_evidence_requests
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ra_er_agent
  ON resolution_agent_evidence_requests (agent_id);

-- ============================================================================
-- Row Level Security — service-role access only
-- ============================================================================

ALTER TABLE resolution_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_agent_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_agent_evidence_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_resolution_agents"
    ON resolution_agents
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_events"
    ON resolution_agent_events
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_tool_executions"
    ON resolution_agent_tool_executions
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_evidence_requests"
    ON resolution_agent_evidence_requests
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Revoke public / authenticated access
-- ============================================================================

REVOKE ALL ON resolution_agents FROM anon, authenticated;
REVOKE ALL ON resolution_agent_events FROM anon, authenticated;
REVOKE ALL ON resolution_agent_tool_executions FROM anon, authenticated;
REVOKE ALL ON resolution_agent_evidence_requests FROM anon, authenticated;

-- ============================================================================
-- Table-level privileges — service_role
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agent_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agent_tool_executions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agent_evidence_requests TO service_role;
