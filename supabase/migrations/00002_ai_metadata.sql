-- ============================================================================
-- I5: AI dispute case brief metadata — extends x402_payments
-- ============================================================================

-- Add AI generation metadata columns to the existing payments table
ALTER TABLE x402_payments
  ADD COLUMN IF NOT EXISTS generation_mode TEXT,
  ADD COLUMN IF NOT EXISTS ai_provider TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS generation_status TEXT,
  ADD COLUMN IF NOT EXISTS generation_attempt_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generation_error_code TEXT,
  ADD COLUMN IF NOT EXISTS generation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation_completed_at TIMESTAMPTZ;

-- Index for generation mode queries
CREATE INDEX IF NOT EXISTS idx_x402_payments_generation_mode
  ON x402_payments (generation_mode)
  WHERE generation_mode IS NOT NULL;

-- Constraint: generation_mode must be 'ai' or 'deterministic_fallback'
ALTER TABLE x402_payments
  ADD CONSTRAINT valid_generation_mode
  CHECK (generation_mode IN ('ai', 'deterministic_fallback'))
  NOT VALID;
