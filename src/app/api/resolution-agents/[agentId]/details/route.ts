// ---------------------------------------------------------------------------
// GET /api/resolution-agents/[agentId]/details
//
// Read-only endpoint returning the agent's timeline events, tool executions,
// and evidence requests.  All data is public-safe — no secrets, private keys,
// or internal state are exposed.
//
// Authentication: same as GET /api/resolution-agents/[agentId]
// — caller must be funder, on-chain client, or on-chain worker.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { getResolutionAgentPublicView, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";

import type { ResolutionAgentPublicView } from "@/lib/resolution-agent/public-view";

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export interface AgentDetailsResponse {
  agent: AgentPublicSummary;
  events: AgentTimelineEvent[];
  toolExecutions: ToolExecutionSummary[];
  evidenceRequests: EvidenceRequestSummary[];
}

export interface AgentPublicSummary {
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
  allowedTools: string[];
  settledToolIds: string[];
  currentRunningToolId: string | null;
  evidenceCount: number;
  unresolvedGapCount: number;
  planStepCount: number;
  currentPlanStepIndex: number;
  expiresAt: number;
  funderAddress: string;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
}

export interface AgentTimelineEvent {
  id: string;
  eventType: string;
  reason: string;
  previousStatus: string | null;
  nextStatus: string | null;
  createdAt: string;
}

export interface ToolExecutionSummary {
  id: string;
  toolIdentifier: string;
  state: string;
  priceAtomic: string;
  caseVersionHash: string | null;
  evidenceVersionHash: string | null;
  settlementTxHash: string | null;
  resultReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRequestSummary {
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
// Helpers
// ---------------------------------------------------------------------------

function buildAgentSummary(agent: ResolutionAgentPublicView): AgentPublicSummary {
  return {
    id: agent.id,
    goal: agent.goal,
    status: agent.status,
    identity: agent.identity,
    budget: agent.budget,
    caseWalletAddress: agent.caseWalletAddress,
    allowedTools: agent.allowedTools,
    settledToolIds: agent.settledToolIds,
    currentRunningToolId: agent.currentRunningToolId,
    evidenceCount: agent.evidenceCount,
    unresolvedGapCount: agent.unresolvedGapCount,
    planStepCount: agent.planStepCount,
    currentPlanStepIndex: agent.currentPlanStepIndex,
    expiresAt: agent.expiresAt,
    funderAddress: agent.funderAddress,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    activatedAt: agent.activatedAt,
    pausedAt: agent.pausedAt,
    closedAt: agent.closedAt,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    // Auth — same pattern as the parent GET route
    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(request.headers);

    if (!walletAddress || !signedMessage || !walletSignature) {
      return NextResponse.json(
        {
          error: "Wallet authentication required.",
          code: "MISSING_WALLET_HEADERS",
        },
        { status: 401 },
      );
    }

    const authResult = await verifyAuth({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        { error: `Wallet signature verification failed: ${authResult.error}`, code: "SIGNATURE_INVALID" },
        { status: 401 },
      );
    }

    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const store = createStore();

    // Verify authorization and load the agent
    const agent = await getResolutionAgentPublicView({
      agentId,
      authenticatedCaller: walletAddress,
      store,
      escrowReader,
    });

    // Access the underlying Supabase store for events/executions/requests
    const supabaseStore = new SupabaseResolutionAgentStore();

    const [events, toolExecutions, evidenceRequests] = await Promise.all([
      supabaseStore.listEvents(agentId, 100),
      supabaseStore.listToolExecutions(agentId),
      supabaseStore.listEvidenceRequests(agentId),
    ]);

    // Sanitize — return only public-safe fields
    const safeEvents: AgentTimelineEvent[] = events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      reason: e.reason,
      previousStatus: e.previous_status,
      nextStatus: e.next_status,
      createdAt: e.created_at,
    }));

    const safeExecutions: ToolExecutionSummary[] = toolExecutions.map((te) => ({
      id: te.id,
      toolIdentifier: te.tool_identifier,
      state: te.state,
      priceAtomic: String(te.price_atomic),
      caseVersionHash: te.case_version_hash,
      evidenceVersionHash: te.evidence_version_hash,
      settlementTxHash: te.settlement_tx_hash,
      resultReference: te.result_reference,
      createdAt: te.created_at,
      updatedAt: te.updated_at,
    }));

    const safeRequests: EvidenceRequestSummary[] = evidenceRequests.map((er) => ({
      id: er.id,
      responsibleParty: er.responsible_party,
      evidenceItem: er.evidence_item,
      reason: er.reason,
      status: er.status,
      createdAt: er.created_at,
      fulfilledAt: er.fulfilled_at,
      cancelledAt: er.cancelled_at,
    }));

    return NextResponse.json(
      {
        agent: buildAgentSummary(agent),
        events: safeEvents,
        toolExecutions: safeExecutions,
        evidenceRequests: safeRequests,
      } satisfies AgentDetailsResponse,
      { status: 200 },
    );
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
