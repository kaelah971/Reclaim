// ---------------------------------------------------------------------------
// Lease Operations — pure functions and helpers for distributed worker leases
// ---------------------------------------------------------------------------

import type { SecureTokenGenerator, LeaseContext } from "./types";
import { defaultTokenGenerator, DEFAULT_LEASE_DURATION_MS } from "./types";

/**
 * Generate a cryptographically secure lease token.
 * Uses crypto.randomUUID() by default, or a custom generator for testing.
 */
export function generateLeaseToken(generator?: SecureTokenGenerator): string {
  return (generator ?? defaultTokenGenerator).generateToken();
}

/**
 * Compute the epoch-millisecond expiry timestamp for a lease given a
 * start time and optional duration.
 */
export function computeLeaseExpiry(now: number, durationMs?: number): number {
  return now + (durationMs ?? DEFAULT_LEASE_DURATION_MS);
}

/**
 * Check whether a lease is currently valid (exists and not expired).
 * `leaseExpiresAt` is an ISO-8601 string or null.
 */
export function isLeaseActive(
  leaseExpiresAt: string | null,
  now: number,
): boolean {
  if (!leaseExpiresAt) return false;
  const expiryTime = new Date(leaseExpiresAt).getTime();
  // Lease is active if expiry is strictly after now
  return !isNaN(expiryTime) && expiryTime > now;
}

/**
 * Create a LeaseContext object representing a held lease.
 */
export function createLeaseContext(
  agentId: string,
  ownerToken: string,
  now: number,
  durationMs?: number,
): LeaseContext {
  return {
    agentId,
    ownerToken,
    acquiredAt: now,
    expiresAt: computeLeaseExpiry(now, durationMs),
  };
}
