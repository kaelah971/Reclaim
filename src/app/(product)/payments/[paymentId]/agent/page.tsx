"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AgentHeader from "@/components/agent/AgentHeader";
import AgentBudgetCard from "@/components/agent/AgentBudgetCard";
import AgentPolicyRenewCard from "@/components/agent/AgentPolicyRenewCard";
import AgentEvidenceRequests from "@/components/agent/AgentEvidenceRequests";
import AgentTimeline from "@/components/agent/AgentTimeline";
import AgentReadyState from "@/components/agent/AgentReadyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentPublicView {
  id: string;
  goal: string;
  status: string;
  identity: { escrowPaymentId: string };
  budget: {
    approvedAtomic: string;
    spentAtomic: string;
    reservedAtomic: string;
    remainingAtomic: string;
  };
  caseWalletAddress: string;
  settledToolIds: string[];
  currentRunningToolId: string | null;
  evidenceCount: number;
  unresolvedGapCount: number;
  planStepCount: number;
  currentPlanStepIndex: number;
  expiresAt: number;
  funderAddress: string;
  allowedTools: string[];
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
}

interface AgentEvent {
  id: string;
  eventType: string;
  reason: string;
  previousStatus: string | null;
  nextStatus: string | null;
  createdAt: string;
}

interface ToolExecution {
  id: string;
  toolIdentifier: string;
  state: string;
  priceAtomic: string;
  settlementTxHash: string | null;
  resultReference: string | null;
  createdAt: string;
}

interface EvidenceRequest {
  id: string;
  responsibleParty: string;
  evidenceItem: string;
  reason: string;
  status: string;
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentControlRoomPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = params?.paymentId ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publicView, setPublicView] = useState<AgentPublicView | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [evidenceRequests, setEvidenceRequests] = useState<EvidenceRequest[]>([]);

  const load = useCallback(async () => {
    if (!paymentId) return;

    try {
      // Step 1: Look up agent by payment ID
      const lookupRes = await fetch(
        `/api/resolution-agents?paymentId=${encodeURIComponent(paymentId)}`,
      );

      if (!lookupRes.ok) {
        throw new Error(`Lookup failed: ${lookupRes.status}`);
      }

      const lookupData = await lookupRes.json();

      if (!lookupData.found || !lookupData.agentId || !lookupData.publicView) {
        setLoading(false);
        return;
      }

      const agentId: string = lookupData.agentId;
      const pv: AgentPublicView = lookupData.publicView;
      setPublicView(pv);
      setError(null);

      // Step 2: Fetch detailed timeline/evidence events (public-safe summary)
      // We fetch events separately via the details endpoint
      // The details API requires wallet auth in production, but we try anyway
      try {
        const detailsRes = await fetch(
          `/api/resolution-agents/${encodeURIComponent(agentId)}/details`,
        );
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          setEvents(details.events ?? []);
          setToolExecutions(details.toolExecutions ?? []);
          setEvidenceRequests(details.evidenceRequests ?? []);
        }
      } catch {
        // Best-effort — details may not be available without auth
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <ErrorState title="Unable to load control room" description={error} />
      </div>
    );
  }

  // No agent found
  if (!publicView) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
        <EmptyState
          title="No Resolution Agent"
          description="A resolution agent has not been created for this payment yet."
          actionLabel="Return to Payment Room"
          actionHref={`/payments/${paymentId}`}
        />
      </div>
    );
  }

  // Data loaded
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-3">
        <Link
          href={`/payments/${paymentId}`}
          className="text-[13px] text-muted hover:text-ink transition-colors"
        >
          &larr; Back to Payment Room
        </Link>
        <Link
          href={`/payments/${paymentId}/review`}
          className="text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
        >
          Review case
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-8">
          <AgentHeader
            agentId={publicView.id}
            escrowPaymentId={publicView.identity.escrowPaymentId}
            goal={publicView.goal}
            status={publicView.status}
            currentRunningToolId={publicView.currentRunningToolId}
          />

          <AgentReadyState
            status={publicView.status}
            toolExecutions={toolExecutions}
            evidenceRequests={evidenceRequests}
          />

          <AgentEvidenceRequests requests={evidenceRequests} />

          <AgentTimeline events={events} />
        </div>

        {/* Right column */}
        <div className="lg:col-span-1">
          <div className="sticky top-[8rem] space-y-6">
            <AgentBudgetCard
              approvedAtomic={publicView.budget.approvedAtomic}
              spentAtomic={publicView.budget.spentAtomic}
              reservedAtomic={publicView.budget.reservedAtomic}
              remainingAtomic={publicView.budget.remainingAtomic}
              caseWalletAddress={publicView.caseWalletAddress}
            />

            <AgentPolicyRenewCard
              agentId={publicView.id}
              escrowPaymentId={publicView.identity.escrowPaymentId}
              expiresAt={publicView.expiresAt}
              funderAddress={publicView.funderAddress}
              onRenewed={() => load()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
