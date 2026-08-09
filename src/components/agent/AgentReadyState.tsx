"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";

interface AgentReadyStateProps {
  status: string;
  toolExecutions: {
    toolIdentifier: string;
    state: string;
    resultReference: string | null;
    settlementTxHash: string | null;
  }[];
  evidenceRequests: {
    status: string;
  }[];
  /** True when a durable review_packet_prepared event exists (RA1R.8C). */
  hasReviewPacket?: boolean;
  /** Where the human review surface lives. */
  reviewHref?: string;
}

export default function AgentReadyState({
  status,
  toolExecutions,
  evidenceRequests,
  hasReviewPacket = false,
  reviewHref,
}: AgentReadyStateProps) {
  if (status === "ready_for_human_review" || hasReviewPacket) {
    const briefExec = toolExecutions.find(
      (te) => te.toolIdentifier === "reclaim-dispute-brief-v1" && te.state === "settled",
    );

    return (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
            <svg
              className="h-5 w-5 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-ink">
              Case prepared for human review
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              The agent has organized the evidence, but it did not decide who
              should win. A human makes the final decision based on the
              prepared case packet.
            </p>
          </div>
        </div>

        {hasReviewPacket && reviewHref && (
          <div className="mt-4 border-t border-border pt-4">
            <Link href={reviewHref}>
              <Button variant="primary" size="sm">
                Review case
              </Button>
            </Link>
          </div>
        )}

        {briefExec?.resultReference && (
          <div className="mt-4 border-t border-border pt-4">
            <span className="text-[12px] uppercase tracking-[0.08em] text-muted">
              Packet Reference
            </span>
            <p className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink break-all">
              {briefExec.resultReference}
            </p>
          </div>
        )}

        {briefExec?.settlementTxHash && (
          <div className="mt-2">
            <span className="text-[12px] uppercase tracking-[0.08em] text-muted">
              Settlement
            </span>
            <p className="mt-0.5 text-[14px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink break-all">
              {briefExec.settlementTxHash}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Not ready yet — show current blocker
  const openRequests = evidenceRequests.filter((r) => r.status === "open");

  if (openRequests.length > 0) {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Reviewer Packet
        </h3>
        <p className="mt-3 text-[15px] text-muted">
          The case is not yet ready for human review.{" "}
          {openRequests.length === 1
            ? "One evidence request"
            : `${openRequests.length} evidence requests`}{" "}
          still need to be fulfilled before the agent can prepare the reviewer
          packet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Reviewer Packet
      </h3>
      <p className="mt-3 text-[15px] text-muted">
        The agent is still assessing the case. The reviewer packet will be
        prepared once the case is sufficiently complete.
      </p>
    </div>
  );
}
