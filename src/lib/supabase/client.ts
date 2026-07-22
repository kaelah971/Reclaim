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
