-- ============================================================================
-- 00013 — Atomic release of UNPAID tool-execution reservations
--
-- A failed settlement with VERIFIED zero settlement must not permanently
-- strand reserved budget. This function atomically:
--   1. Locks the agent row and validates existence/version
--   2. Loads the execution for (agent_id, request_hash) and verifies it is
--      UNPAID: state not 'settled' AND settlement_tx_hash IS NULL AND
--      payment_reference IS NULL (settled executions can NEVER be released)
--   3. Verifies the reservation was not already released (released_unpaid_at)
--   4. Releases reserved_budget_atomic -= price, clears current_running_tool_id,
--      returns the agent to an execution-eligible status ('active'),
--      stamps the execution released_unpaid_at (idempotency), increments version
--
-- SECURITY DEFINER + SET search_path = '' with FULLY QUALIFIED table
-- references (per RA1R.7I lesson).
-- ============================================================================

-- Audit/state column for idempotent release (execution remains in place).
ALTER TABLE public.resolution_agent_tool_executions
  ADD COLUMN IF NOT EXISTS released_unpaid_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION release_unpaid_tool_execution(
  p_agent_id TEXT,
  p_request_hash TEXT,
  p_expected_version INTEGER,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent RECORD;
  v_execution RECORD;
  v_result JSONB;
BEGIN
  -- 1. Lock the agent row
  SELECT * INTO v_agent
  FROM public.resolution_agents
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found: %', p_agent_id;
  END IF;

  -- 2. Version validation (concurrency guard)
  IF v_agent.version != p_expected_version THEN
    RAISE EXCEPTION 'Version conflict: expected %, actual %', p_expected_version, v_agent.version;
  END IF;

  -- 3. Load the execution for this identity
  SELECT * INTO v_execution
  FROM public.resolution_agent_tool_executions
  WHERE agent_id = p_agent_id AND request_hash = p_request_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution not found: %', p_request_hash;
  END IF;

  -- 4. Idempotency: already released
  IF v_execution.released_unpaid_at IS NOT NULL THEN
    v_result := jsonb_build_object(
      'kind', 'already_released',
      'agent_id', p_agent_id,
      'request_hash', p_request_hash,
      'released_unpaid_at', v_execution.released_unpaid_at
    );
    RETURN v_result;
  END IF;

  -- 5. NEVER release a settled execution or one with any settlement proof
  IF v_execution.state = 'settled' THEN
    RAISE EXCEPTION 'Settled execution cannot be released: %', p_request_hash;
  END IF;

  IF v_execution.settlement_tx_hash IS NOT NULL OR v_execution.payment_reference IS NOT NULL THEN
    RAISE EXCEPTION 'Execution has settlement proof and cannot be released: %', p_request_hash;
  END IF;

  -- 6. Release the reservation atomically
  UPDATE public.resolution_agents
  SET
    reserved_budget_atomic = GREATEST(reserved_budget_atomic - v_execution.price_atomic, 0),
    current_running_tool_id = NULL,
    status = 'active',
    version = version + 1,
    updated_at = p_now
  WHERE agent_id = p_agent_id AND version = p_expected_version;

  -- 7. Stamp the execution as released (idempotency + audit trail)
  UPDATE public.resolution_agent_tool_executions
  SET
    released_unpaid_at = p_now,
    updated_at = p_now
  WHERE id = v_execution.id;

  v_result := jsonb_build_object(
    'kind', 'released',
    'agent_id', p_agent_id,
    'request_hash', p_request_hash,
    'released_atomic', v_execution.price_atomic,
    'reserved_after', v_agent.reserved_budget_atomic - v_execution.price_atomic,
    'state', v_execution.state
  );

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Security: service_role only (same posture as the reserve function)
-- ============================================================================

REVOKE EXECUTE ON FUNCTION release_unpaid_tool_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_unpaid_tool_execution FROM anon;
REVOKE EXECUTE ON FUNCTION release_unpaid_tool_execution FROM authenticated;
GRANT EXECUTE ON FUNCTION release_unpaid_tool_execution TO service_role;
