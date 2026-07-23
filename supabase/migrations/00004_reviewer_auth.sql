-- ============================================================================
-- I6A.1: Durable reviewer auth — nonces and sessions
-- ============================================================================

-- Nonces: single-use, 5-minute expiry, anti-replay
CREATE TABLE IF NOT EXISTS reviewer_auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT,
  nonce_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_nonces_hash
  ON reviewer_auth_nonces (nonce_hash);

CREATE INDEX IF NOT EXISTS idx_reviewer_nonces_expires
  ON reviewer_auth_nonces (expires_at);

-- Sessions: 1-hour expiry, revocable, token stored as hash only
CREATE TABLE IF NOT EXISTS reviewer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviewer_sessions_hash
  ON reviewer_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_reviewer_sessions_address
  ON reviewer_sessions (LOWER(wallet_address));

CREATE INDEX IF NOT EXISTS idx_reviewer_sessions_expires
  ON reviewer_sessions (expires_at);

-- Cleanup function: remove expired nonces and sessions
CREATE OR REPLACE FUNCTION cleanup_reviewer_auth()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM reviewer_auth_nonces WHERE expires_at < now();
  DELETE FROM reviewer_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL;
$$;

-- RLS
ALTER TABLE reviewer_auth_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_reviewer_auth_nonces"
    ON reviewer_auth_nonces
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_all_reviewer_sessions"
    ON reviewer_sessions
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviewer_auth_nonces TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviewer_sessions TO service_role;
