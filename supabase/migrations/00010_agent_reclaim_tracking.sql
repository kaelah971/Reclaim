-- ============================================================================
-- 00010: Agent reclaim tracking
--
-- Adds reclaim-specific fields to resolution_agents so the close-and-reclaim
-- workflow can durably track transaction state and survive process crashes
-- without risk of duplicate USDC transfers.
-- ============================================================================

ALTER TABLE resolution_agents
  ADD COLUMN IF NOT EXISTS reclaim_state TEXT
    CHECK (reclaim_state IS NULL OR reclaim_state IN (
      'prepared', 'submitted', 'confirmed', 'failed', 'ambiguous'
    ));

ALTER TABLE resolution_agents
  ADD COLUMN IF NOT EXISTS reclaim_amount_atomic BIGINT
    CHECK (reclaim_amount_atomic IS NULL OR reclaim_amount_atomic >= 0);

ALTER TABLE resolution_agents
  ADD COLUMN IF NOT EXISTS reclaim_destination TEXT;

ALTER TABLE resolution_agents
  ADD COLUMN IF NOT EXISTS reclaim_tx_hash TEXT;

ALTER TABLE resolution_agents
  ADD COLUMN IF NOT EXISTS reclaim_submitted_at TIMESTAMPTZ;
