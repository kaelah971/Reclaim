"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSignMessage } from "wagmi";
import AgentHeader from "@/components/agent/AgentHeader";
import AgentBudgetCard from "@/components/agent/AgentBudgetCard";
import AgentPolicyRenewCard from "@/components/agent/AgentPolicyRenewCard";
import AgentRunCard from "@/components/agent/AgentRunCard";
import AgentEvidenceRequests from "@/components/agent/AgentEvidenceRequests";
import AgentTimeline from "@/components/agent/AgentTimeline";
import AgentReadyState from "@/components/agent/AgentReadyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { buildAgentDetailsMessage } from "@/lib/resolution-agent/api/auth";
import { encodeWalletAuthMessage } from "@/lib/x402/walletAuth";
import { parseChainIdParam } from "@/components/payment/paymentLifecycle";
import { CELO_CHAIN_ID } from "@/lib/web3/chains";
import {
  getEscrowDeployment,
  isCanonicalDeployment,
  parseEscrowParam,
} from "@/lib/contracts/escrowIdentity";

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
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 md:py-10">
          <LoadingSkeleton />
        </div>
      }
    >
      <AgentControlRoomContent />
    </Suspense>
  );
}

function AgentControlRoomContent() {
  const params = useParams<{ paymentId: string }>();
  const searchParams = useSearchParams();
  const paymentId = params?.paymentId ?? "";

  // Preserve-or-propagate ?chainId=: only when explicitly present in the URL
  // (keeps default/Sepolia links byte-identical when absent).
  const chainIdRaw = searchParams?.get("chainId");
  const chainResolution = useMemo(
    () => parseChainIdParam(chainIdRaw),
    [chainIdRaw],
  );
  const explicitChainId =
    chainResolution.status === "explicit"
      ? chainResolution.chainId
      : undefined;
  const activeChainId = explicitChainId ?? CELO_CHAIN_ID;
  // P7.2 escrow threading (?escrow=): absent → canonical V1 (legacy
  // behavior); present → fail-closed allowlist validation (unknown escrow
  // fails the packet fetch closed via the API — never falls back).
  const escrowRaw = searchParams?.get("escrow");
  const escrowParam = useMemo(() => parseEscrowParam(escrowRaw), [escrowRaw]);
  const escrowDeployment = useMemo(() => {
    if (escrowParam.status !== "valid") return undefined;
    try {
      return getEscrowDeployment({
        chainId: activeChainId,
        escrowAddress: escrowParam.address,
      });
    } catch {
      return undefined;
    }
  }, [escrowParam, activeChainId]);
  const explicitEscrowAddress =
    escrowDeployment && !isCanonicalDeployment(escrowDeployment)
      ? escrowDeployment.address
      : undefined;
  const chainQueryBase =
    explicitChainId !== undefined ? `?chainId=${explicitChainId}` : "";
  const chainQuery =
    explicitEscrowAddress !== undefined
      ? `${chainQueryBase || `?chainId=${activeChainId}`}&escrow=${explicitEscrowAddress}`
      : chainQueryBase;

  // Safe bigint conversion for the on-chain payment state read — only pure
  // numeric payment IDs are accepted (hyphen/space-formatted IDs are not).
  const numericPaymentId = useMemo(() => {
    if (!paymentId) return undefined;
    if (!/^\d+$/.test(paymentId)) return undefined;
    try {
      return BigInt(paymentId);
    } catch {
      return undefined;
    }
  }, [paymentId]);

  const { data: escrowPayment } = usePayment(numericPaymentId, explicitChainId);
  const wallet = useWalletState();
  const { signMessageAsync } = useSignMessage();

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

      // Step 2: Fetch detailed timeline/evidence events (public-safe summary).
      // The details endpoint requires a fresh structured wallet authorization.
      try {
        if (!wallet.isConnected || !wallet.address) return;
        const detailsMessage = buildAgentDetailsMessage({
          agentId,
          escrowChainId: "eip155:11142220",
          escrowPaymentId: pv.identity.escrowPaymentId,
          signerAddress: wallet.address,
        });
        const detailsSignature = await signMessageAsync({ message: detailsMessage });
        const detailsRes = await fetch(
          `/api/resolution-agents/${encodeURIComponent(agentId)}/details`,
          {
            headers: {
              "x-wallet-address": wallet.address,
              "x-wallet-message": encodeWalletAuthMessage(detailsMessage),
              "x-wallet-signature": detailsSignature,
            },
          },
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
  }, [paymentId, signMessageAsync, wallet.address, wallet.isConnected]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // ---- Human-review packet state (best-effort, read-only) ----
  const [hasReviewPacket, setHasReviewPacket] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function checkPacket() {
      if (!paymentId) return;
      try {
        const res = await fetch(
          `/api/payments/${paymentId}/review-packet${chainQuery}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { found?: boolean };
        if (!cancelled && data.found) setHasReviewPacket(true);
      } catch {
        // Best-effort — the packet section falls back to the assessing state.
      }
    }
    void checkPacket();
    return () => {
      cancelled = true;
    };
  }, [paymentId, chainQuery]);

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
          actionHref={`/payments/${paymentId}${chainQuery}`}
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
          href={`/payments/${paymentId}${chainQuery}`}
          className="text-[13px] text-muted hover:text-ink transition-colors"
        >
          &larr; Back to Payment Room
        </Link>
        <Link
          href={`/payments/${paymentId}/review${chainQuery}`}
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
            hasReviewPacket={hasReviewPacket}
            reviewHref={`/payments/${paymentId}/review${chainQuery}`}
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

            <AgentRunCard
              agentId={publicView.id}
              escrowPaymentId={publicView.identity.escrowPaymentId}
              status={publicView.status}
              paymentState={escrowPayment?.state ?? null}
              onRan={() => load()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
