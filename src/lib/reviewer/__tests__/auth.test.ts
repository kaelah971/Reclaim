// ---------------------------------------------------------------------------
// Unit tests: reviewer authorization module (auth.ts)
//
// Tests wallet-based allowlist, Supabase-backed nonce challenge/response,
// durable session management, and the full authenticateReviewer flow.
// All viem calls and Supabase calls are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ===========================================================================
// Hoisted mock for Supabase query builder — runs BEFORE any imports so the
// mock factories can close over fully-initialised references.
// ===========================================================================

const { mockQueryBuilder, mockSb } = vi.hoisted(() => {
  /** Internal queue of resolve-values consumed sequentially by .then() */
  const resolveQueue: unknown[] = [];
  const defaultResolve = { data: null, error: null };

  const builder: Record<string, ReturnType<typeof vi.fn>> = {};

  // ------------------------------------------------------------------
  // Proper thenable implementation — called by await / Promise.resolve
  // ------------------------------------------------------------------
  builder.then = vi.fn().mockImplementation(
    (onFulfilled: (v: unknown) => void, onRejected?: (e: unknown) => void) => {
      try {
        const val = resolveQueue.shift() ?? defaultResolve;
        if (onFulfilled) onFulfilled(val);
        return Promise.resolve(val);
      } catch (e: unknown) {
        if (onRejected) onRejected(e);
        return Promise.reject(e);
      }
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (builder as Record<string, unknown>)._queue = resolveQueue;

  // Every chainable method returns the builder itself so that
  //   .from().insert().select().eq()… chains work transparently.
  for (const m of [
    "insert",
    "update",
    "delete",
    "select",
    "eq",
    "is",
    "gt",
    "lt",
    "or",
    "maybeSingle",
  ]) {
    builder[m] = vi.fn(() => builder);
  }

  return {
    mockQueryBuilder: builder as typeof builder & { _queue: unknown[] },
    mockSb: { from: vi.fn(() => builder) },
  };
});

// ===========================================================================
// Mock external modules
// ===========================================================================

vi.mock("viem", () => ({
  recoverMessageAddress: vi.fn(),
  keccak256: vi.fn((_input: string) => `0x${"a".repeat(64)}`),
  stringToHex: vi.fn(
    (input: string) =>
      `0x${[...input].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`,
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => mockSb),
}));

// ===========================================================================
// Static imports (resolved AFTER mocks are registered)
// ===========================================================================

import { recoverMessageAddress } from "viem";
import * as auth from "@/lib/reviewer/auth";

// ===========================================================================
// Constants & helpers
// ===========================================================================

const ALLOWED_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";
const ALLOWED_ADDRESS_UPPER = ALLOWED_ADDRESS.toUpperCase();
const OTHER_ADDRESS = "0x0000000000000000000000000000000000000001";
const INVALID_ADDRESS = "0x123"; // too short
const NOT_AN_ADDRESS = "not-an-address";

/** Build a Request object with an optional Bearer token. */
function buildRequest(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://example.com/api/reviews", { headers });
}

// ===========================================================================
// Test suites
// ===========================================================================

// ---------------------------------------------------------------------------
// Allowlist (sync — no Supabase needed)
// ---------------------------------------------------------------------------

describe("getReviewerAllowlist", () => {
  afterEach(() => {
    delete process.env.REVIEWER_ALLOWLIST;
  });

  it("returns empty set when REVIEWER_ALLOWLIST is not set", () => {
    const result = auth.getReviewerAllowlist();
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it("parses comma-separated addresses correctly", () => {
    process.env.REVIEWER_ALLOWLIST = `${ALLOWED_ADDRESS},${OTHER_ADDRESS}`;
    const result = auth.getReviewerAllowlist();
    expect(result.size).toBe(2);
    expect(result.has(ALLOWED_ADDRESS)).toBe(true);
    expect(result.has(OTHER_ADDRESS)).toBe(true);
  });

  it("filters invalid addresses", () => {
    process.env.REVIEWER_ALLOWLIST = `${ALLOWED_ADDRESS},${INVALID_ADDRESS},${NOT_AN_ADDRESS}, 0xDEAD00000000000000000000000000000000BEEF`;
    const result = auth.getReviewerAllowlist();
    // Only ALLOWED_ADDRESS and the deadbeef address are valid 42-char hex
    expect(result.size).toBe(2);
    expect(result.has(ALLOWED_ADDRESS)).toBe(true);
    expect(result.has("0xdead00000000000000000000000000000000beef")).toBe(true);
    expect(result.has(INVALID_ADDRESS)).toBe(false);
    expect(result.has(NOT_AN_ADDRESS)).toBe(false);
  });
});

describe("isReviewerAllowed", () => {
  afterEach(() => {
    delete process.env.REVIEWER_ALLOWLIST;
  });

  it("returns true for address in allowlist", () => {
    process.env.REVIEWER_ALLOWLIST = ALLOWED_ADDRESS;
    expect(auth.isReviewerAllowed(ALLOWED_ADDRESS)).toBe(true);
  });

  it("returns false for address not in allowlist", () => {
    process.env.REVIEWER_ALLOWLIST = ALLOWED_ADDRESS;
    expect(auth.isReviewerAllowed(OTHER_ADDRESS)).toBe(false);
  });

  it("is case-insensitive", () => {
    process.env.REVIEWER_ALLOWLIST = ALLOWED_ADDRESS;
    expect(auth.isReviewerAllowed(ALLOWED_ADDRESS_UPPER)).toBe(true);
    expect(auth.isReviewerAllowed(ALLOWED_ADDRESS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nonce management (async — Supabase-backed, one .then() per call)
// ---------------------------------------------------------------------------

describe("generateReviewerNonce / consumeReviewerNonce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder._queue.length = 0;
    delete process.env.REVIEWER_ALLOWLIST;
  });

  it("produces unique nonces with 'reclaim-review-' prefix", async () => {
    // generateReviewerNonce → supabase insert → 1 thenable resolution each
    mockQueryBuilder._queue.push({ data: null, error: null });
    const n1 = await auth.generateReviewerNonce();

    mockQueryBuilder._queue.push({ data: null, error: null });
    const n2 = await auth.generateReviewerNonce();

    expect(n1).toMatch(/^reclaim-review-/);
    expect(n2).toMatch(/^reclaim-review-/);
    expect(n1).not.toBe(n2);
  });

  it("consumes valid unexpired nonce (returns true)", async () => {
    // Generate
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // Consume — simulate row found and updated
    mockQueryBuilder._queue.push({ data: { id: 1 }, error: null });
    const result = await auth.consumeReviewerNonce(nonce);
    expect(result).toBe(true);
  });

  it("returns false for unknown nonce", async () => {
    // Consume without prior insert — no matching row
    mockQueryBuilder._queue.push({ data: null, error: null });
    const result = await auth.consumeReviewerNonce(
      "reclaim-review-never-generated",
    );
    expect(result).toBe(false);
  });

  it("returns false for already-consumed nonce", async () => {
    // Generate
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // First consume — row found
    mockQueryBuilder._queue.push({ data: { id: 1 }, error: null });
    const first = await auth.consumeReviewerNonce(nonce);
    expect(first).toBe(true);

    // Second consume — no row (consumed_at already set)
    mockQueryBuilder._queue.push({ data: null, error: null });
    const second = await auth.consumeReviewerNonce(nonce);
    expect(second).toBe(false);
  });

  it("returns false for expired nonce", async () => {
    // Generate
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // Consume — simulate Supabase returning null (expired row filtered out)
    mockQueryBuilder._queue.push({ data: null, error: null });
    const result = await auth.consumeReviewerNonce(nonce);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session management (async — Supabase-backed)
// ---------------------------------------------------------------------------

describe("createReviewerSession / validateReviewerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder._queue.length = 0;
    delete process.env.REVIEWER_ALLOWLIST;
  });

  it("returns token and address (no expiresAt in return type)", async () => {
    // createReviewerSession: fire-and-forget delete (no .then()), then insert (1 .then())
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    expect(session).toHaveProperty("token");
    expect(session).toHaveProperty("address");
    expect(session).not.toHaveProperty("expiresAt");
    expect(session.token).toMatch(/^rs_[a-f0-9]+$/);
    expect(session.address).toBe(ALLOWED_ADDRESS);
  });

  it("returns address for valid token", async () => {
    // Create session
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    // Validate — row found, wallet_address returned
    mockQueryBuilder._queue.push({
      data: { wallet_address: ALLOWED_ADDRESS.toLowerCase() },
      error: null,
    });
    const address = await auth.validateReviewerSession(session.token);
    expect(address).toBe(ALLOWED_ADDRESS.toLowerCase());
  });

  it("returns null for invalid token", async () => {
    // Validate unknown token — no matching row
    mockQueryBuilder._queue.push({ data: null, error: null });
    const address = await auth.validateReviewerSession(
      "rs_nonexistent_token",
    );
    expect(address).toBeNull();
  });

  it("returns null for expired session", async () => {
    // Create session
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    // Validate — simulate expired (no rows match the gt("expires_at") filter)
    mockQueryBuilder._queue.push({ data: null, error: null });
    const address = await auth.validateReviewerSession(session.token);
    expect(address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session revocation (new async function)
// ---------------------------------------------------------------------------

describe("revokeReviewerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder._queue.length = 0;
  });

  it("returns true for valid token", async () => {
    // Create session
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    // Revoke — update succeeds (no error)
    mockQueryBuilder._queue.push({ data: null, error: null });
    const result = await auth.revokeReviewerSession(session.token);
    expect(result).toBe(true);
  });

  it("validate returns null for revoked session", async () => {
    // Create session
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    // Revoke it
    mockQueryBuilder._queue.push({ data: null, error: null });
    await auth.revokeReviewerSession(session.token);

    // Validate — revoked session not found (revoked_at IS NOT NULL filtered out)
    mockQueryBuilder._queue.push({ data: null, error: null });
    const address = await auth.validateReviewerSession(session.token);
    expect(address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full authentication flow (async)
// ---------------------------------------------------------------------------

describe("authenticateReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder._queue.length = 0;
    process.env.REVIEWER_ALLOWLIST = ALLOWED_ADDRESS;
  });

  afterEach(() => {
    delete process.env.REVIEWER_ALLOWLIST;
  });

  it("fails with invalid signature (empty)", async () => {
    // generate nonce → 1 supabase call
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // authenticate: consume nonce (1 .then()) → succeeds, then signature check fails
    mockQueryBuilder._queue.push({ data: { id: 1 }, error: null });

    const message = "test message";
    const result = await auth.authenticateReviewer("0x", message, nonce);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Signature is missing");
  });

  it("fails when address is not in allowlist", async () => {
    // Generate nonce
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // Consume nonce succeeds
    mockQueryBuilder._queue.push({ data: { id: 1 }, error: null });
    // viem recovers a disallowed address
    vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
      "0xdead00000000000000000000000000000000dead",
    );

    const message = "test message";
    const result = await auth.authenticateReviewer(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1234567890abcdef1234567890abcdef1234567890ab",
      message,
      nonce,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not authorized");
  });

  it("fails with expired or already-used nonce", async () => {
    // Generate nonce
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // Consume nonce fails — no matching row (already used or expired)
    mockQueryBuilder._queue.push({ data: null, error: null });

    const message = "test message";
    const result = await auth.authenticateReviewer(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1234567890abcdef1234567890abcdef1234567890ab",
      message,
      nonce,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Nonce");
  });

  it("succeeds with valid signature from allowed address", async () => {
    // 1. Generate nonce → supabase insert
    mockQueryBuilder._queue.push({ data: null, error: null });
    const nonce = await auth.generateReviewerNonce();

    // 2. authenticate: consume nonce → row found
    mockQueryBuilder._queue.push({ data: { id: 1 }, error: null });
    // 3. viem recovers allowed address
    vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED_ADDRESS);
    // 4. create session → supabase insert
    mockQueryBuilder._queue.push({ data: null, error: null });

    const message = "test message";
    const result = await auth.authenticateReviewer(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd1234567890abcdef1234567890abcdef1234567890ab",
      message,
      nonce,
    );
    expect(result.success).toBe(true);
    expect(result.address).toBe(ALLOWED_ADDRESS);
    expect(result.sessionToken).toMatch(/^rs_[a-f0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// API route guard (async)
// ---------------------------------------------------------------------------

describe("requireReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryBuilder._queue.length = 0;
  });

  it("throws UNAUTHORIZED for missing header", async () => {
    const req = buildRequest(); // no Authorization header
    await expect(auth.requireReviewer(req)).rejects.toThrow("UNAUTHORIZED");
  });

  it("throws UNAUTHORIZED for invalid token", async () => {
    // validate returns null — no matching session row
    mockQueryBuilder._queue.push({ data: null, error: null });

    const req = buildRequest("rs_bad_token");
    await expect(auth.requireReviewer(req)).rejects.toThrow("UNAUTHORIZED");
  });

  it("returns address for valid token", async () => {
    // Create a valid session first
    mockQueryBuilder._queue.push({ data: null, error: null });
    const session = await auth.createReviewerSession(ALLOWED_ADDRESS);

    // requireReviewer → validate → row found
    mockQueryBuilder._queue.push({
      data: { wallet_address: ALLOWED_ADDRESS.toLowerCase() },
      error: null,
    });

    const req = buildRequest(session.token);
    const address = await auth.requireReviewer(req);
    expect(address).toBe(ALLOWED_ADDRESS.toLowerCase());
  });
});
