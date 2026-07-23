-- ============================================================================
-- I6B: Reviewer decision execution records
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_decision_id UUID NOT NULL
    REFERENCES reviewer_decisions(id) ON DELETE RESTRICT,
  payment_identifier TEXT NOT NULL,
  onchain_payment_id TEXT,
  decision TEXT NOT NULL
    CHECK (decision IN ('release_to_worker', 'refund_to_client', 'partial_resolution')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitting', 'submitted', 'confirmed', 'failed', 'cancelled')),
  executor_address TEXT,
  chain_id INTEGER NOT NULL DEFAULT 11142220,
  contract_address TEXT NOT NULL DEFAULT '0x0fA826256a58F19Ad24Fc9384d81D313f2266F79',
  expected_amount TEXT NOT NULL,
  client_amount TEXT NOT NULL,
  worker_amount TEXT NOT NULL,
  transaction_hash TEXT,
  block_number BIGINT,
  gas_used BIGINT,
  execution_error_code TEXT,
  execution_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  source_request_hash TEXT,
  source_onchain_snapshot JSONB,

  CONSTRAINT execution_tx_unique UNIQUE (transaction_hash),
  CONSTRAINT amounts_non_negative_client CHECK (client_amount::bigint >= 0),
  CONSTRAINT amounts_non_negative_worker CHECK (worker_amount::bigint >= 0)
);

-- Only one active/confirmed execution per payment
CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_payment_active
  ON review_executions (payment_identifier)
  WHERE status IN ('pending', 'submitting', 'submitted', 'confirmed');

-- One execution per reviewer decision
CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_decision
  ON review_executions (reviewer_decision_id);

CREATE INDEX IF NOT EXISTS idx_executions_status
  ON review_executions (status);

CREATE INDEX IF NOT EXISTS idx_executions_created
  ON review_executions (created_at DESC);

-- RLS
ALTER TABLE review_executions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_review_executions"
    ON review_executions
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_executions TO service_role;
