import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const migration = readFileSync(
  resolve(__dirname, "../../../../supabase/migrations/00016_evidence_review_immutability.sql"),
  "utf8",
);

describe("migration 00016 — evidence review immutability", () => {
  it("creates a durable review lock and backfills existing reviews", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS evidence_review_locks/i);
    expect(migration).toMatch(/INSERT INTO evidence_review_locks/i);
    expect(migration).toMatch(/JOIN x402_payments/i);
    expect(migration).toMatch(/JOIN reviewer_decisions|FROM reviewer_decisions/i);
  });

  it("locks reviewer/evidence races and rejects all metadata mutations", () => {
    expect(migration).toMatch(/reviewer_decision_starts_evidence_lock/i);
    expect(migration).toMatch(/FOR UPDATE/i);
    expect(migration).toMatch(/FOR SHARE/i);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON evidence_metadata/i);
    expect(migration).toMatch(/immutable after reviewer review begins/i);
  });
});
