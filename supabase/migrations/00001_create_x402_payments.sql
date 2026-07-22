-- ============================================================================
-- I4: Durable x402 payment persistence — PostgreSQL schema
-- ============================================================================

-- Payment states
CREATE TYPE x402_payment_state AS ENUM (
  'pending',
  'authorization_verified',
  'settlement_submitted',
  'paid_pending_brief',
  'settled',
  'failed'
);

-- ============================================================================
-- x402_payments — canonical payment lifecycle table
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_identifier TEXT NOT NULL,
  service_identifier TEXT NOT NULL DEFAULT 'reclaim-dispute-brief-v1',
  escrow_payment_id TEXT,
  payer_address TEXT NOT NULL,
  pay_to_address TEXT NOT NULL,
  relayer_address TEXT,
  network TEXT NOT NULL DEFAULT 'eip155:11142220',
  chain_id INTEGER NOT NULL DEFAULT 11142220,
  token_address TEXT NOT NULL DEFAULT '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
  token_symbol TEXT NOT NULL DEFAULT 'USDC',
  token_decimals INTEGER NOT NULL DEFAULT 6,
  amount_atomic TEXT NOT NULL,
  amount_display TEXT NOT NULL,
  request_hash TEXT,
  dispute_reason TEXT,
  requested_outcome TEXT,
  authorization_nonce TEXT,
  authorization_deadline TEXT,
  authorization_status TEXT,
  state x402_payment_state NOT NULL DEFAULT 'pending',
  transaction_hash TEXT,
  block_number BIGINT,
  settlement_receipt JSONB,
  brief JSONB,
  error_code TEXT,
  error_message TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,

  CONSTRAINT x402_payments_identifier_unique UNIQUE (payment_identifier),
  CONSTRAINT x402_payments_tx_unique UNIQUE (transaction_hash),
  CONSTRAINT non_negative_amount CHECK (amount_atomic::bigint >= 0),
  CONSTRAINT valid_chain CHECK (chain_id > 0),
  CONSTRAINT valid_token_decimals CHECK (token_decimals > 0 AND token_decimals <= 36)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_x402_payments_payer
  ON x402_payments (LOWER(payer_address));
CREATE INDEX IF NOT EXISTS idx_x402_payments_pay_to
  ON x402_payments (LOWER(pay_to_address));
CREATE INDEX IF NOT EXISTS idx_x402_payments_request_hash
  ON x402_payments (request_hash)
  WHERE request_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_x402_payments_state
  ON x402_payments (state);
CREATE INDEX IF NOT EXISTS idx_x402_payments_created
  ON x402_payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_payments_tx_hash_lower
  ON x402_payments (LOWER(transaction_hash))
  WHERE transaction_hash IS NOT NULL;

-- ============================================================================
-- x402_consumed_transactions — replay protection ledger
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_consumed_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_hash TEXT NOT NULL,
  payment_identifier TEXT NOT NULL,
  escrow_payment_id TEXT,
  payer_address TEXT NOT NULL,
  pay_to_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  request_hash TEXT,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovery_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (recovery_type IN ('standard', 'legacy_recovered_settlement')),
  metadata JSONB,

  CONSTRAINT consumed_txs_hash_unique UNIQUE (transaction_hash),
  CONSTRAINT consumed_txs_identifier_unique UNIQUE (payment_identifier),
  CONSTRAINT consumed_tx_payment_fk
    FOREIGN KEY (payment_identifier)
    REFERENCES x402_payments(payment_identifier)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consumed_txs_hash_lower
  ON x402_consumed_transactions (LOWER(transaction_hash));
CREATE INDEX IF NOT EXISTS idx_consumed_txs_payment_id
  ON x402_consumed_transactions (payment_identifier);
CREATE INDEX IF NOT EXISTS idx_consumed_txs_consumed_at
  ON x402_consumed_transactions (consumed_at DESC);

-- ============================================================================
-- Table-level privileges — required for service_role access via REST API
-- ============================================================================

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.x402_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.x402_consumed_transactions TO service_role;

-- ============================================================================
-- Row Level Security — service-role access only
-- ============================================================================

ALTER TABLE x402_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_consumed_transactions ENABLE ROW LEVEL SECURITY;

-- Service role has full access
DO $$ BEGIN
  CREATE POLICY "service_role_all_x402_payments"
    ON x402_payments
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_x402_consumed_transactions"
    ON x402_consumed_transactions
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authenticated users can read their own payment metadata (public fields only)
DO $$ BEGIN
  CREATE POLICY "authenticated_read_own_public"
    ON x402_payments
    FOR SELECT
    TO authenticated
    USING (LOWER(payer_address) = LOWER(auth.jwt()->>'sub'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Helper: atomic state transition (prevents state regression)
-- ============================================================================

CREATE OR REPLACE FUNCTION x402_transition_state(
  p_payment_identifier TEXT,
  p_current_states x402_payment_state[],
  p_new_state x402_payment_state,
  p_settled_at TIMESTAMPTZ DEFAULT NULL,
  p_delivered_at TIMESTAMPTZ DEFAULT NULL,
  p_failed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS SETOF x402_payments
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    UPDATE x402_payments
    SET state = p_new_state,
        updated_at = now(),
        settled_at = COALESCE(p_settled_at, settled_at),
        delivered_at = COALESCE(p_delivered_at, delivered_at),
        failed_at = COALESCE(p_failed_at, failed_at)
    WHERE payment_identifier = p_payment_identifier
      AND state = ANY(p_current_states)
    RETURNING *;
END;
$$;
