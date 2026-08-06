import { describe, it, expect } from "vitest";
import {
  generateLeaseToken,
  computeLeaseExpiry,
  isLeaseActive,
  createLeaseContext,
} from "../lease";
import type { SecureTokenGenerator } from "../types";

describe("generateLeaseToken", () => {
  it("returns a non-empty string", () => {
    const token = generateLeaseToken();
    expect(token.length).toBeGreaterThan(0);
  });

  it("is cryptographically random (unique per call)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      tokens.add(generateLeaseToken());
    }
    expect(tokens.size).toBe(50);
  });

  it("uses custom token generator when provided", () => {
    const mockGenerator: SecureTokenGenerator = {
      generateToken: () => "fixed-token-123",
    };
    const token = generateLeaseToken(mockGenerator);
    expect(token).toBe("fixed-token-123");
  });

  it("generates UUID-format tokens by default", () => {
    const token = generateLeaseToken();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(token).toMatch(uuidRegex);
  });
});

describe("computeLeaseExpiry", () => {
  it("adds default duration to now", () => {
    const now = 1_000_000;
    const expiry = computeLeaseExpiry(now);
    expect(expiry).toBe(now + 60_000);
  });

  it("adds custom duration to now", () => {
    const now = 1_000_000;
    const duration = 30_000;
    const expiry = computeLeaseExpiry(now, duration);
    expect(expiry).toBe(now + duration);
  });

  it("expiry is always after now", () => {
    const now = Date.now();
    const expiry = computeLeaseExpiry(now);
    expect(expiry).toBeGreaterThan(now);
  });

  it("expiry is exactly now + duration", () => {
    for (const [now, dur] of [
      [0, 100],
      [1000000, 60000],
      [9999999999, 1],
    ]) {
      expect(computeLeaseExpiry(now, dur)).toBe(now + dur);
    }
  });
});

describe("isLeaseActive", () => {
  it("returns false for null lease", () => {
    expect(isLeaseActive(null, 1_000_000)).toBe(false);
  });

  it("returns true when lease has not expired", () => {
    const now = 1_000_000;
    const futureExpiry = new Date(now + 60_000).toISOString();
    expect(isLeaseActive(futureExpiry, now)).toBe(true);
  });

  it("returns false when lease has expired", () => {
    const now = 1_000_000;
    const pastExpiry = new Date(now - 1).toISOString();
    expect(isLeaseActive(pastExpiry, now)).toBe(false);
  });

  it("returns false when expiry exactly equals now", () => {
    const now = 1_000_000;
    const exactExpiry = new Date(now).toISOString();
    expect(isLeaseActive(exactExpiry, now)).toBe(false);
  });

  it("handles edge case: now is slightly after expiry", () => {
    const now = 1_000_000_001;
    const expiry = new Date(1_000_000_000).toISOString();
    expect(isLeaseActive(expiry, now)).toBe(false);
  });
});

describe("createLeaseContext", () => {
  it("creates context with correct agentId", () => {
    const ctx = createLeaseContext("agt_test", "token-123", 1_000_000);
    expect(ctx.agentId).toBe("agt_test");
  });

  it("creates context with correct ownerToken", () => {
    const ctx = createLeaseContext("agt_test", "token-123", 1_000_000);
    expect(ctx.ownerToken).toBe("token-123");
  });

  it("sets acquiredAt to now", () => {
    const now = 1_000_000;
    const ctx = createLeaseContext("agt_test", "token-123", now);
    expect(ctx.acquiredAt).toBe(now);
  });

  it("sets expiresAt to now + default duration", () => {
    const now = 1_000_000;
    const ctx = createLeaseContext("agt_test", "token-123", now);
    expect(ctx.expiresAt).toBe(now + 60_000);
  });

  it("sets expiresAt to now + custom duration", () => {
    const now = 1_000_000;
    const ctx = createLeaseContext("agt_test", "token-123", now, 10_000);
    expect(ctx.expiresAt).toBe(now + 10_000);
  });
});
