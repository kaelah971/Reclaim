// ---------------------------------------------------------------------------
// Migration 00007 — static SQL structure inspection
//
// Verifies the migration file contains all required elements without
// connecting to a live database.  Prevents LOWER() regression inside
// inline UNIQUE constraints.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../../../");
const MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/00007_resolution_agent.sql",
);

let sql: string;
try {
  sql = readFileSync(MIGRATION_PATH, "utf-8");
} catch {
  throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
}

describe("migration 00007 — structure", () => {
  it("creates resolution_agent_status enum", () => {
    expect(sql).toMatch(/CREATE TYPE resolution_agent_status AS ENUM/i);
  });

  it("creates resolution_agents table", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resolution_agents/i);
  });

  it("creates resolution_agent_events table", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resolution_agent_events/i);
  });

  it("creates resolution_agent_tool_executions table", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resolution_agent_tool_executions/i);
  });

  it("creates resolution_agent_evidence_requests table", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resolution_agent_evidence_requests/i);
  });

  it("uses CREATE UNIQUE INDEX for case-identity constraint (NOT inline UNIQUE with LOWER)", () => {
    // After the fix: the unique constraint uses CREATE UNIQUE INDEX
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ra_one_agent_per_case/i);
    // Regression guard: LOWER must NOT appear inside an inline UNIQUE table constraint
    const inlineUniqueWithLower = /CONSTRAINT\s+\w+\s+UNIQUE\s*\([^)]*LOWER/i;
    expect(sql).not.toMatch(inlineUniqueWithLower);
  });

  it("enables RLS on all four tables", () => {
    expect(sql).toMatch(/ALTER TABLE resolution_agents ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE resolution_agent_events ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE resolution_agent_tool_executions ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE resolution_agent_evidence_requests ENABLE ROW LEVEL SECURITY/i);
  });

  it("creates service_role policies for all tables", () => {
    expect(sql).toMatch(/service_role_all_resolution_agents/i);
    expect(sql).toMatch(/service_role_all_events/i);
    expect(sql).toMatch(/service_role_all_tool_executions/i);
    expect(sql).toMatch(/service_role_all_evidence_requests/i);
  });

  it("revokes anon and authenticated access", () => {
    expect(sql).toMatch(/REVOKE ALL ON resolution_agents FROM anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON resolution_agent_tool_executions FROM anon, authenticated/i);
  });

  it("grants service_role access to all tables", () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agents TO service_role/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolution_agent_events TO service_role/i);
  });

  it("includes budget CHECK constraints", () => {
    expect(sql).toMatch(/spent_budget_atomic <= approved_budget_atomic/i);
    expect(sql).toMatch(/spent_budget_atomic \+ reserved_budget_atomic <= approved_budget_atomic/i);
  });
});
