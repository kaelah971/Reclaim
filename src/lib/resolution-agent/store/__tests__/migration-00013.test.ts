// ---------------------------------------------------------------------------
// Migration 00013 — atomic UNPAID reservation release (RA1R.7L)
//
// Static SQL inspection of release_unpaid_tool_execution:
//   - fully qualified table references (public.*) under empty search_path
//   - settled executions can NEVER be released (state/settlement-proof guards)
//   - idempotent via released_unpaid_at (release exactly once)
//   - releases reserved budget, clears current_running_tool_id, returns to active
//   - service_role-only grants, no unrelated DDL
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../../../");
const MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/00013_release_unpaid_tool_execution.sql",
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

describe("migration 00013 — structure", () => {
  it("creates release_unpaid_tool_execution via CREATE OR REPLACE", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION release_unpaid_tool_execution/i);
  });

  it("preserves SECURITY DEFINER and SET search_path = ''", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = ''/);
  });

  it("adds the idempotency/audit column released_unpaid_at", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.resolution_agent_tool_executions\s+ADD COLUMN IF NOT EXISTS released_unpaid_at TIMESTAMPTZ/i,
    );
  });

  it("service_role-only grants", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION release_unpaid_tool_execution FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION release_unpaid_tool_execution TO service_role/i);
  });
});

describe("migration 00013 — release safety semantics", () => {
  it("all table references are schema-qualified (public.*)", () => {
    expect(body).toMatch(/FROM public\.resolution_agents/i);
    expect(body).toMatch(/FROM public\.resolution_agent_tool_executions/i);
    expect(body).toMatch(/UPDATE public\.resolution_agents/i);
    expect(body).toMatch(/UPDATE public\.resolution_agent_tool_executions/i);
    const unqualified = body.match(
      /(?<!public\.)(?<!\.)\bFROM resolution_agents\b|(?<!public\.)\bUPDATE resolution_agents\b|(?<!public\.)\bFROM resolution_agent_tool_executions\b|(?<!public\.)\bUPDATE resolution_agent_tool_executions\b/i,
    );
    expect(unqualified).toBeNull();
  });

  it("settled executions can NEVER be released", () => {
    expect(body).toMatch(/state = 'settled'/i);
    expect(body).toMatch(/Settled execution cannot be released/i);
  });

  it("executions with ANY settlement proof can NEVER be released", () => {
    expect(body).toMatch(/settlement_tx_hash IS NOT NULL/i);
    expect(body).toMatch(/payment_reference IS NOT NULL/i);
    expect(body).toMatch(/cannot be released/i);
  });

  it("release is idempotent (released_unpaid_at guard) — cannot release twice", () => {
    expect(body).toMatch(/released_unpaid_at IS NOT NULL/i);
    expect(body).toMatch(/'kind', 'already_released'/);
  });

  it("releases reserved budget, clears current_running_tool_id, returns to active", () => {
    expect(body).toMatch(/reserved_budget_atomic - v_execution\.price_atomic/i);
    expect(body).toMatch(/current_running_tool_id = NULL/i);
    expect(body).toMatch(/status = 'active'/i);
  });

  it("makes no unrelated schema changes", () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/CREATE INDEX/i);
    expect(sql).not.toMatch(/CREATE VIEW/i);
    expect(sql).not.toMatch(/^\s*DROP\b/m);
  });
});
