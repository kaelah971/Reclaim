// ---------------------------------------------------------------------------
// Escrow identity — central source of truth for ProtectedPaymentEscrow
// deployments (P7.2 PART 1). Client+server safe: no node-only imports.
//
// Two contract generations exist:
// - ProtectedPaymentEscrow   (V1, manual flow; `contract: "ProtectedPaymentEscrow"`)
// - ProtectedPaymentEscrowV2 (V2, opt-in autopilot; `contract: "ProtectedPaymentEscrowV2"`)
//
// Canonical defaults (UNCHANGED by P7.2 — legacy links keep working):
// - Celo Sepolia (11142220) → V1 0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F
//   (current canonical). The older V1 0x0fA826256a58F19Ad24Fc9384d81D313f2266F79
//   stays allowlisted as a historical (non-canonical) entry.
// - Celo Mainnet (42220) → V1 0xE42cF4620DE454bE0De5004255d25683e4F882c4
//   (legacy rule: no address + Mainnet resolves to this V1).
//
// NO V2 addresses are allowlisted yet (none deployed) — the structure
// supports them; deployments add entries post-deploy (PART 2).
//
// Fail-closed rules (never fall back silently):
// - Unsupported chainId → throw.
// - Explicit escrow address with malformed hex → throw.
// - Explicit escrow address not in the chain allowlist → throw
//   `Unknown escrow contract ...` (never fall back to canonical).
// - version + address that disagree → throw.
// - version with no matching entry on the chain → throw.
//
// URL threading: canonical V1 deployments serialize to `?chainId=X` only
// (legacy links byte-identical); explicit V2/non-canonical deployments
// serialize to `?chainId=X&escrow=0x...`.
// ---------------------------------------------------------------------------

import { isSupportedChain } from "@/lib/web3/chains";

/** Contract generation for an allowlisted escrow deployment. */
export type EscrowContractKind =
  | "ProtectedPaymentEscrow"
  | "ProtectedPaymentEscrowV2";

/** One allowlisted escrow deployment on a supported chain. */
export interface EscrowDeployment {
  chainId: number;
  address: `0x${string}`;
  contract: EscrowContractKind;
  version: "v1" | "v2";
}

/** Allowlisted deployments keyed by chain ID (first entry = canonical). */
export interface EscrowDeployments {
  [chainId: number]: EscrowDeployment[];
}

/** Celo Sepolia chain ID (11142220). */
export const ESCROW_SEPOLIA_CHAIN_ID = 11142220;

/** Celo Mainnet chain ID (42220). */
export const ESCROW_MAINNET_CHAIN_ID = 42220;

/** Sepolia canonical V1 escrow (current — with dispute resolution). */
export const SEPOLIA_CANONICAL_V1 =
  "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F" as `0x${string}`;

/** Sepolia historical V1 escrow (no dispute resolution) — allowlisted, non-canonical. */
export const SEPOLIA_HISTORICAL_V1 =
  "0x0fA826256a58F19Ad24Fc9384d81D313f2266F79" as `0x${string}`;

/** Mainnet V1 escrow (legacy canonical). */
export const MAINNET_CANONICAL_V1 =
  "0xE42cF4620DE454bE0De5004255d25683e4F882c4" as `0x${string}`;

/**
 * Default allowlisted deployments. The FIRST entry per chain is the
 * canonical deployment (bare `?chainId=` links resolve to it).
 */
export const DEFAULT_ESCROW_DEPLOYMENTS: EscrowDeployments = {
  [ESCROW_SEPOLIA_CHAIN_ID]: [
    {
      chainId: ESCROW_SEPOLIA_CHAIN_ID,
      address: SEPOLIA_CANONICAL_V1,
      contract: "ProtectedPaymentEscrow",
      version: "v1",
    },
    {
      chainId: ESCROW_SEPOLIA_CHAIN_ID,
      address: SEPOLIA_HISTORICAL_V1,
      contract: "ProtectedPaymentEscrow",
      version: "v1",
    },
  ],
  [ESCROW_MAINNET_CHAIN_ID]: [
    {
      chainId: ESCROW_MAINNET_CHAIN_ID,
      address: MAINNET_CANONICAL_V1,
      contract: "ProtectedPaymentEscrow",
      version: "v1",
    },
  ],
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export interface GetEscrowDeploymentInput {
  chainId: number;
  escrowAddress?: string | null;
  version?: "v1" | "v2" | null;
}

/**
 * Resolve an escrow deployment for a chain, fail-closed.
 *
 * - chainId must be supported (isSupportedChain) else throw.
 * - Explicit escrowAddress must be well-formed hex else throw, and MUST be
 *   in the chain allowlist else throw `Unknown escrow contract ...`.
 * - No address + Mainnet → V1 0xE42c… (legacy rule); no address + Sepolia →
 *   V1 0x1A1C… (current canonical, unchanged).
 * - version without address → first matching version entry else throw.
 * - address + version must agree else throw.
 *
 * Address comparison is lowercase-normalized (checksummed input accepted);
 * the returned entry carries the canonical allowlist address.
 */
export function getEscrowDeployment(
  input: GetEscrowDeploymentInput,
  deployments: EscrowDeployments = DEFAULT_ESCROW_DEPLOYMENTS,
): EscrowDeployment {
  const { chainId, escrowAddress, version } = input;
  if (!Number.isSafeInteger(chainId) || !isSupportedChain(chainId)) {
    throw new Error(`Unsupported escrow chain ${String(chainId)}.`);
  }
  const entries = deployments[chainId];
  if (!entries || entries.length === 0) {
    throw new Error(
      `ProtectedPaymentEscrow is not deployed on chain ${chainId}.`,
    );
  }
  if (version !== undefined && version !== null && version !== "v1" && version !== "v2") {
    throw new Error(`Unknown escrow version ${String(version)}.`);
  }

  if (escrowAddress !== undefined && escrowAddress !== null && String(escrowAddress).trim() !== "") {
    const trimmed = String(escrowAddress).trim();
    if (!ADDRESS_PATTERN.test(trimmed)) {
      throw new Error(`Unknown escrow contract ${trimmed} on chain ${chainId}.`);
    }
    const normalized = trimmed.toLowerCase();
    const match = entries.find((e) => e.address.toLowerCase() === normalized);
    if (!match) {
      throw new Error(`Unknown escrow contract ${trimmed} on chain ${chainId}.`);
    }
    if (version !== undefined && version !== null && match.version !== version) {
      throw new Error(
        `Unknown escrow contract ${trimmed} on chain ${chainId} for version ${version}.`,
      );
    }
    return match;
  }

  if (version !== undefined && version !== null) {
    const match = entries.find((e) => e.version === version);
    if (!match) {
      throw new Error(
        `Unknown escrow contract version ${version} on chain ${chainId}.`,
      );
    }
    return match;
  }

  // No address, no version → canonical (first) entry. Documents the legacy
  // rules: Mainnet → V1 0xE42c…, Sepolia → V1 0x1A1C… (unchanged).
  return entries[0];
}

/**
 * True when the deployment is the canonical (default) deployment for its
 * chain — i.e. getEscrowDeployment({chainId}) returns the same address.
 * Canonical V1 links serialize without `&escrow=` so legacy links stay
 * byte-identical.
 */
export function isCanonicalDeployment(
  deployment: EscrowDeployment,
  deployments: EscrowDeployments = DEFAULT_ESCROW_DEPLOYMENTS,
): boolean {
  try {
    const canonical = getEscrowDeployment(
      { chainId: deployment.chainId },
      deployments,
    );
    return canonical.address.toLowerCase() === deployment.address.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Build the chain+escrow query suffix for payment-scoped URLs.
 *
 * - Canonical V1 → `?chainId=X` (keeps legacy links byte-identical).
 * - Explicit V2 / non-canonical → `?chainId=X&escrow=0x...`.
 *
 * Accepts either a resolved EscrowDeployment or `{chainId, escrowAddress?}`
 * (absent escrowAddress resolves to the canonical default).
 */
export function buildEscrowQuery(
  deployment: EscrowDeployment | { chainId: number; escrowAddress?: string | null },
  deployments: EscrowDeployments = DEFAULT_ESCROW_DEPLOYMENTS,
): string {
  const resolved: EscrowDeployment =
    "address" in deployment && "contract" in deployment
      ? (deployment as EscrowDeployment)
      : getEscrowDeployment(
          {
            chainId: (deployment as { chainId: number }).chainId,
            escrowAddress:
              (deployment as { escrowAddress?: string | null }).escrowAddress ??
              undefined,
          },
          deployments,
        );
  if (isCanonicalDeployment(resolved, deployments)) {
    return `?chainId=${resolved.chainId}`;
  }
  return `?chainId=${resolved.chainId}&escrow=${resolved.address}`;
}

// ---------------------------------------------------------------------------
// Route + client param helpers (shared so server and client behave identically)
// ---------------------------------------------------------------------------

/** Fail-closed parse of a raw `?escrow=` query value (format only). */
export type EscrowParamResolution =
  | { status: "absent" }
  | { status: "valid"; address: `0x${string}` }
  | { status: "invalid"; raw: string };

export function parseEscrowParam(
  raw: string | null | undefined,
): EscrowParamResolution {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { status: "absent" };
  }
  const trimmed = raw.trim();
  if (!ADDRESS_PATTERN.test(trimmed)) {
    return { status: "invalid", raw };
  }
  return { status: "valid", address: trimmed as `0x${string}` };
}

/**
 * Pick the first non-empty escrow candidate (query/body aliases). Returns
 * undefined when all are absent/empty — callers then preserve the exact
 * current (canonical-default) behavior.
 */
export function pickEscrowParam(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return undefined;
}

/**
 * Server route helper: resolve (chainId + optional raw escrow param) to a
 * deployment, fail-closed. Absent escrow preserves the exact current
 * behavior (canonical default for the chain). Throws on unsupported chain
 * or unknown escrow contract — routes map this to 400 (fail closed, never
 * fall back).
 */
export function resolveRouteEscrow(
  chainId: number,
  escrowRaw: unknown,
  deployments: EscrowDeployments = DEFAULT_ESCROW_DEPLOYMENTS,
): EscrowDeployment {
  const picked = pickEscrowParam(escrowRaw);
  return getEscrowDeployment(
    { chainId, escrowAddress: picked ?? undefined },
    deployments,
  );
}
