"use client";

import StatusBadge from "@/components/ui/StatusBadge";
import {
  getAgentStatusLabel,
  getAgentStatusVariant,
  getActivityDescription,
} from "./agent-mappings";

interface AgentHeaderProps {
  agentId: string;
  escrowPaymentId: string;
  goal: string;
  status: string;
  currentRunningToolId: string | null;
}

export default function AgentHeader({
  agentId,
  escrowPaymentId,
  goal,
  status,
  currentRunningToolId,
}: AgentHeaderProps) {
  const statusLabel = getAgentStatusLabel(status);
  const statusVariant = getAgentStatusVariant(status);
  const activity = getActivityDescription(status, currentRunningToolId);

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      {/* Top row — payment ID + status */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
            Payment
          </span>
          <p className="mt-0.5 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums text-ink">
            {escrowPaymentId}
          </p>
        </div>
        <div>
          <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
            Agent
          </span>
          <p className="mt-0.5 text-[12px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
            {agentId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge variant={statusVariant} label={statusLabel} />
        </div>
      </div>

      {/* Goal */}
      <div className="mt-4 border-t border-border pt-4">
        <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
          Goal
        </span>
        <p className="mt-1 text-[15px] leading-relaxed text-ink">
          {goal}
        </p>
      </div>

      {/* Activity */}
      <div className="mt-3">
        <span className="text-[12px] uppercase tracking-[0.1em] text-muted">
          Current Activity
        </span>
        <p className="mt-1 text-[15px] leading-relaxed text-ink">
          {activity}
        </p>
      </div>
    </div>
  );
}
