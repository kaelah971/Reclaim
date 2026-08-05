import type { ResolutionAgent } from "./types";
import { getRemainingBudget } from "./budget";

// ---------------------------------------------------------------------------
// Public View — safe subset for browser/API responses
// ---------------------------------------------------------------------------

export interface ResolutionAgentPublicView {
  id: string;
  goal: string;
  status: string;
  identity: {
    escrowPaymentId: string;
  };
  budget: {
    approvedAtomic: string;
    spentAtomic: string;
    reservedAtomic: string;
    remainingAtomic: string;
  };
  expiresAt: number;
  funderAddress: string;
  planStepCount: number;
  currentPlanStepIndex: number;
  caseWalletAddress: string;
  allowedTools: string[];
  settledToolIds: string[];
  currentRunningToolId: string | null;
  evidenceCount: number;
  unresolvedGapCount: number;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
}

export function toResolutionAgentPublicView(
  agent: ResolutionAgent,
): ResolutionAgentPublicView {
  const remaining = getRemainingBudget(agent.budget);

  return {
    id: agent.id,
    goal: agent.goal,
    status: agent.status,
    identity: {
      escrowPaymentId: agent.identity.escrowPaymentId,
    },
    budget: {
      approvedAtomic: agent.budget.approvedAtomic.toString(),
      spentAtomic: agent.budget.spentAtomic.toString(),
      reservedAtomic: agent.budget.reservedAtomic.toString(),
      remainingAtomic: remaining.toString(),
    },
    expiresAt: agent.policy.expiresAt,
    funderAddress: agent.policy.funderAddress,
    planStepCount: agent.plan?.steps.length ?? 0,
    currentPlanStepIndex: agent.plan?.currentStepIndex ?? -1,
    caseWalletAddress: agent.caseWalletAddress,
    allowedTools: agent.policy.allowedTools,
    settledToolIds: agent.settledToolIds,
    currentRunningToolId: agent.currentRunningToolId,
    evidenceCount: agent.observation?.evidenceCount ?? 0,
    unresolvedGapCount:
      agent.observation?.unresolvedGaps.filter((g) => g.status === "open")
        .length ?? 0,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    activatedAt: agent.activatedAt,
    pausedAt: agent.pausedAt,
    closedAt: agent.closedAt,
  };
}
