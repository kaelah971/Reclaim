"use client";

import { useMemo } from "react";
import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";
import {
  EVIDENCE_DEFAULT_CHAIN_ID,
  parseEvidenceChainId,
  readEvidenceChainRaw,
} from "@/lib/evidence/chainScope";

export type EvidenceStatus = "submitted" | "missing" | "disputed" | "verified";

export interface EvidenceItemData {
  id: string;
  title: string;
  type: string;
  owner?: string;
  relatedClaim?: string;
  date?: string;
  status: EvidenceStatus;
  verificationRef?: string;
  description?: string;
}

const statusVariantMap: Record<EvidenceStatus, BadgeVariant> = {
  submitted: "submitted",
  missing: "missing",
  disputed: "disputed",
  verified: "verified",
};

interface EvidenceItemProps {
  evidence: EvidenceItemData;
}

export function EvidenceItem({ evidence }: EvidenceItemProps) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-page p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[15px] font-medium text-ink">
            {evidence.title}
          </h4>
          <p className="mt-0.5 text-[13px] text-muted">{evidence.type}</p>
        </div>
        <StatusBadge
          variant={statusVariantMap[evidence.status]}
          label={evidence.status}
        />
      </div>

      {evidence.description && (
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {evidence.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {evidence.owner && <span>By: {evidence.owner}</span>}
        {evidence.date && (
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
            {evidence.date}
          </span>
        )}
        {evidence.relatedClaim && <span>Claim: {evidence.relatedClaim}</span>}
        {evidence.verificationRef && (
          <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
            Ref: {evidence.verificationRef}
          </span>
        )}
      </div>
    </div>
  );
}

interface EvidenceMapProps {
  items: readonly EvidenceItemData[];
  className?: string;
  /**
   * P4.3b (optional): explicit escrow chain scope for this map. Validated
   * against the canonical supported-chain mapping; invalid values fail
   * closed to the Sepolia default. When omitted, the validated ?chainId=
   * URL param is used; otherwise Sepolia. Backward compatible — existing
   * callers pass `items` (+ optionally `className`) unchanged.
   */
  chainId?: number | string | null;
  /** P4.3b (optional): escrow payment this map belongs to (future wiring). */
  paymentId?: string | number | bigint | null;
}

/**
 * Resolve the map's escrow chain scope without requiring room-page changes:
 * explicit prop first, then the validated ?chainId= URL param, then the
 * Sepolia default. Invalid values fail closed to the default.
 */
export function resolveEvidenceMapChainId(
  chainIdProp: EvidenceMapProps["chainId"],
  search?: string,
): number {
  try {
    const fromProp = parseEvidenceChainId(chainIdProp ?? null);
    if (fromProp !== null) return fromProp;
  } catch {
    // Invalid explicit prop — fail closed to the default below.
  }
  if (typeof search === "string") {
    try {
      const fromUrl = parseEvidenceChainId(readEvidenceChainRaw(search));
      if (fromUrl !== null) return fromUrl;
    } catch {
      // Invalid URL chain — fail closed to the default below.
    }
  }
  return EVIDENCE_DEFAULT_CHAIN_ID;
}

export default function EvidenceMap({
  items,
  className = "",
  chainId,
  paymentId,
}: EvidenceMapProps) {
  // P4.3b D3 privacy: the Room stays hash-only for everyone. This component
  // never fetches evidence plaintext — it renders only the verification
  // reference hashes handed down via `items`. Party-authorized plaintext
  // reads are intentionally NOT wired here (no durable challenge store
  // exists in this slice; see the P4.3b report).
  //
  // The URL chain is read synchronously during render (SSR-safe via the
  // typeof-window guard). On the rare first-load mismatch (SSR default vs.
  // an explicit ?chainId=), React patches this single data attribute —
  // rendered items never differ, so there is no content mismatch.
  const urlSearch =
    typeof window === "undefined" ? undefined : window.location.search;
  const resolvedChainId = useMemo(
    () => resolveEvidenceMapChainId(chainId, urlSearch),
    [chainId, urlSearch],
  );

  return (
    <div
      className={className}
      data-escrow-chain-id={resolvedChainId}
      data-payment-id={paymentId === null || paymentId === undefined ? undefined : String(paymentId)}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Evidence map
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted">
          No evidence has been submitted yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <EvidenceItem key={item.id} evidence={item} />
          ))}
        </div>
      )}
    </div>
  );
}
