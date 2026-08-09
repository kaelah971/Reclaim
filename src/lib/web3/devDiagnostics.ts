// ---------------------------------------------------------------------------
// Development-only wallet-chain diagnostics; never enabled in production
// builds; opt-in via NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED=true in dev.
// ---------------------------------------------------------------------------

export const CHAIN_DIAGNOSTICS_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_CHAIN_DIAGNOSTICS_ENABLED === "true";
