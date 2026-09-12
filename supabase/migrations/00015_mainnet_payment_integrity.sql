-- ============================================================================
-- P2B: reviewer / escrow identity integrity
--
-- These constraints apply to new writes without rewriting historical rows.
-- Existing Sepolia records remain readable, including records that predate the
-- durable reviewer binding columns.
-- ============================================================================

-- An x402 payment identifier is not an escrow identifier. Keep the existing
-- nullable field, but reject UUIDs, pay_* identifiers, signs, and decimals in
-- all future escrow-scoped writes.
DO $$ BEGIN
  ALTER TABLE x402_payments
    ADD CONSTRAINT x402_escrow_payment_id_numeric
    CHECK (escrow_payment_id IS NULL OR escrow_payment_id ~ '^[0-9]+$')
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_x402_payments_escrow_binding
  ON x402_payments (chain_id, escrow_payment_id)
  WHERE escrow_payment_id IS NOT NULL;

-- ==========================================================================
-- P2D: x402 request idempotency and settlement claim support
--
-- The request hash is the durable identity of a logical service request.  A
-- partial unique index leaves old/null request hashes untouched while making
-- all new bindings race-safe across server instances.  The claim function is
-- an atomic conditional transition; callers must only invoke the provider
-- after receiving a row from this transition.
-- ==========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_x402_payments_request_hash_unique
  ON x402_payments (request_hash)
  WHERE request_hash IS NOT NULL;

-- EVM transaction hashes are case-insensitive. The original table constraint
-- is case-sensitive, so this index closes the duplicate window for differently
-- cased hashes while still allowing the historical NULL values.
CREATE UNIQUE INDEX IF NOT EXISTS idx_x402_payments_transaction_hash_lower_unique
  ON x402_payments (lower(transaction_hash))
  WHERE transaction_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_x402_consumed_transactions_hash_lower_unique
  ON x402_consumed_transactions (lower(transaction_hash));

CREATE INDEX IF NOT EXISTS idx_x402_payments_settlement_claim
  ON x402_payments (payment_identifier, state)
  WHERE state IN ('pending', 'authorization_verified');

CREATE OR REPLACE FUNCTION x402_claim_settlement(
  p_payment_identifier TEXT,
  p_request_hash TEXT DEFAULT NULL
)
RETURNS SETOF x402_payments
LANGUAGE sql
AS $$
  UPDATE x402_payments
  SET state = 'settlement_submitted',
      updated_at = now()
  WHERE payment_identifier = p_payment_identifier
    AND (p_request_hash IS NULL OR request_hash = p_request_hash)
    AND state IN ('pending', 'authorization_verified')
  RETURNING *;
$$;

-- A decision can only become executable once the complete chain-scoped
-- binding has been persisted. JSON keys use the camelCase names written by the
-- reviewer store; no historical row is rewritten or validated retroactively.
DO $$ BEGIN
  ALTER TABLE reviewer_decisions
    ADD CONSTRAINT reviewer_decisions_onchain_payment_id_numeric
    CHECK (onchain_payment_id IS NULL OR onchain_payment_id ~ '^[0-9]+$')
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE reviewer_decisions
    ADD CONSTRAINT reviewer_decisions_ready_binding_complete
    CHECK (
      decision_status <> 'ready_for_execution'
      OR (
        onchain_payment_id IS NOT NULL
        AND onchain_payment_id ~ '^[0-9]+$'
        AND chain_id IS NOT NULL
        AND chain_id > 0
        AND contract_address IS NOT NULL
        AND contract_address ~* '^0x[0-9a-f]{40}$'
        AND onchain_snapshot IS NOT NULL
        AND onchain_snapshot ?& ARRAY[
          'id', 'chainId', 'contractAddress', 'client', 'worker',
          'amount', 'token', 'state'
        ]
        AND onchain_snapshot->>'id' IS NOT NULL
        AND (onchain_snapshot->>'id') ~ '^[0-9]+$'
        AND onchain_snapshot->>'id' = onchain_payment_id
        AND onchain_snapshot->>'chainId' IS NOT NULL
        AND onchain_snapshot->>'chainId' = chain_id::text
        AND onchain_snapshot->>'contractAddress' IS NOT NULL
        AND lower(onchain_snapshot->>'contractAddress') = lower(contract_address)
        AND onchain_snapshot->>'client' IS NOT NULL
        AND (onchain_snapshot->>'client') ~* '^0x[0-9a-f]{40}$'
        AND onchain_snapshot->>'worker' IS NOT NULL
        AND (onchain_snapshot->>'worker') ~* '^0x[0-9a-f]{40}$'
        AND onchain_snapshot->>'amount' IS NOT NULL
        AND (onchain_snapshot->>'amount') ~ '^[0-9]+$'
        AND onchain_snapshot->>'token' IS NOT NULL
        AND (onchain_snapshot->>'token') ~* '^0x[0-9a-f]{40}$'
        AND onchain_snapshot->>'state' = 'Disputed'
      )
    )
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only one final reviewer decision and one exact escrow binding may be active
-- for a payment. Superseded/draft history remains available.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_decisions_ready_payment_unique
  ON reviewer_decisions (payment_identifier)
  WHERE decision_status = 'ready_for_execution';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_decisions_ready_binding_unique
  ON reviewer_decisions (
    chain_id,
    lower(contract_address),
    onchain_payment_id
  )
  WHERE decision_status = 'ready_for_execution'
    AND onchain_payment_id IS NOT NULL;

-- Execution rows must retain the same numeric identity. Existing nullable
-- history is preserved; new active executions are checked and unique by exact
-- chain/contract/payment binding in addition to payment_identifier.
DO $$ BEGIN
  ALTER TABLE review_executions
    ADD CONSTRAINT review_executions_onchain_payment_id_numeric
    CHECK (onchain_payment_id IS NULL OR onchain_payment_id ~ '^[0-9]+$')
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE review_executions
    ADD CONSTRAINT review_executions_active_binding_complete
    CHECK (
      status NOT IN ('pending', 'submitting', 'submitted', 'confirmed')
      OR (
        onchain_payment_id IS NOT NULL
        AND onchain_payment_id ~ '^[0-9]+$'
        AND chain_id > 0
        AND contract_address IS NOT NULL
        AND contract_address ~* '^0x[0-9a-f]{40}$'
        AND source_onchain_snapshot IS NOT NULL
        AND source_onchain_snapshot ?& ARRAY[
          'id', 'chainId', 'contractAddress', 'client', 'worker',
          'amount', 'token', 'state'
        ]
        AND source_onchain_snapshot->>'id' = onchain_payment_id
        AND source_onchain_snapshot->>'chainId' = chain_id::text
        AND lower(source_onchain_snapshot->>'contractAddress') = lower(contract_address)
        AND source_onchain_snapshot->>'client' IS NOT NULL
        AND source_onchain_snapshot->>'worker' IS NOT NULL
        AND source_onchain_snapshot->>'amount' IS NOT NULL
        AND source_onchain_snapshot->>'token' IS NOT NULL
        AND source_onchain_snapshot->>'state' = 'Disputed'
      )
    )
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_executions_active_binding_unique
  ON review_executions (
    chain_id,
    lower(contract_address),
    onchain_payment_id
  )
  WHERE status IN ('pending', 'submitting', 'submitted', 'confirmed')
    AND onchain_payment_id IS NOT NULL;

-- ============================================================================
-- P2C: durable Resolution Agent wallet-authorization nonce ledger
--
-- A nonce is consumed only after the signed message has passed exact parsing,
-- signature verification, and route-context binding.  The unique nonce hash
-- makes consumption atomic across concurrent/serverless instances.  This is a
-- local migration addition; it is intentionally not applied remotely here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS resolution_agent_auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  action TEXT NOT NULL,
  signer_address TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resolution_agent_auth_nonce_expiry_order
    CHECK (expires_at > issued_at),
  CONSTRAINT resolution_agent_auth_nonce_signer_format
    CHECK (signer_address ~* '^0x[0-9a-f]{40}$'),
  CONSTRAINT resolution_agent_auth_nonce_hash_format
    CHECK (nonce_hash ~* '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_resolution_agent_auth_nonces_expiry
  ON resolution_agent_auth_nonces (expires_at);

ALTER TABLE resolution_agent_auth_nonces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_resolution_agent_auth_nonces"
    ON resolution_agent_auth_nonces
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE ALL ON resolution_agent_auth_nonces FROM anon, authenticated;
GRANT SELECT, INSERT ON resolution_agent_auth_nonces TO service_role;
