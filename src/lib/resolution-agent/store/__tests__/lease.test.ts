import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client factories
// ---------------------------------------------------------------------------

const RUNNABLE_STATUSES = [
  "active", "running_tool", "waiting_for_evidence",
  "waiting_for_human_approval", "failed_recoverable",
];

const NON_RUNNABLE = [
  "paused", "closing", "closed", "ready_for_human_review",
  "draft", "awaiting_funding", "funded", "awaiting_activation",
  "budget_exhausted", "expired",
];

const AGENT_ID = "agt_test_lease";
const NOW = 1_700_000_000;
const LEASE_DURATION = 60_000;
const OWNER_TOKEN = "lease-owner-token-abc";
const EXPIRES_AT = new Date(NOW + LEASE_DURATION).toISOString();

function makeRow(overrides: Record<string, unknown> = {}) {
  return { agent_id: AGENT_ID, status: "active", lease_owner: null, lease_expires_at: null, ...overrides };
}

type MockClient = Record<string, unknown>;

/**
 * Creates a mock Supabase client where the SELECT returns `row` and
 * the UPDATE succeeds, returning a row with our new owner token.
 * The client records which filters were applied so tests can inspect them.
 */
function mockAcquireSuccess(row: Record<string, unknown>): {
  client: MockClient;
  filters: string[];
} {
  const filters: string[] = [];

  function makeUpdateChain() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = {
      eq: (_col: unknown, _val: unknown) => { filters.push(`eq:${_col}`); return handler; },
      is: (_col: unknown, _val: unknown) => { filters.push(`is:${_col}`); return handler; },
      in: (_col: unknown, _vals: unknown) => { filters.push(`in:${_col}`); return handler; },
      lte: (_col: unknown, _val: unknown) => { filters.push(`lte:${_col}`); return handler; },
      select: () => handler,
      maybeSingle: () => Promise.resolve({
        data: { lease_owner: OWNER_TOKEN, lease_expires_at: EXPIRES_AT, status: "active" },
        error: null,
      }),
    };
    return handler;
  }

  return {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
        }),
        update: () => makeUpdateChain(),
      }),
    },
    filters,
  };
}

function makeChain(result: { data: unknown; error: null }): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: any = {
    eq: () => h, is: () => h, in: () => h, lte: () => h,
    select: () => h, maybeSingle: () => Promise.resolve(result),
  };
  return h;
}

function mockAcquireFail(row: Record<string, unknown>): MockClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
      }),
      update: () => makeChain({ data: null, error: null }),
    }),
  };
}

function mockAcquireFastFail(row: Record<string, unknown>): MockClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
      }),
      // update should not be called for fast-path rejection
      update: () => { throw new Error("update should not be called"); },
    }),
  };
}

// ---------------------------------------------------------------------------
// Null semantics
// ---------------------------------------------------------------------------

describe("tryAcquireAgentLease — null semantics", () => {
  it("unleased acquisition includes IS NULL filter", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, filters } = mockAcquireSuccess(makeRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    const hasIsNull = filters.some((f) => f === "is:lease_owner");
    expect(hasIsNull).toBe(true);
  });

  it("unleased acquisition includes status IN filter", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, filters } = mockAcquireSuccess(makeRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    const hasStatusIn = filters.some((f) => f === "in:status");
    expect(hasStatusIn).toBe(true);
  });

  it("unleased row can be acquired", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client } = mockAcquireSuccess(makeRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe(AGENT_ID);
    expect(result!.ownerToken).toBe(OWNER_TOKEN);
  });

  it("already-owned unexpired row is rejected (fast-path)", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const client = mockAcquireFastFail(makeRow({
      lease_owner: "other-owner",
      lease_expires_at: new Date(NOW + 10000).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Renewal race
// ---------------------------------------------------------------------------

describe("tryAcquireAgentLease — renewal race", () => {
  it("stale acquisition of expired lease fails after concurrent renewal (0 rows)", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    // Simulate: row was expired when read, but renewal extended it.
    // The UPDATE with .lte("lease_expires_at", nowISO) must match 0 rows.
    const client = mockAcquireFail(makeRow({
      lease_owner: "original-owner",
      lease_expires_at: new Date(NOW - 5000).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });

  it("expired lease acquisition includes lte filter on lease_expires_at", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, filters } = mockAcquireSuccess(makeRow({
      lease_owner: "old-owner",
      lease_expires_at: new Date(NOW - 10000).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    const hasLte = filters.some((f) => f === "lte:lease_expires_at");
    expect(hasLte).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Status race
// ---------------------------------------------------------------------------

describe("tryAcquireAgentLease — status race", () => {
  it("update includes status IN predicate", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client, filters } = mockAcquireSuccess(makeRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(filters).toContain("in:status");
  });

  it("status changed to paused → 0 rows, returns null", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const client = mockAcquireFail(makeRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });

  NON_RUNNABLE.forEach((status) => {
    it(`status "${status}" rejected in fast-path`, async () => {
      const { SupabaseResolutionAgentStore } = await import("../supabase");
      const client = mockAcquireFastFail(makeRow({ status }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = new SupabaseResolutionAgentStore(client as any);
      const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Expired-predicate boundary
// ---------------------------------------------------------------------------

describe("tryAcquireAgentLease — expired-predicate boundary", () => {
  it("expired lease can be acquired", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client } = mockAcquireSuccess(makeRow({
      lease_owner: "old-owner",
      lease_expires_at: new Date(NOW - 5000).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe(AGENT_ID);
  });

  it("future unexpired lease cannot be acquired", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const client = mockAcquireFastFail(makeRow({
      lease_owner: "active-owner",
      lease_expires_at: new Date(NOW + 30000).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });

  it("exact-expiry (lease_expires_at === now) can be acquired", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const { client } = mockAcquireSuccess(makeRow({
      lease_owner: "old-owner",
      lease_expires_at: new Date(NOW).toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Returned-row verification
// ---------------------------------------------------------------------------

describe("tryAcquireAgentLease — return validation", () => {
  it("returned row with unexpected owner fails closed", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: makeRow(), error: null }) }),
        }),
        update: () => makeChain({
          data: { lease_owner: "wrong-owner", lease_expires_at: EXPIRES_AT, status: "active" },
          error: null,
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });

  it("returned row with non-runnable status is rejected", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: makeRow(), error: null }) }),
        }),
        update: () => makeChain({
          data: { lease_owner: OWNER_TOKEN, lease_expires_at: EXPIRES_AT, status: "paused" },
          error: null,
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    const result = await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Renewal atomicity
// ---------------------------------------------------------------------------

describe("renewAgentLease — atomicity", () => {
  it("renewal includes status IN predicate", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    const filters: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = {
      eq: (col: string) => { filters.push(`eq:${col}`); return handler; },
      in: (col: string) => { filters.push(`in:${col}`); return handler; },
    };

    const client = { from: () => ({ update: () => handler }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.renewAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(filters).toContain("eq:agent_id");
    expect(filters).toContain("eq:lease_owner");
    expect(filters).toContain("in:status");
  });
});

// ---------------------------------------------------------------------------
// Domain safety
// ---------------------------------------------------------------------------

describe("lease operations — domain safety", () => {
  it("acquisition update data does not include status", async () => {
    const { SupabaseResolutionAgentStore } = await import("../supabase");
    let updateData: Record<string, unknown> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = {
      eq: () => handler, is: () => handler, in: () => handler, lte: () => handler,
      select: () => handler,
      maybeSingle: () => Promise.resolve({
        data: { lease_owner: OWNER_TOKEN, lease_expires_at: EXPIRES_AT, status: "active" },
        error: null,
      }),
    };

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: makeRow(), error: null }) }),
        }),
        update: (data: Record<string, unknown>) => { updateData = data; return handler; },
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SupabaseResolutionAgentStore(client as any);
    await store.tryAcquireAgentLease(AGENT_ID, OWNER_TOKEN, NOW);

    expect(updateData).not.toBeNull();
    expect(updateData!).not.toHaveProperty("status");
    expect(updateData!).toHaveProperty("lease_owner");
    expect(updateData!).toHaveProperty("lease_expires_at");
    expect(updateData!).toHaveProperty("updated_at");
  });
});
