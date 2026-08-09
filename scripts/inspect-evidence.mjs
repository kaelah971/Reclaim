// ---------------------------------------------------------------------------
// inspect-evidence.mjs — dump the verified evidence metadata for a payment
//
// Usage: node --env-file=.env.local scripts/inspect-evidence.mjs 1
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const paymentId = process.argv[2] ?? "1";
const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } = await client
  .from("evidence_metadata")
  .select("*")
  .eq("escrow_payment_id", paymentId)
  .order("submitted_at", { ascending: false });

if (error) {
  console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
