import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;
let supabaseConfigured: boolean | null = null;

function getSupabaseKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function isSupabaseConfigured(): boolean {
  if (supabaseConfigured !== null) return supabaseConfigured;
  supabaseConfigured = !!(process.env.SUPABASE_URL && getSupabaseKey());
  return supabaseConfigured;
}

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const url = process.env.SUPABASE_URL;
  const key = getSupabaseKey();

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY. " +
        "When Supabase is unavailable, the in-memory store will be used automatically."
    );
  }

  supabaseInstance = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  return supabaseInstance;
}

/**
 * P4.1b mainnet safety guard (additive, fail-closed).
 *
 * Durable persistence is required in facilitator/mainnet mode. The generic
 * in-memory fallback is fine for local tests and Sepolia dry-runs, but it
 * must never silently replace durable storage when real Mainnet value or
 * facilitator settlement is involved.
 */
export function isDurablePersistenceRequired(): boolean {
  return process.env.X402_SETTLEMENT_MODE === "celo-facilitator";
}

/**
 * Fail closed when durable persistence is required but Supabase is not
 * configured. Test paths (local mode, Supabase unset) continue to use the
 * in-memory fallback; facilitator/mainnet mode throws loudly instead.
 */
export function assertSupabaseConfiguredForDurableWrites(context = "payment store"): void {
  if (isDurablePersistenceRequired() && !isSupabaseConfigured()) {
    throw new Error(
      `[SupabasePaymentStore] Durable persistence is required for ${context} ` +
        "in facilitator/mainnet mode but Supabase is not configured. " +
        "Set SUPABASE_URL and SUPABASE_SECRET_KEY. Refusing in-memory fallback " +
        "to avoid silent data loss.",
    );
  }
}

/** Test-only: reset cached client/config flags between isolated tests. */
export function __resetSupabaseClientCacheForTests(): void {
  supabaseInstance = null;
  supabaseConfigured = null;
}
