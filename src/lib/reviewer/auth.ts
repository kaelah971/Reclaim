// ---------------------------------------------------------------------------
// I6A.1: Durable reviewer authorization — Supabase-backed nonces & sessions
//
// Server-only. Nonces and sessions survive process restarts.
// Tokens are hashed before storage — raw tokens never persisted.
// ---------------------------------------------------------------------------

import { recoverMessageAddress, keccak256, stringToHex } from "viem";
import { getSupabaseClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export function getReviewerAllowlist(): Set<string> {
  const raw = process.env.REVIEWER_ALLOWLIST || "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  return new Set(addresses);
}

export function isReviewerAllowed(address: string): boolean {
  return getReviewerAllowlist().has(address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Hashing helpers — raw tokens are NEVER stored
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return keccak256(stringToHex(token));
}

// ---------------------------------------------------------------------------
// Durable nonce management (Supabase-backed)
// ---------------------------------------------------------------------------

const NONCE_EXPIRY_MINUTES = 5;

export async function generateReviewerNonce(): Promise<string> {
  const nonce = `reclaim-review-${crypto.randomUUID()}`;
  const nonceHash = hashToken(nonce);
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const sb = getSupabaseClient();
  const { error } = await sb
    .from("reviewer_auth_nonces")
    .insert({
      nonce_hash: nonceHash,
      expires_at: expiresAt,
    });

  // Cleanup expired nonces asynchronously (fire-and-forget)
  sb.from("reviewer_auth_nonces")
    .delete()
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("[reviewer/auth] Failed to persist nonce:", error.message);
    // Fallback: still return the nonce even if persistence fails;
    // the consume step will reject it if the record doesn't exist.
  }

  return nonce;
}

export async function consumeReviewerNonce(nonce: string): Promise<boolean> {
  const nonceHash = hashToken(nonce);
  const sb = getSupabaseClient();

  // Atomically consume: set consumed_at only if not yet consumed and not expired
  const { data, error } = await sb
    .from("reviewer_auth_nonces")
    .update({ consumed_at: new Date().toISOString() })
    .eq("nonce_hash", nonceHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[reviewer/auth] Nonce consumption failed:", error.message);
    return false;
  }

  return !!data; // data exists = row found and updated = nonce was valid
}

// ---------------------------------------------------------------------------
// Durable session management (Supabase-backed)
// ---------------------------------------------------------------------------

const SESSION_EXPIRY_HOURS = 1;

function generateSessionToken(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rs_${hex}`;
}

export interface ReviewerSession {
  token: string;
  address: string;
}

export async function createReviewerSession(address: string): Promise<ReviewerSession> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const normalizedAddress = address.toLowerCase();

  const sb = getSupabaseClient();

  // Cleanup expired/revoked sessions
  void sb.from("reviewer_sessions")
    .delete()
    .or(`expires_at.lt.${new Date().toISOString()},revoked_at.not.is.null`);

  const { error } = await sb
    .from("reviewer_sessions")
    .insert({
      wallet_address: normalizedAddress,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

  if (error) {
    console.error("[reviewer/auth] Failed to persist session:", error.message);
  }

  return { token, address: normalizedAddress };
}

export async function validateReviewerSession(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("reviewer_sessions")
    .select("wallet_address")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return data.wallet_address;
}

export async function revokeReviewerSession(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const sb = getSupabaseClient();

  const { error } = await sb
    .from("reviewer_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("revoked_at", null);

  return !error;
}

// ---------------------------------------------------------------------------
// Full authorization flow
// ---------------------------------------------------------------------------

export interface AuthChallenge {
  nonce: string;
  message: string;
}

export async function createAuthChallenge(): Promise<AuthChallenge> {
  const nonce = await generateReviewerNonce();
  const message = [
    "Reclaim reviewer authentication",
    "Sign this message to verify you are an authorized reviewer.",
    `Nonce: ${nonce}`,
    `Expires: ${new Date(Date.now() + NONCE_EXPIRY_MINUTES * 60 * 1000).toISOString()}`,
  ].join("\n");
  return { nonce, message };
}

export interface AuthResult {
  success: boolean;
  address?: string;
  sessionToken?: string;
  error?: string;
}

export async function authenticateReviewer(
  signature: string,
  message: string,
  nonce: string,
): Promise<AuthResult> {
  // 1. Consume nonce atomically (anti-replay, survives restart)
  if (!(await consumeReviewerNonce(nonce))) {
    return { success: false, error: "Nonce is invalid, expired, or already used." };
  }

  // 2. Verify signature
  if (!signature || signature === "0x") {
    return { success: false, error: "Signature is missing." };
  }
  if (!message) {
    return { success: false, error: "Signed message is missing." };
  }

  let recoveredAddress: string;
  try {
    recoveredAddress = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    return { success: false, error: `Signature verification failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }

  // 3. Check allowlist
  if (!isReviewerAllowed(recoveredAddress)) {
    console.log(`[reviewer/auth] Address ${recoveredAddress} is not in the reviewer allowlist`);
    return { success: false, error: "Address is not authorized as a reviewer." };
  }

  // 4. Create durable session
  const session = await createReviewerSession(recoveredAddress);
  console.log(`[reviewer/auth] Reviewer authenticated: ${recoveredAddress}`);

  return {
    success: true,
    address: recoveredAddress,
    sessionToken: session.token,
  };
}

// ---------------------------------------------------------------------------
// Server-side authorization guard for API routes
// ---------------------------------------------------------------------------

export async function requireReviewer(request: Request): Promise<string> {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    throw new Error("UNAUTHORIZED");
  }

  const address = await validateReviewerSession(token);
  if (!address) {
    throw new Error("UNAUTHORIZED");
  }

  return address;
}
