-- ============================================================================
-- 00006: Celo x402 facilitator settlement tracking
-- Adds facilitator-specific fields for Track 2 (Most x402 Payments) tracking
-- ============================================================================

ALTER TABLE x402_payments
ADD COLUMN IF NOT EXISTS settlement_provider TEXT,
ADD COLUMN IF NOT EXISTS facilitator_url TEXT,
ADD COLUMN IF NOT EXISTS x402_version INTEGER,
ADD COLUMN IF NOT EXISTS payment_scheme TEXT,
ADD COLUMN IF NOT EXISTS facilitator_network TEXT,
ADD COLUMN IF NOT EXISTS facilitator_payment_id TEXT,
ADD COLUMN IF NOT EXISTS facilitator_settlement_receipt JSONB;

-- ============================================================================
-- Indexes
-- ============================================================================

-- Index for facilitator payment ID lookups
CREATE INDEX IF NOT EXISTS idx_x402_payments_facilitator_payment_id
  ON x402_payments (facilitator_payment_id)
  WHERE facilitator_payment_id IS NOT NULL;

-- Index for settlement provider type
CREATE INDEX IF NOT EXISTS idx_x402_payments_settlement_provider
  ON x402_payments (settlement_provider)
  WHERE settlement_provider IS NOT NULL;

-- ============================================================================
-- Backfill existing records
-- ============================================================================

-- Mark any existing payments as "local" settlement
-- (they were settled via the local Permit2 relayer)
UPDATE x402_payments
SET settlement_provider = 'local',
    payment_scheme = 'exact',
    x402_version = 2
WHERE settlement_provider IS NULL;

-- ============================================================================
-- Table-level privileges — required for service_role access via REST API
-- ============================================================================

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.x402_payments TO service_role;
