"use client";

import { TimelineEntry, type TimelineEntryData } from "@/components/payment/PaymentTimeline";
import { getEventDisplayLabel } from "./agent-mappings";

interface AgentTimelineProps {
  events: {
    id: string;
    eventType: string;
    reason: string;
    previousStatus: string | null;
    nextStatus: string | null;
    createdAt: string;
  }[];
}

function formatTimelineDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AgentTimeline({ events }: AgentTimelineProps) {
  const entries: TimelineEntryData[] = events.map((e) => {
    const label = getEventDisplayLabel(e.eventType);
    const variant = e.eventType === "evidence_request_fulfilled" || e.eventType === "agent_resumed_after_evidence"
      ? "settled" as const
      : e.eventType.includes("failed") || e.eventType === "agent_resumption_failed"
        ? "disputed" as const
        : "pending" as const;

    return {
      id: e.id,
      label,
      date: formatTimelineDate(e.createdAt),
      description: e.reason,
      statusVariant: variant,
      statusLabel: undefined,
    };
  });

  if (entries.length === 0) {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Resolution Timeline
        </h3>
        <p className="mt-3 text-[15px] text-muted">
          No activity recorded yet. Events will appear as the agent works on this case.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Resolution Timeline
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
