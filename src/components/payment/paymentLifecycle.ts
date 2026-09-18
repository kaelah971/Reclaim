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
