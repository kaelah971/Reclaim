// ---------------------------------------------------------------------------
// Migration 00014 — safe retry of RELEASED-UNPAID executions (RA1R.7O)
//
// Static SQL inspection of the amended reserve function:
//   - exact 13-arg signature / SECURITY DEFINER / search_path='' / public.*
//   - settled / settlement-proof executions can NEVER be reused
//   - released_unpaid rows are REUSED atomically (kind 'reused')
//   - unreleased existing executions keep waiting behavior (kind 'existing')
//   - UNIQUE(agent_id, request_hash) preserved (reuse, never duplicate)
//   - concurrency: FOR UPDATE lock + cleared released_unpaid_at in the same tx
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../../../");
const MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/00014_retry_released_unpaid_tool_execution.sql",
);

let sql: string;
try {
  sql = readFileSync(MIGRATION_PATH, "utf-8");
} catch {
  throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
}

const BODY_START = sql.indexOf("AS $$");
const BODY_END = sql.lastIndexOf("$$;");
const body = sql.slice(BODY_START + 5, BODY_END);

describe("migration 00014 — structure", () => {
  it("preserves the exact 13-arg signature, SECURITY DEFINER, search_path and public.* refs", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION reserve_resolution_agent_tool_execution/i);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = ''/);
    const sig = sql.slice(sql.indexOf("("), sql.indexOf("RETURNS JSONB"));
    expect((sig.match(/\bTEXT\b|\bINTEGER\b|\bBIGINT\b|\bTIMESTAMPTZ\b/g) ?? []).length).toBe(13);
    expect(body).toMatch(/FROM public\.resolution_agents/i);
    expect(body).toMatch(/FROM public\.resolution_agent_tool_executions/i);
    expect(body).toMatch(/UPDATE public\.resolution_agents/i);
    expect(body).toMatch(/UPDATE public\.resolution_agent_tool_executions/i);
    const unqualified = body.match(
      /(?<!public\.)(?<!\.)\bFROM resolution_agents\b|(?<!public\.)\bUPDATE resolution_agents\b|(?<!public\.)\bFROM resolution_agent_tool_executions\b|(?<!public\.)\bUPDATE resolution_agent_tool_executions\b/i,
    );
    expect(unqualified).toBeNull();
  });

  it("preserves grants and the UNIQUE constraint (no DDL that could drop it)", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution TO service_role/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});

describe("migration 00014 — retry semantics", () => {
  it("settled or settlement-proof executions return existing and are NEVER re-reserved", () => {
    expect(body).toMatch(/state = 'settled'/);
    expect(body).toMatch(/settlement_tx_hash IS NOT NULL/);
    expect(body).toMatch(/payment_reference IS NOT NULL/);
    expect(body).toMatch(/'kind', 'existing'/);
  });

  it("released-unpaid executions are REUSED atomically (kind 'reused')", () => {
    expect(body).toMatch(/released_unpaid_at IS NOT NULL/);
    expect(body).toMatch(/'kind', 'reused'/);
    expect(body).toMatch(/released_unpaid_at = NULL/); // cleared for the retry
    expect(body).toMatch(/reserved_budget_atomic \+ p_price_atomic/); // reserve exactly once
    expect(body).toMatch(/state = 'reserved'/);
    expect(body).toMatch(/failure_reason = NULL/); // transient fields cleared
    expect(body).toMatch(/version = version \+ 1/);
  });

  it("unreleased existing executions keep the waiting behavior (kind 'existing')", () => {
    // The final fall-through branch returns existing without re-reserving.
    const existingBranches = (body.match(/'kind', 'existing'/g) ?? []).length;
    expect(existingBranches).toBeGreaterThanOrEqual(2); // settled + unreleased fall-through
  });

  it("concurrency: agent row locked FOR UPDATE so only one retry can reuse", () => {
    expect(body).toMatch(/FOR UPDATE/);
    // released_unpaid_at is cleared in the SAME transaction, so a concurrent
    // retry observes the row as released-unpaid=false and falls to waiting.
    expect(body).toMatch(/WHERE agent_id = p_agent_id AND version = p_expected_version/);
  });
});
