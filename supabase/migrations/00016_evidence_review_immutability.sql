-- ============================================================================
-- 00016: Evidence is immutable once reviewer review begins
--
-- The first persisted reviewer draft is the durable review-start boundary.
-- From that point onward, evidence metadata cannot be inserted, changed, or
-- deleted for the associated escrow payment. The lock is kept separately from
-- reviewer_decisions so deleting/superseding a draft cannot unlock evidence.
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_review_locks (
  escrow_chain_id TEXT NOT NULL,
  escrow_payment_id TEXT NOT NULL,
  review_payment_identifier TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (escrow_chain_id, escrow_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_review_locks_payment
  ON evidence_review_locks (escrow_payment_id);

ALTER TABLE evidence_review_locks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all_evidence_review_locks"
    ON evidence_review_locks
    FOR ALL
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE ALL ON evidence_review_locks FROM anon, authenticated;
GRANT SELECT ON evidence_review_locks TO service_role;

-- Preserve the boundary for reviews that already existed before this
-- migration was applied.
INSERT INTO evidence_review_locks (
  escrow_chain_id,
  escrow_payment_id,
  review_payment_identifier
)
SELECT p.chain_id::text, p.escrow_payment_id, d.payment_identifier
  FROM reviewer_decisions d
  JOIN x402_payments p ON p.payment_identifier = d.payment_identifier
 WHERE p.escrow_payment_id IS NOT NULL
   AND p.escrow_payment_id ~ '^[0-9]+$'
ON CONFLICT (escrow_chain_id, escrow_payment_id) DO NOTHING;

-- A reviewer draft is the first review action. Lock the corresponding escrow
-- row while creating the lock so an evidence write cannot race this boundary.
CREATE OR REPLACE FUNCTION lock_evidence_on_review_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain_id TEXT;
  v_escrow_payment_id TEXT;
BEGIN
  SELECT chain_id::text, escrow_payment_id
    INTO v_chain_id, v_escrow_payment_id
    FROM x402_payments
   WHERE payment_identifier = NEW.payment_identifier
   FOR UPDATE;

  IF v_chain_id IS NOT NULL
     AND v_escrow_payment_id IS NOT NULL
     AND v_escrow_payment_id ~ '^[0-9]+$' THEN
    INSERT INTO evidence_review_locks (
      escrow_chain_id,
      escrow_payment_id,
      review_payment_identifier
    ) VALUES (
      v_chain_id,
      v_escrow_payment_id,
      NEW.payment_identifier
    )
    ON CONFLICT (escrow_chain_id, escrow_payment_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviewer_decision_starts_evidence_lock ON reviewer_decisions;
CREATE TRIGGER reviewer_decision_starts_evidence_lock
  BEFORE INSERT ON reviewer_decisions
  FOR EACH ROW
  EXECUTE FUNCTION lock_evidence_on_review_start();

-- Protect every mutation path, including direct service-role SQL. Both this
-- trigger and the reviewer trigger lock the x402 payment row, making the
-- review/evidence boundary deterministic under concurrent requests.
CREATE OR REPLACE FUNCTION reject_locked_evidence_metadata_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain_id TEXT;
  v_escrow_payment_id TEXT;
  v_payment_identifier TEXT;
  v_metadata_chain_id TEXT;
  v_metadata_payment_id TEXT;
BEGIN
  v_metadata_chain_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.escrow_chain_id ELSE NEW.escrow_chain_id END;
  v_metadata_payment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.escrow_payment_id ELSE NEW.escrow_payment_id END;

  SELECT chain_id::text, escrow_payment_id, payment_identifier
    INTO v_chain_id, v_escrow_payment_id, v_payment_identifier
    FROM x402_payments
   WHERE chain_id::text = v_metadata_chain_id
     AND escrow_payment_id IS NOT NULL
     AND escrow_payment_id ~ '^[0-9]+$'
     AND v_metadata_payment_id ~ '^[0-9]+$'
     AND escrow_payment_id::numeric = v_metadata_payment_id::numeric
   LIMIT 1
   FOR SHARE;

  IF v_payment_identifier IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM evidence_review_locks l
        WHERE l.escrow_chain_id = v_chain_id
          AND l.escrow_payment_id ~ '^[0-9]+$'
          AND l.escrow_payment_id::numeric = v_escrow_payment_id::numeric
     ) THEN
    RAISE EXCEPTION 'Evidence metadata is immutable after reviewer review begins'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_metadata_review_immutability ON evidence_metadata;
CREATE TRIGGER evidence_metadata_review_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON evidence_metadata
  FOR EACH ROW
  EXECUTE FUNCTION reject_locked_evidence_metadata_mutation();
