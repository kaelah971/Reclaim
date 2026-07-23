// ---------------------------------------------------------------------------
// Unit tests: reviewer decision store (store.ts)
//
// Tests the Supabase persistence layer for reviewer decision CRUD operations.
// All Supabase calls are mocked via a chainable query builder.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock for @/lib/supabase/client
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "@/lib/supabase/client";

// Re-imported store module — reset per beforeEach
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: any;

// ---------------------------------------------------------------------------
// Mock Supabase query builder
//
// Supabase uses a chainable builder API where each method returns the builder
// itself. The builder is "thenable" so `await builder` resolves to
// { data, error }. Methods like .maybeSingle() and .single() return promises.
// ---------------------------------------------------------------------------

interface MockQueryBuilder {
  _thenableResult: Promise<{ data: unknown; error: unknown }>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

function createMockQueryBuilder(): MockQueryBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    _thenableResult: Promise.resolve({ data: null, error: null }),

    // Thenable implementation
    then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
      return builder._thenableResult.then(resolve, reject);
    },
    catch(reject: (reason: unknown) => void) {
      return builder._thenableResult.catch(reject);
    },

    // Terminal methods
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  // Chainable methods — each returns the builder itself for fluent chaining
  const chainableMethods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "gt",
    "lt",
    "gte",
    "lte",
    "in",
    "not",
    "is",
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "match",
    "ilike",
    "like",
  ];

  for (const method of chainableMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  return builder;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const REVIEWER_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const WRONG_ADDRESS = "0xdead00000000000000000000000000000000dead";
const PAYMENT_ID = "pay_test_123";
const DECISION_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeDraftRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: DECISION_ID,
    payment_identifier: PAYMENT_ID,
    dispute_identifier: null,
    reviewer_address: REVIEWER_ADDRESS,
    reviewer_auth_method: "wallet_signature",
    decision: "release_to_worker",
    rationale: "Test rationale — at least 20 characters long.",
    evidence_notes: null,
    conditions: null,
    client_amount: null,
    worker_amount: null,
    decision_status: "draft",
    source_brief_version: null,
    source_request_hash: null,
    onchain_payment_id: null,
    chain_id: null,
    contract_address: null,
    onchain_snapshot: null,
    created_at: "2025-06-01T12:00:00Z",
    updated_at: "2025-06-01T12:00:00Z",
    submitted_at: null,
    finalized_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

let mockBuilder: MockQueryBuilder;
let mockClient: { from: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetModules();

  // Fresh builder for each test
  mockBuilder = createMockQueryBuilder();
  mockClient = { from: vi.fn().mockReturnValue(mockBuilder) };

  // The mocked getSupabaseClient always returns our mockClient
  vi.mocked(getSupabaseClient).mockReturnValue(mockClient as unknown as ReturnType<typeof getSupabaseClient>);

  store = await import("@/lib/reviewer/store");
});

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("createDraftDecision", () => {
  it("creates a draft with correct fields", async () => {
    const draftRecord = makeDraftRecord();
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: draftRecord, error: null });

    const result = await store.createDraftDecision({
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "release_to_worker",
      rationale: "Test rationale — at least 20 characters long.",
    });

    expect(result).toEqual(draftRecord);
    expect(result.decision).toBe("release_to_worker");
    expect(result.reviewer_address).toBe(REVIEWER_ADDRESS);
    expect(result.payment_identifier).toBe(PAYMENT_ID);
    expect(result.reviewer_auth_method).toBe("wallet_signature");
  });

  it("returns null when Supabase returns an error (DB constraint violation)", async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'new row violates check constraint "reviewer_decisions_decision_check"' },
    });

    const result = await store.createDraftDecision({
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "release_to_worker",
      rationale: "Valid rationale — sufficiently long.",
    });

    expect(result).toBeNull();
  });

  it("sets decision_status to 'draft'", async () => {
    const draftRecord = makeDraftRecord();
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: draftRecord, error: null });

    const result = await store.createDraftDecision({
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "refund_to_client",
      rationale: "Client deserves a refund per contract terms outlined.",
    });

    expect(result).not.toBeNull();
    expect(result!.decision_status).toBe("draft");
  });
});

describe("submitDecision", () => {
  it("transitions draft to ready_for_execution", async () => {
    const submittedRecord = makeDraftRecord({
      decision_status: "ready_for_execution",
      submitted_at: "2025-06-01T12:05:00Z",
      finalized_at: "2025-06-01T12:05:00Z",
      updated_at: "2025-06-01T12:05:00Z",
    });
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: submittedRecord, error: null });

    const result = await store.submitDecision(DECISION_ID, REVIEWER_ADDRESS);

    expect(result).not.toBeNull();
    expect(result!.decision_status).toBe("ready_for_execution");
    expect(result!.submitted_at).not.toBeNull();
    expect(result!.finalized_at).not.toBeNull();
  });

  it("returns null when decision is not in draft status", async () => {
    // Simulate: the update with eq("decision_status", "draft") finds no rows
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await store.submitDecision(DECISION_ID, REVIEWER_ADDRESS);

    expect(result).toBeNull();
  });

  it("returns null when reviewer address does not match", async () => {
    // The query filters on BOTH id AND reviewer_address — no match returns null
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await store.submitDecision(DECISION_ID, WRONG_ADDRESS);

    expect(result).toBeNull();
  });
});

describe("updateDraftDecision", () => {
  it("updates draft fields and returns updated record", async () => {
    const updatedRecord = makeDraftRecord({
      decision: "needs_more_evidence",
      rationale: "Updated rationale — requesting additional documentation from both parties.",
      evidence_notes: "Worker needs to submit timestamps.",
      updated_at: "2025-06-01T13:00:00Z",
    });
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: updatedRecord, error: null });

    const result = await store.updateDraftDecision(DECISION_ID, REVIEWER_ADDRESS, {
      decision: "needs_more_evidence",
      rationale: "Updated rationale — requesting additional documentation from both parties.",
      evidence_notes: "Worker needs to submit timestamps.",
    });

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("needs_more_evidence");
    expect(result!.rationale).toContain("additional documentation");
    expect(result!.evidence_notes).toBe("Worker needs to submit timestamps.");
  });

  it("returns null when decision is not in draft status", async () => {
    // The query filters on decision_status === "draft" — no match returns null
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await store.updateDraftDecision(DECISION_ID, REVIEWER_ADDRESS, {
      rationale: "Attempted update on a submitted decision.",
    });

    expect(result).toBeNull();
  });
});

describe("getDecisionsForPayment", () => {
  it("returns empty array for unknown payment", async () => {
    // When Supabase returns no data (empty array not possible via maybeSingle;
    // getDecisionsForPayment awaits the builder directly, so we use _thenableResult)
    mockBuilder._thenableResult = Promise.resolve({ data: null, error: null });

    const results = await store.getDecisionsForPayment("non_existent_payment");
    expect(results).toEqual([]);
  });

  it("returns decisions ordered by created_at descending", async () => {
    const older = makeDraftRecord({
      id: "550e8400-e29b-41d4-a716-446655440001",
      created_at: "2025-06-01T10:00:00Z",
    });
    const newer = makeDraftRecord({
      id: "550e8400-e29b-41d4-a716-446655440002",
      created_at: "2025-06-01T14:00:00Z",
    });

    // The store calls .order("created_at", { ascending: false }),
    // which returns the builder. .limit is NOT called, so the builder
    // is directly awaited and its _thenableResult is used.
    mockBuilder._thenableResult = Promise.resolve({ data: [newer, older], error: null });

    const results = await store.getDecisionsForPayment(PAYMENT_ID);

    expect(results).toHaveLength(2);
    // Verify descending order (newest first)
    expect(results[0].created_at).toBe("2025-06-01T14:00:00Z");
    expect(results[1].created_at).toBe("2025-06-01T10:00:00Z");
  });
});

describe("supersedeDecision", () => {
  it("marks old decision as superseded and creates a new draft", async () => {
    // First call: update to supersede (directly awaited, result unused)
    // We don't need to configure _thenableResult for this — default is fine.

    // Second call: createDraftDecision via .maybeSingle()
    const newDraftRecord = makeDraftRecord({
      id: "550e8400-e29b-41d4-a716-446655440003",
      decision: "partial_resolution",
      rationale: "New partial resolution — splitting funds 60/40.",
      client_amount: "600",
      worker_amount: "400",
    });
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: newDraftRecord, error: null });

    const result = await store.supersedeDecision(DECISION_ID, REVIEWER_ADDRESS, {
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "partial_resolution",
      rationale: "New partial resolution — splitting funds 60/40.",
      client_amount: "600",
      worker_amount: "400",
    });

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("partial_resolution");
    expect(result!.decision_status).toBe("draft");
    expect(result!.client_amount).toBe("600");
    expect(result!.worker_amount).toBe("400");
  });
});

describe("getReviewablePayments", () => {
  it("returns payments with brief and appropriate states", async () => {
    // getReviewablePayments queries x402_payments where state IN (...)
    // and brief IS NOT NULL. The builder is directly awaited.
    mockBuilder._thenableResult = Promise.resolve({
      data: [
        { payment_identifier: "pay_001" },
        { payment_identifier: "pay_002" },
      ],
      error: null,
    });

    const results = await store.getReviewablePayments();

    expect(results).toEqual(["pay_001", "pay_002"]);
  });

  it("returns empty array when no reviewable payments exist", async () => {
    mockBuilder._thenableResult = Promise.resolve({ data: [], error: null });

    const results = await store.getReviewablePayments();
    expect(results).toEqual([]);
  });
});

describe("DB-level validation", () => {
  it("decision VALUES are validated — DB rejects invalid decision string", async () => {
    // The store passes the decision string as-is to Supabase.
    // The DB CHECK constraint rejects invalid values. We simulate
    // Supabase returning a constraint-violation error.
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'new row violates check constraint "reviewer_decisions_decision_check"',
        code: "23514",
      },
    });

    const result = await store.createDraftDecision({
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "invalid_value_xyz" as "release_to_worker",
      rationale: "Some rationale that is long enough to pass application validation.",
    });

    // The store returns null on error
    expect(result).toBeNull();
  });

  it("partial resolution without amounts is rejected at DB level", async () => {
    // The DB has a CHECK constraint: decision != 'partial_resolution'
    // OR (client_amount IS NOT NULL AND worker_amount IS NOT NULL).
    // We simulate Supabase returning a constraint-violation error.
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'new row violates check constraint "partial_amounts_required"',
        code: "23514",
      },
    });

    const result = await store.createDraftDecision({
      payment_identifier: PAYMENT_ID,
      reviewer_address: REVIEWER_ADDRESS,
      decision: "partial_resolution",
      rationale: "Partial resolution rationale — at least twenty chars.",
      // client_amount and worker_amount intentionally omitted
    });

    expect(result).toBeNull();
  });
});

// Total: 14 tests (tests 23–36)
