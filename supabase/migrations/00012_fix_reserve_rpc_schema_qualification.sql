-- ============================================================================
-- 00012 — Repair reserve_resolution_agent_tool_execution schema qualification
--
-- PURPOSE: The function deployed by migration 00008 is SECURITY DEFINER with
-- SET search_path = '' but references application tables UNQUALIFIED:
--     FROM resolution_agents
--     FROM resolution_agent_tool_executions
--     INSERT INTO resolution_agent_tool_executions
--     UPDATE resolution_agents
-- With an empty search_path only pg_catalog is searched, so EVERY live
-- invocation failed BEFORE any mutation with:
--     relation "resolution_agents" does not exist
--
-- This forward migration re-creates the function with fully qualified
-- references (public.resolution_agents, public.resolution_agent_tool_executions)
-- while preserving the EXACT deployed signature, behavior, SECURITY DEFINER,
-- empty search_path, return type, and grants. No other schema changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION reserve_resolution_agent_tool_execution(
  p_agent_id TEXT,
  p_expected_version INTEGER,
  p_request_hash TEXT,
  p_tool_id TEXT,
  p_case_version_hash TEXT,
  p_evidence_version_hash TEXT,
  p_price_atomic BIGINT,
  p_network TEXT,
  p_asset TEXT,
  p_pay_to TEXT,
  p_service_identifier TEXT,
  p_policy_version TEXT,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent RECORD;
  v_existing_execution RECORD;
  v_new_execution_id UUID;
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

  -- 2. Version validation
  IF v_agent.version != p_expected_version THEN
    RAISE EXCEPTION 'Version conflict: expected %, actual %', p_expected_version, v_agent.version;
  END IF;

  -- 3. Lifecycle validation
  IF v_agent.status NOT IN ('active', 'running_tool') THEN
    RAISE EXCEPTION 'Agent status % cannot start tool execution', v_agent.status;
  END IF;

  -- 4. Price validation
  IF p_price_atomic <= 0 THEN
    RAISE EXCEPTION 'Price must be positive';
  END IF;

  -- 5. Budget validation
  IF v_agent.spent_budget_atomic < 0 OR v_agent.reserved_budget_atomic < 0 THEN
    RAISE EXCEPTION 'Invalid budget state';
  END IF;

  IF v_agent.spent_budget_atomic + v_agent.reserved_budget_atomic + p_price_atomic > v_agent.approved_budget_atomic THEN
    RAISE EXCEPTION 'Insufficient budget: approved %, spent %, reserved %, requested %',
      v_agent.approved_budget_atomic, v_agent.spent_budget_atomic, v_agent.reserved_budget_atomic, p_price_atomic;
  END IF;

  -- 6. Check for existing execution (idempotent)
  SELECT * INTO v_existing_execution
  FROM public.resolution_agent_tool_executions
  WHERE agent_id = p_agent_id AND request_hash = p_request_hash;

  IF FOUND THEN
    -- Idempotent return — existing execution
    v_result := jsonb_build_object(
      'kind', 'existing',
      'execution_id', v_existing_execution.id,
      'agent_id', v_agent.agent_id,
      'request_hash', v_existing_execution.request_hash,
      'state', v_existing_execution.state
    );
    RETURN v_result;
  END IF;

  -- 7. Insert new execution
  v_new_execution_id := gen_random_uuid();

  INSERT INTO public.resolution_agent_tool_executions (
    id, agent_id, tool_identifier, request_hash,
    case_version_hash, evidence_version_hash,
    state, price_atomic, network, asset_address, pay_to_address,
    created_at, updated_at
  ) VALUES (
    v_new_execution_id, p_agent_id, p_tool_id, p_request_hash,
    p_case_version_hash, p_evidence_version_hash,
    'reserved', p_price_atomic, p_network,
    LOWER(p_asset), LOWER(p_pay_to),
    p_now, p_now
  );

  -- 8. Update agent: reserve budget, set currentRunningToolId, transition status
  UPDATE public.resolution_agents
  SET
    reserved_budget_atomic = reserved_budget_atomic + p_price_atomic,
    current_running_tool_id = p_tool_id,
    status = 'running_tool',
    version = version + 1,
    updated_at = p_now
  WHERE agent_id = p_agent_id AND version = p_expected_version;

  -- 9. Return created result
  v_result := jsonb_build_object(
    'kind', 'created',
    'execution_id', v_new_execution_id,
    'agent_id', p_agent_id,
    'request_hash', p_request_hash,
    'state', 'reserved',
    'reserved_atomic', v_agent.reserved_budget_atomic + p_price_atomic
  );

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Security: preserve service_role-only execution (re-affirmed; CREATE OR
-- REPLACE FUNCTION does not drop grants, but re-declaring is idempotent).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM anon;
REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM authenticated;
GRANT EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution TO service_role;
