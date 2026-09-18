-- ============================================================================
-- 00017: Party-scoped evidence auth challenges (P4.3D)
--
-- Closes the plaintext-evidence privacy gap. Anonymous/public may see payment
-- state + evidence hash ONLY. Plaintext delivery evidence is readable ONLY by
-- the on-chain client/worker via a wallet challenge:
--
--   POST .../evidence/challenge issues { challengeId, message, expiresAt }
--   POST .../evidence/plaintext consumes { challengeId, signature }
--
-- The raw 256-bit challengeId is NEVER stored — only its SHA-256 hash.
-- Challenges are durable, single-use, purpose-bound (evidence-read), short
-- expiry (5 min), and bound to payment + chain + wallet + canonical escrow
-- contract. Consumption is an atomic conditional UPDATE (mirroring the
-- reviewer nonce consume pattern and the x402_claim_settlement procedure
-- convention below). Reviewer nonce semantics are NOT overloaded; this is a
-- dedicated narrowly-scoped table for isolation.
--
-- RLS: service_role only (mirrors 00004 / 00011 / 00015 / 00016).
-- This is a migration FILE only — never apply to production here; rehearse
-- locally against a disposable database.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_evidence_auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_payment_id TEXT NOT NULL
    CONSTRAINT payment_evidence_auth_payment_numeric
    CHECK (escrow_payment_id ~ '^[0-9]+$'),
  escrow_chain_id INTEGER NOT NULL
    CONSTRAINT payment_evidence_auth_chain_positive
    CHECK (escrow_chain_id > 0),
  escrow_contract_address TEXT NOT NULL
    CONSTRAINT payment_evidence_auth_contract_format
    CHECK (escrow_contract_address ~* '^0x[0-9a-f]{40}$'),
  wallet_address TEXT NOT NULL
    CONSTRAINT payment_evidence_auth_wallet_format
    CHECK (wallet_address ~* '^0x[0-9a-f]{40}$'),
  challenge_hash TEXT NOT NULL
    CONSTRAINT payment_evidence_auth_hash_format
    CHECK (challenge_hash ~* '^0x[0-9a-f]{64}$'),
  purpose TEXT NOT NULL DEFAULT 'evidence-read'
    CONSTRAINT payment_evidence_auth_purpose
    CHECK (purpose = 'evidence-read'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_evidence_auth_expiry_order
    CHECK (expires_at > created_at)
);

-- Single-use lookup: the SHA-256 hash is unique so concurrent consumes race
-- on one row (insert races fail with 23505; consume races fail the
-- consumed_at IS NULL predicate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_evidence_auth_hash_unique
  ON payment_evidence_auth_challenges (challenge_hash);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_auth_expires
  ON payment_evidence_auth_challenges (expires_at);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_auth_case
  ON payment_evidence_auth_challenges (escrow_payment_id, escrow_chain_id);

-- ============================================================================
-- Atomic consume (mirrors x402_claim_settlement / x402_transition_state from
-- 00001 + 00015: a single conditional UPDATE ... RETURNING is the authority).
--
-- Consumes a challenge only when it is still unused and unexpired. The caller
-- that receives a row won the race; all others see zero rows (replay denied).
-- ============================================================================

CREATE OR REPLACE FUNCTION consume_payment_evidence_challenge(
  p_challenge_hash TEXT
)
RETURNS SETOF payment_evidence_auth_challenges
LANGUAGE sql
AS $$
  UPDATE payment_evidence_auth_challenges
  SET consumed_at = now()
  WHERE challenge_hash = p_challenge_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING *;
$$;

-- ============================================================================
-- Row Level Security — service-role access only
-- ============================================================================

ALTER TABLE payment_evidence_auth_challenges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_payment_evidence_auth_challenges"
    ON payment_evidence_auth_challenges
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE ALL ON payment_evidence_auth_challenges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_evidence_auth_challenges TO service_role;
