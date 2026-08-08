-- ============================================================================
-- 00011 — Durable Evidence Metadata
--
-- Stores cryptographically verified evidence manifests submitted via the
-- EvidenceForm flow.  Each row is independently verified against the
-- current on-chain evidenceReference at submission time.  Previous versions
-- are preserved; only the latest matching on-chain reference is marked
-- is_current.
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_chain_id TEXT NOT NULL,
  escrow_contract_address TEXT NOT NULL,
  escrow_payment_id TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  manifest TEXT NOT NULL,
  title TEXT,
  description TEXT,
  evidence_type TEXT,
  file_hash TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  submitter_address TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Look up the current evidence for a payment (used by CaseEvidenceReader)
CREATE INDEX IF NOT EXISTS idx_evm_current
  ON evidence_metadata (escrow_payment_id, escrow_chain_id, escrow_contract_address)
  WHERE is_current = true;

-- Full audit trail ordered by submission time
CREATE INDEX IF NOT EXISTS idx_evm_history
  ON evidence_metadata (escrow_payment_id, submitted_at DESC);

-- Deduplication: same escrow case + same evidence reference should be idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_evm_case_reference_unique
  ON evidence_metadata (escrow_payment_id, escrow_chain_id, escrow_contract_address, evidence_reference);

-- ============================================================================
-- Row Level Security — service-role access only
-- ============================================================================

ALTER TABLE evidence_metadata ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_evidence_metadata"
    ON evidence_metadata
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE ALL ON evidence_metadata FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_metadata TO service_role;
