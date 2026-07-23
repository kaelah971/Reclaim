-- ============================================================================
-- I6A: Reviewer decisions model
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviewer_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_identifier TEXT NOT NULL,
  dispute_identifier TEXT,
  reviewer_address TEXT NOT NULL,
  reviewer_auth_method TEXT NOT NULL DEFAULT 'wallet_signature',
  decision TEXT NOT NULL
    CHECK (decision IN ('release_to_worker', 'refund_to_client', 'partial_resolution', 'needs_more_evidence')),
  rationale TEXT NOT NULL,
  evidence_notes TEXT,
  conditions TEXT,
  client_amount TEXT,
  worker_amount TEXT,
  decision_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (decision_status IN ('draft', 'submitted', 'ready_for_execution', 'superseded')),
  source_brief_version TEXT,
  source_request_hash TEXT,
  onchain_payment_id TEXT,
  chain_id INTEGER,
  contract_address TEXT,
  onchain_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,

  CONSTRAINT partial_amounts_required
    CHECK (
      decision != 'partial_resolution'
      OR (client_amount IS NOT NULL AND worker_amount IS NOT NULL)
    ),
  CONSTRAINT client_amount_non_negative
    CHECK (client_amount IS NULL OR client_amount::bigint >= 0),
  CONSTRAINT worker_amount_non_negative
    CHECK (worker_amount IS NULL OR worker_amount::bigint >= 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviewer_decisions_payment
  ON reviewer_decisions (payment_identifier);
CREATE INDEX IF NOT EXISTS idx_reviewer_decisions_reviewer
  ON reviewer_decisions (LOWER(reviewer_address));
CREATE INDEX IF NOT EXISTS idx_reviewer_decisions_status
  ON reviewer_decisions (decision_status);
CREATE INDEX IF NOT EXISTS idx_reviewer_decisions_created
  ON reviewer_decisions (created_at DESC);

-- RLS
ALTER TABLE reviewer_decisions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_reviewer_decisions"
    ON reviewer_decisions
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviewer_decisions TO service_role;
