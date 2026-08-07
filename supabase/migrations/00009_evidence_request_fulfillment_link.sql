-- ============================================================================
-- 00009: Durable evidence-request fulfillment link
--
-- Adds two columns to resolution_agent_evidence_requests enabling deterministic
-- crash recovery after evidence submission:
--
--   fulfillment_evidence_reference — the on-chain bytes32 evidenceReference
--     (as hex string) that satisfied this request. Allows the server to
--     query "which request does this on-chain evidence fulfill?"
--
--   evidence_preimage — the full preimage string used to compute the
--     evidenceReference hash. Format:
--       "reclaim-evidence-request:" + requestId + ":" + manifest
--     Enables crash recovery: the reconciler hashes stored preimages and
--     compares against the on-chain evidenceReference to find the exact
--     matching request without guesswork.
-- ============================================================================

ALTER TABLE resolution_agent_evidence_requests
  ADD COLUMN IF NOT EXISTS fulfillment_evidence_reference TEXT;

ALTER TABLE resolution_agent_evidence_requests
  ADD COLUMN IF NOT EXISTS evidence_preimage TEXT;

-- ============================================================================
-- Index: fast lookup by fulfillment evidence reference (crash recovery)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ra_er_fulfillment_ref
  ON resolution_agent_evidence_requests (agent_id, fulfillment_evidence_reference)
  WHERE fulfillment_evidence_reference IS NOT NULL;
