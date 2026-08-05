import type { ResolutionAgent, ResolutionAgentStatus } from "./types";
import { InvalidAgentStateTransitionError } from "./errors";

// ---------------------------------------------------------------------------
// Transition Rules
// ---------------------------------------------------------------------------

type TransitionMap = Partial<Record<ResolutionAgentStatus, ResolutionAgentStatus[]>>;

const VALID_TRANSITIONS: TransitionMap = {
  draft: ["awaiting_funding"],
  awaiting_funding: ["funded", "closed", "failed_recoverable"],
  funded: ["awaiting_activation", "closed", "expired"],
  awaiting_activation: ["active", "closed", "expired"],
  active: [
    "running_tool",
    "waiting_for_evidence",
    "waiting_for_human_approval",
    "ready_for_human_review",
    "paused",
    "expired",
    "closing",
    "failed_recoverable",
    "budget_exhausted",
  ],
  running_tool: [
    "active",
    "waiting_for_evidence",
    "waiting_for_human_approval",
    "ready_for_human_review",
    "budget_exhausted",
    "paused",
    "failed_recoverable",
  ],
  waiting_for_evidence: [
    "active",
    "running_tool",
    "ready_for_human_review",
    "paused",
    "expired",
    "closing",
    "failed_recoverable",
  ],
  waiting_for_human_approval: [
    "active",
    "running_tool",
    "ready_for_human_review",
    "paused",
    "expired",
    "closing",
    "failed_recoverable",
  ],
  ready_for_human_review: [
    "paused",
    "expired",
    "closing",
    "closed",
    "failed_recoverable",
  ],
  budget_exhausted: ["paused", "closing", "closed", "failed_recoverable"],
  expired: ["closing", "closed"],
  paused: ["active", "closing", "closed", "failed_recoverable"],
  closing: ["closed"],
  closed: [],
  failed_recoverable: [
    "active",
    "draft",
    "awaiting_funding",
    "paused",
    "closing",
    "closed",
  ],
};

// ---------------------------------------------------------------------------
// Guard Functions
// ---------------------------------------------------------------------------

export function canTransitionAgentStatus(
  from: ResolutionAgentStatus,
  to: ResolutionAgentStatus,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getValidTransitions(
  from: ResolutionAgentStatus,
): ResolutionAgentStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

// ---------------------------------------------------------------------------
// Guarded Transition
// ---------------------------------------------------------------------------

export interface TransitionContext {
  fundingConfirmed?: boolean;
  activationApproved?: boolean;
  now: number;
}

export function transitionAgentStatus(
  agent: ResolutionAgent,
  nextStatus: ResolutionAgentStatus,
  context: TransitionContext,
): ResolutionAgent {
  const from = agent.status;
  const to = nextStatus;

  if (from === to) return agent;

  // Basic transition check
  if (!canTransitionAgentStatus(from, to)) {
    throw new InvalidAgentStateTransitionError(
      from,
      to,
      `transition is not permitted`,
    );
  }

  // Context-dependent guards
  if (from === "awaiting_funding" && to === "funded") {
    if (!context.fundingConfirmed) {
      throw new InvalidAgentStateTransitionError(
        from,
        to,
        "funding must be confirmed before entering funded state",
      );
    }
  }

  if (from === "awaiting_activation" && to === "active") {
    if (!context.activationApproved) {
      throw new InvalidAgentStateTransitionError(
        from,
        to,
        "explicit user activation is required before active state",
      );
    }
  }

  // Cannot transition if expired
  if (agent.policy.expiresAt <= context.now && to !== "expired" && to !== "closing" && to !== "closed") {
    throw new InvalidAgentStateTransitionError(
      from,
      to,
      "agent is expired; can only transition to expired, closing, or closed",
    );
  }

  // Cannot transition if closing
  if (from === "closing" && to !== "closed") {
    throw new InvalidAgentStateTransitionError(
      from,
      to,
      "agent is closing; can only transition to closed",
    );
  }

  // Cannot transition from closed
  if (from === "closed") {
    throw new InvalidAgentStateTransitionError(
      from,
      to,
      "closed is terminal; no further transitions allowed",
    );
  }

  // ready_for_human_review does not imply escrow settlement
  // (the agent stops here, human makes the decision)

  const now = context.now;
  const updated: ResolutionAgent = {
    ...agent,
    status: to,
    updatedAt: now,
    ...(to === "active" && agent.activatedAt === null ? { activatedAt: now } : {}),
    ...(to === "paused" && agent.pausedAt === null ? { pausedAt: now } : {}),
    ...(to === "closed" ? { closedAt: now } : {}),
  };

  return updated;
}
