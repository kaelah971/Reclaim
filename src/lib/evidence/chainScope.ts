// ---------------------------------------------------------------------------
// Evidence chain scope (P4.3b) — pure, chain-aware helpers shared by the
// evidence worker form, the hash-only EvidenceMap, and the metadata route.
//
//   - Sepolia (11142220) is the default to preserve existing behavior;
//     42220 selects the canonical Mainnet escrow explicitly.
//   - Present-but-invalid values FAIL CLOSED (throw) — never silently fall
//     back to Sepolia, so a wrong-network caller can never bind metadata to
//     the wrong canonical payment+chain.
//   - No DB, no network, no schema changes. Plaintext privacy (D3) is
//     preserved: these helpers only resolve chain scope, never evidence
//     content. The Room stays hash-only for everyone.
// ---------------------------------------------------------------------------

import { CELO_CHAIN_ID, isSupportedChain } from "@/lib/web3/chains";

/** Sepolia default preserves existing evidence behavior. */
export const EVIDENCE_DEFAULT_CHAIN_ID = CELO_CHAIN_ID;

/** Query/body keys accepted for an explicit evidence chain scope. */
export const EVIDENCE_CHAIN_KEYS = [
  "chainId",
  "chain_id",
  "escrowChainId",
] as const;

export class EvidenceChainScopeError extends Error {
  readonly code = "UNSUPPORTED_CHAIN" as const;
  constructor(message = "Unsupported chain.") {
    super(message);
    this.name = "EvidenceChainScopeError";
  }
}

/**
 * Parse a single raw chain value.
 *
 * Returns null when absent/empty (caller applies the Sepolia default).
 * Returns the numeric chain ID when present and in the canonical
 * supported-chain mapping. Throws EvidenceChainScopeError when present but
 * malformed or unsupported (fail closed — never trust the URL chain alone).
 */
export function parseEvidenceChainId(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new EvidenceChainScopeError("Unsupported chain.");
  }
  if (!isSupportedChain(parsed)) {
    throw new EvidenceChainScopeError("Unsupported chain.");
  }
  return parsed;
}

/**
 * Resolve the evidence chain from ordered candidates (first present wins).
 * All-absent resolves to the Sepolia default. A present-but-invalid
 * candidate throws (fail closed).
 */
export function resolveEvidenceChainId(
  candidates: readonly unknown[],
): number {
  for (const candidate of candidates) {
    const parsed = parseEvidenceChainId(candidate);
    if (parsed !== null) return parsed;
  }
  return EVIDENCE_DEFAULT_CHAIN_ID;
}

/**
 * Read the first explicit chain value from a URL search string using the
 * same key order as the evidence API routes (?chainId= first). Returns null
 * when no key is present. Never throws for absent keys; use
 * parseEvidenceChainId on the result to validate.
 */
export function readEvidenceChainRaw(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of EVIDENCE_CHAIN_KEYS) {
    const value = params.get(key);
    if (value !== null) return value;
  }
  return null;
}
