import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

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
}

export default function EvidenceMap({ items, className = "" }: EvidenceMapProps) {
  return (
    <div className={className}>
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
