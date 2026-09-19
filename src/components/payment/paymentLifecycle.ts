import { isSupportedChain } from "@/lib/web3/chains";
import type { PaymentState } from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Room lifecycle helpers (P4.3a).
//
// - getPaymentLifecycleLabel: exact human labels for the money strip / status.
//   Funded→Protected, Accepted→Accepted, DeliverySubmitted→Delivered,
//   ReleaseRequested→Release requested, Released→Released. Created must NOT
//   read "protected". Dispute/cancel states stay accurate; future states are
//   not presented as completed.
// - parseChainIdParam: fail-closed ?chainId= parsing. Absent/empty preserves
//   the caller's default behavior ("default"); well-formed + supported
//   resolves to "explicit"; malformed or unsupported resolves to "invalid"
//   (callers must render an explicit notice — never silently fall back).
// ---------------------------------------------------------------------------

export function getPaymentLifecycleLabel(state: PaymentState): string {
  switch (state) {
    case "Created":
      return "Created";
    case "Funded":
      return "Protected";
    case "Accepted":
      return "Accepted";
    case "DeliverySubmitted":
      return "Delivered";
    case "ReleaseRequested":
      return "Release requested";
    case "Released":
      return "Released";
    case "Disputed":
      return "Disputed";
    case "Cancelled":
      return "Cancelled";
    case "Resolved":
      return "Resolved";
    default:
      return state;
  }
}

export type ChainIdResolution =
  | { status: "default" }
  | { status: "explicit"; chainId: number }
  | { status: "invalid"; raw: string };

export function parseChainIdParam(
  raw: string | null | undefined,
): ChainIdResolution {
  if (raw === null || raw === undefined || raw === "") {
    return { status: "default" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { status: "default" };
  if (!/^\d+$/.test(trimmed)) {
    return { status: "invalid", raw };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || !isSupportedChain(parsed)) {
    return { status: "invalid", raw };
  }
  return { status: "explicit", chainId: parsed };
}

// ---------------------------------------------------------------------------
// Canonical chain-aware route helpers (P4.5F).
//
// Single source for payment-scoped navigation so ?chainId= is never dropped:
// - chainId undefined/null → default route without query (Sepolia default
//   behavior preserved byte-identical).
// - supported chain (42220 Mainnet, 11142220 Sepolia) → route with
//   ?chainId={chainId}.
// - unsupported/malformed chain → null (fail closed — callers must not render
//   a chain-free link that would silently fall back to the wrong network).
// ---------------------------------------------------------------------------

function assertValidPaymentId(paymentId: string | bigint): string | null {
  const str = typeof paymentId === "bigint" ? paymentId.toString() : paymentId.trim();
  if (!str || !/^\d+$/.test(str)) return null;
  try {
    BigInt(str);
  } catch {
    return null;
  }
  return str;
}

function chainQueryFor(chainId?: number | null): string | null {
  if (chainId === undefined || chainId === null) return "";
  if (!Number.isSafeInteger(chainId) || !isSupportedChain(chainId)) return null;
  return `?chainId=${chainId}`;
}

/** Build ?chainId= suffix, or null when the chain is unsupported. */
export function buildChainQuery(chainId?: number | null): string | null {
  return chainQueryFor(chainId);
}

function withChain(
  base: string,
  chainId?: number | null,
): string | null {
  const q = chainQueryFor(chainId);
  if (q === null) return null;
  return `${base}${q}`;
}

/** Canonical payment room path: /payments/{id}[?chainId=]. Null when invalid. */
export function buildPaymentPath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/payments/${id}`, chainId);
}

/** Canonical receipt path: /receipts/{id}[?chainId=]. Null when invalid. */
export function buildReceiptPath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/receipts/${id}`, chainId);
}

/** Canonical evidence path: /payments/{id}/evidence[?chainId=]. */
export function buildEvidencePath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/payments/${id}/evidence`, chainId);
}

/** Canonical dispute path: /payments/{id}/dispute[?chainId=]. */
export function buildDisputePath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/payments/${id}/dispute`, chainId);
}

/** Canonical review path: /payments/{id}/review[?chainId=]. */
export function buildReviewPath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/payments/${id}/review`, chainId);
}

/** Canonical agent path: /payments/{id}/agent[?chainId=]. */
export function buildAgentPath(
  paymentId: string | bigint,
  chainId?: number | null,
): string | null {
  const id = assertValidPaymentId(paymentId);
  if (id === null) return null;
  return withChain(`/payments/${id}/agent`, chainId);
}

/**
 * Humanize technical receipt enums for UI display. Underlying values stay
 * intact in data; only the rendered label changes.
 */
export function humanizeAvailabilityLabel(value: string | null | undefined): string {
  if (value === "package_available") return "Evidence record available";
  if (value === null || value === undefined) return "—";
  return value;
}

/** Humanize the submitter label: chain_verified → Verified on-chain. */
export function humanizeSubmitterLabel(value: string | null | undefined): string {
  if (value === "chain_verified") return "Verified on-chain";
  if (value === null || value === undefined) return "—";
  return value;
}
