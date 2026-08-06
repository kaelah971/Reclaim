// ---------------------------------------------------------------------------
// Migration 00008 — static SQL structure inspection
//
// Verifies the migration file contains all required elements without
// connecting to a live database.  Reads the SQL file and checks for the
// presence of expected patterns.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// The test is at: src/lib/resolution-agent/store/__tests__/migration-00008.test.ts
// The migration is at: supabase/migrations/00008_resolution_agent_atomic_tool_execution.sql
// Going up 5 levels from __tests__ reaches the project root
const ROOT = resolve(__dirname, "../../../../../");
const MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/00008_resolution_agent_atomic_tool_execution.sql",
);

let sql: string;
try {
  sql = readFileSync(MIGRATION_PATH, "utf-8");
} catch {
  throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
}

describe("migration 00008 — structure", () => {
  it("adds current_running_tool_id column to resolution_agents", () => {
    expect(sql).toMatch(
      /ALTER TABLE resolution_agents ADD COLUMN IF NOT EXISTS current_running_tool_id/i,
    );
  });

  it("creates the reserve_resolution_agent_tool_execution function", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION reserve_resolution_agent_tool_execution/i,
    );
  });

  it("function uses SECURITY DEFINER", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
  });

  it("function uses SET search_path = ''", () => {
    expect(sql).toMatch(/SET search_path = ''/);
  });

  it("function uses FOR UPDATE to lock the agent row", () => {
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("revokes execute from PUBLIC", () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM PUBLIC/i,
    );
  });

  it("revokes execute from anon", () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM anon/i,
    );
  });

  it("revokes execute from authenticated", () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution FROM authenticated/i,
    );
  });

  it("grants execute to service_role", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION reserve_resolution_agent_tool_execution TO service_role/i,
    );
  });

  it("validates version in the function", () => {
    expect(sql).toMatch(/Version conflict/i);
  });

  it("validates lifecycle in the function", () => {
    expect(sql).toMatch(/cannot start tool execution/i);
  });

  it("validates budget in the function", () => {
    expect(sql).toMatch(/Insufficient budget/i);
  });

  it("checks for existing execution (idempotent)", () => {
    expect(sql).toMatch(/SELECT \* INTO v_existing_execution/i);
    expect(sql).toMatch(/IF FOUND THEN/);
  });

  it("returns jsonb_build_object for existing execution", () => {
    // SQL is multi-line; match across lines with [^)]* to absorb newlines
    expect(sql).toMatch(/jsonb_build_object\(\s*'kind'\s*,\s*'existing'/);
  });

  it("returns jsonb_build_object for created execution", () => {
    expect(sql).toMatch(/jsonb_build_object\(\s*'kind'\s*,\s*'created'/);
  });

  it("inserts execution into resolution_agent_tool_executions", () => {
    expect(sql).toMatch(
      /INSERT INTO resolution_agent_tool_executions/i,
    );
  });

  it("updates agent with reserved_budget_atomic increment", () => {
    expect(sql).toMatch(
      /reserved_budget_atomic = reserved_budget_atomic \+ p_price_atomic/i,
    );
  });

  it("updates agent with current_running_tool_id = p_tool_id", () => {
    expect(sql).toMatch(
      /current_running_tool_id = p_tool_id/i,
    );
  });

  it("updates agent status to running_tool", () => {
    expect(sql).toMatch(/status = 'running_tool'/i);
  });

  it("increments agent version", () => {
    expect(sql).toMatch(/version = version \+ 1/i);
  });
});

describe("migration 00008 — existing migrations unchanged", () => {
  it("migration 00007 still has the original resolution_agents table", () => {
    const migration07Path = resolve(
      ROOT,
      "supabase/migrations/00007_resolution_agent.sql",
    );
    const migration07 = readFileSync(migration07Path, "utf-8");

    // 00007 must NOT contain current_running_tool_id (that's added in 00008)
    expect(migration07).not.toMatch(/current_running_tool_id/);
  });
});
