import { type BadgeVariant } from "../ui/StatusBadge";
import StatusBadge from "../ui/StatusBadge";

export interface TimelineEntryData {
  id: string;
  label: string;
  date?: string;
  actor?: string;
  description?: string;
  statusVariant?: BadgeVariant;
  statusLabel?: string;
}

interface TimelineEntryProps {
  entry: TimelineEntryData;
  isLast?: boolean;
}

export function TimelineEntry({ entry, isLast = false }: TimelineEntryProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`mt-1.5 h-3 w-3 rounded-full border-2 ${
            entry.statusVariant === "settled" || entry.statusVariant === "protected" || entry.statusVariant === "verified"
              ? "border-success bg-success"
              : entry.statusVariant === "disputed"
                ? "border-status-disputed-text bg-status-disputed-bg"
                : "border-gold bg-gold"
          }`}
          aria-hidden="true"
        />
        {!isLast && <div className="mt-1 w-[1.5px] flex-1 bg-border" aria-hidden="true" />}
      </div>
      <div className="pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium text-ink">{entry.label}</span>
          {entry.statusLabel && entry.statusVariant && (
            <StatusBadge variant={entry.statusVariant} label={entry.statusLabel} />
          )}
        </div>
        {entry.date && (
          <p className="mt-0.5 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
            {entry.date}
          </p>
        )}
        {entry.actor && (
          <p className="mt-0.5 text-[13px] text-muted">{entry.actor}</p>
        )}
        {entry.description && (
          <p className="mt-1 text-[15px] leading-relaxed text-muted">
            {entry.description}
          </p>
        )}
      </div>
    </div>
  );
}

interface PaymentTimelineProps {
  entries: readonly TimelineEntryData[];
  className?: string;
}

export default function PaymentTimeline({
  entries,
  className = "",
}: PaymentTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Timeline
        </h3>
        <p className="mt-3 text-[15px] text-muted">
          No timeline entries yet. Events will appear as the payment progresses.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}>
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Timeline
      </h3>
      <div className="mt-4">
        {entries.map((entry, i) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            isLast={i === entries.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
