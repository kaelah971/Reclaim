// ---------------------------------------------------------------------------
// Migration 00012 — reserve RPC schema-qualification repair (RA1R.7J)
//
// Static SQL inspection of the forward migration that repairs the deployed
// reserve_resolution_agent_tool_execution function:
//   - every application-table reference must be fully qualified
//     (public.resolution_agents / public.resolution_agent_tool_executions)
//   - the EXACT 13-argument live signature must be preserved
//   - SECURITY DEFINER + SET search_path = '' must be preserved
//   - idempotency/budget/version semantics must remain
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../../../");
const MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/00012_fix_reserve_rpc_schema_qualification.sql",
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

describe("migration 00012 — structure", () => {
  it("creates the reserve_resolution_agent_tool_execution function via CREATE OR REPLACE", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION reserve_resolution_agent_tool_execution/i);
  });

  it("preserves SECURITY DEFINER and SET search_path = ''", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = ''/);
  });

  it("preserves the EXACT 13-argument live signature", () => {
    const expected = [
      "p_agent_id TEXT",
      "p_expected_version INTEGER",
      "p_request_hash TEXT",
      "p_tool_id TEXT",
      "p_case_version_hash TEXT",
      "p_evidence_version_hash TEXT",
      "p_price_atomic BIGINT",
      "p_network TEXT",
      "p_asset TEXT",
      "p_pay_to TEXT",
      "p_service_identifier TEXT",
      "p_policy_version TEXT",
      "p_now TIMESTAMPTZ",
    ];
    for (const arg of expected) {
      expect(sql).toMatch(new RegExp(`\\b${arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    }
    const sig = sql.slice(sql.indexOf("("), sql.indexOf("RETURNS JSONB"));
    expect((sig.match(/\bTEXT\b|\bINTEGER\b|\bBIGINT\b|\bTIMESTAMPTZ\b/g) ?? []).length).toBe(13);
  });

  it("preserves RETURNS JSONB and idempotency/budget/version semantics", () => {
    expect(sql).toMatch(/RETURNS JSONB/);
    expect(sql).toMatch(/Version conflict/);
    expect(sql).toMatch(/Insufficient budget/);
    expect(sql).toMatch(/cannot start tool execution/);
    expect(sql).toMatch(/SELECT \* INTO v_existing_execution/i);
    expect(sql).toMatch(/jsonb_build_object\(\s*'kind'\s*,\s*'existing'/);
    expect(sql).toMatch(/jsonb_build_object\(\s*'kind'\s*,\s*'created'/);
  });

  it("preserves service_role-only grants", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution TO service_role/i);
  });
});

describe("migration 00012 — schema-qualified function body (RA1R.7I root cause)", () => {
  it("every application-table reference is fully qualified as public.*", () => {
    expect(body).toMatch(/FROM public\.resolution_agents/i);
    expect(body).toMatch(/FROM public\.resolution_agent_tool_executions/i);
    expect(body).toMatch(/INSERT INTO public\.resolution_agent_tool_executions/i);
    expect(body).toMatch(/UPDATE public\.resolution_agents/i);
  });

  it("contains NO unqualified application-table references in the function body", () => {
    const unqualifiedAgent = body.match(
      /(?<!public\.)(?<!\.)\bFROM resolution_agents\b|(?<!public\.)\bUPDATE resolution_agents\b/i,
    );
    const unqualifiedExecutions = body.match(
      /(?<!public\.)\bINTO resolution_agent_tool_executions\b|(?<!public\.)\bFROM resolution_agent_tool_executions\b/i,
    );
    expect(unqualifiedAgent).toBeNull();
    expect(unqualifiedExecutions).toBeNull();
  });

  it("makes no unrelated schema changes (only the function + its grants)", () => {
    // No DDL beyond the function repair.
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/CREATE INDEX/i);
    expect(sql).not.toMatch(/CREATE VIEW/i);
    expect(sql).not.toMatch(/^\s*DROP\b/m); // no DROP statements
    // Everything after the function body is grants only.
    const tail = sql.slice(sql.lastIndexOf("$$;") + 3);
    expect(tail).toMatch(/REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM PUBLIC/i);
    expect(tail).toMatch(/GRANT EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution TO service_role/i);
    expect(tail).not.toMatch(/^\s*CREATE\b/m);
    expect(tail).not.toMatch(/^\s*ALTER\b/m);
    expect(tail).not.toMatch(/^\s*INSERT\b/m);
    expect(tail).not.toMatch(/^\s*UPDATE\b/m);
    expect(tail).not.toMatch(/^\s*DELETE\b/m);
  });
});
