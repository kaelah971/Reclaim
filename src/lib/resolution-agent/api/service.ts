// ---------------------------------------------------------------------------
// Resolution Agent API — core business logic service
//
// SERVER-ONLY — pure service layer.  No HTTP handling, no route definitions,
// no request/response serialisation.  Consumed by Next.js route handlers.
//
// Dependencies:
//   - SupabaseResolutionAgentStore for persistence
//   - FundingReader for on-chain balance queries
//   - Domain logic from state-machine, budget, public-view, wallet generation
//   - Wallet encryption config from server/config
//
// All mutations use optimistic concurrency control via the store's
// updateAgent(expectedVersion) mechanism.  Version numbers are read directly
// from the database before each mutating operation.
// ---------------------------------------------------------------------------

import type {
  ResolutionAgent,
  ResolutionAgentStatus,
  ResolutionAgentToolId,
  AgentCaseIdentity,
} from "../types";
import { FIXED_AGENT_GOAL } from "../types";
import { SupabaseResolutionAgentStore } from "../store/supabase";
import {
  ResolutionAgentNotFoundError,
} from "../store/errors";
import { V1_TOOLS } from "../tools";
import { createBudget } from "../budget";
import { transitionAgentStatus, type TransitionContext } from "../state-machine";
import {
  toResolutionAgentPublicView,
  type ResolutionAgentPublicView,
} from "../public-view";
import { generateEncryptedCaseWallet } from "../server/wallet";
import { parseWalletEncryptionKey, WALLET_ENCRYPTION_KEY_ENV } from "../server/config";
import type { FundingReader } from "./funding";
import { SUPPORTED_BUDGETS, type SupportedBudget } from "./types";

// ---------------------------------------------------------------------------
// Store interface (structural — matches any conforming store)
// ---------------------------------------------------------------------------

/**
 * Structural interface for a resolution-agent persistence store.
 *
 * Both {@link SupabaseResolutionAgentStore} (production) and mock stores
 * (testing) satisfy this interface, enabling the service layer to work
 * without depending on a concrete Supabase client.
 */
export interface ResolutionAgentStore {
  createAgent(agent: ResolutionAgent): Promise<ResolutionAgent>;
  getAgentById(agentId: string): Promise<ResolutionAgent | null>;
  getAgentByCaseIdentity(
    chainId: string,
    contractAddress: string,
    paymentId: string,
  ): Promise<ResolutionAgent | null>;
  updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent>;
  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /** Read the current optimistic-concurrency version for an agent. */
  getAgentVersion(agentId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Store adapter — wraps SupabaseResolutionAgentStore with getAgentVersion
// ---------------------------------------------------------------------------

/**
 * Adapts the production {@link SupabaseResolutionAgentStore} to the
 * {@link ResolutionAgentStore} interface by adding a `getAgentVersion`
 * method that reads the version column directly from the database.
 */
class SupabaseStoreAdapter implements ResolutionAgentStore {
  constructor(private readonly inner: SupabaseResolutionAgentStore) {}

  createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    return this.inner.createAgent(agent);
  }
  getAgentById(agentId: string): Promise<ResolutionAgent | null> {
    return this.inner.getAgentById(agentId);
  }
  getAgentByCaseIdentity(
    chainId: string,
    contractAddress: string,
    paymentId: string,
  ): Promise<ResolutionAgent | null> {
    return this.inner.getAgentByCaseIdentity(chainId, contractAddress, paymentId);
  }
  updateAgent(agent: ResolutionAgent, expectedVersion: number): Promise<ResolutionAgent> {
    return this.inner.updateAgent(agent, expectedVersion);
  }
  appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.inner.appendEvent(agentId, eventType, reason, previousStatus, nextStatus, metadata);
  }
  async getAgentVersion(agentId: string): Promise<number> {
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("resolution_agents")
      .select("version")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error || !data) {
      throw new ResolutionAgentNotFoundError(agentId);
    }

    return (data as { version: number }).version;
  }
}

/**
 * Creates a {@link ResolutionAgentStore} from the production
 * {@link SupabaseResolutionAgentStore}, adding the version-reading
 * capability needed for optimistic concurrency.
 */
export function createStore(
  inner?: SupabaseResolutionAgentStore,
): ResolutionAgentStore {
  return new SupabaseStoreAdapter(inner ?? new SupabaseResolutionAgentStore());
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default agent expiry: 7 calendar days from creation.
 * After this window the agent can only transition to expired → closing → closed.
 */
export const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/**
 * Returned by {@link refreshFundingStatus}.  Includes the latest agent
 * public view together with the on-chain balance report.
 */
export interface FundingStatusResponse {
  /** The agent in its current state (safe for public consumption). */
  agent: ResolutionAgentPublicView;
  /** The wallet's current USDC balance in atomic units (as a string). */
  walletBalanceAtomic: string;
  /** Whether the wallet holds at least the approved budget amount. */
  isSufficientlyFunded: boolean;
}

// ---------------------------------------------------------------------------
// Service parameter types
// ---------------------------------------------------------------------------

export interface CreateAgentParams {
  /** Verified wallet address of the funder (authenticated via signature). */
  authenticatedCaller: string;
  /** Case identity for the escrow payment. */
  caseIdentity: AgentCaseIdentity;
  /** Canonical approved budget in atomic USDC (from the server allowlist). */
  approvedBudgetAtomic: bigint;
  /** Current timestamp in milliseconds since epoch. */
  now: number;
  /** Persistence store. */
  store: ResolutionAgentStore;
}

export interface FundingStatusParams {
  /** The agent to check funding for. */
  agentId: string;
  /** Verified wallet address of the funder. */
  authenticatedCaller: string;
  /** Current timestamp in milliseconds since epoch. */
  now: number;
  /** Persistence store. */
  store: ResolutionAgentStore;
  /** On-chain USDC balance reader. */
  fundingReader: FundingReader;
}

export interface ActivateAgentParams {
  /** The agent to activate. */
  agentId: string;
  /** Verified wallet address of the funder. */
  authenticatedCaller: string;
  /** Current timestamp in milliseconds since epoch. */
  now: number;
  /** Persistence store. */
  store: ResolutionAgentStore;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads the current concurrency-control version for an agent via the store.
 */
async function readAgentVersion(
  store: ResolutionAgentStore,
  agentId: string,
): Promise<number> {
  return store.getAgentVersion(agentId);
}

/**
 * Validates that the given budget (in atomic USDC) is one of the canonical
 * server-supported values.
 */
function validateApprovedBudget(atomic: bigint): asserts atomic is SupportedBudget {
  if (!SUPPORTED_BUDGETS.includes(atomic as SupportedBudget)) {
    throw new Error(
      `Budget ${atomic.toString()} atomic USDC is not supported. ` +
        `Must be one of: ${SUPPORTED_BUDGETS.map(String).join(", ")}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API: createResolutionAgentForCase
// ---------------------------------------------------------------------------

/**
 * Creates a new resolution agent for a given payment case.
 *
 * # Flow
 * 1. Validates the approved budget against the server allowlist.
 * 2. Checks whether an agent already exists for this case identity.
 *    - Same funder  → returns the existing agent (idempotent).
 *    - Different funder → throws an error (one agent per case).
 * 3. Generates a cryptographically random case wallet and immediately
 *    encrypts the private key with the server's wallet encryption key.
 *    The plaintext private key is never persisted or returned.
 * 4. Constructs the domain object with status "draft".
 * 5. Persists via the store (version 1).
 * 6. Transitions to "awaiting_funding" and updates (version 2).
 * 7. Appends a creation event.
 * 8. Returns a public-safe view (no encrypted secrets exposed).
 *
 * # Idempotency
 * If the same funder calls this twice with the same case identity, the
 * second call returns the existing agent unchanged.
 *
 * @throws If the budget is not in the server allowlist.
 * @throws If an agent already exists for this case with a different funder.
 * @throws If wallet generation or encryption fails.
 * @throws If persistence fails (store errors propagate).
 */
export async function createResolutionAgentForCase(
  params: CreateAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { authenticatedCaller, caseIdentity, approvedBudgetAtomic, now, store } = params;

  // 1. Validate budget
  validateApprovedBudget(approvedBudgetAtomic);

  // 2. Check for existing agent by case identity
  const existingAgent = await store.getAgentByCaseIdentity(
    caseIdentity.escrowChainId,
    caseIdentity.escrowContractAddress,
    caseIdentity.escrowPaymentId,
  );

  if (existingAgent) {
    // Same funder → idempotent return
    if (
      existingAgent.policy.funderAddress.toLowerCase() ===
      authenticatedCaller.toLowerCase()
    ) {
      return toResolutionAgentPublicView(existingAgent);
    }

    // Different funder → conflict
    throw new Error(
      "A resolution agent already exists for this payment case with a different funder. " +
        "Only one resolution agent may be created per case.",
    );
  }

  // 3. Generate deterministic agent ID
  const agentId = `agt_${crypto.randomUUID()}`;

  // 4. Parse encryption key
  const encryptionKey = parseWalletEncryptionKey(
    process.env[WALLET_ENCRYPTION_KEY_ENV],
  );

  // 5. Generate encrypted case wallet
  const { address: caseWalletAddress, encryptedSecret } =
    await generateEncryptedCaseWallet({
      agentId,
      caseIdentity,
      encryptionKey,
    });

  // 6. Build the initial domain object (status: "draft")
  const allowedTools: ResolutionAgentToolId[] = V1_TOOLS.map((t) => t.id);
  const expiresAt = now + DEFAULT_EXPIRY_MS;

  const initialAgent: ResolutionAgent = {
    id: agentId,
    goal: FIXED_AGENT_GOAL,
    status: "draft",
    identity: caseIdentity,
    policy: {
      allowedTools,
      approvedBudgetAtomic,
      expiresAt,
      funderAddress: authenticatedCaller.toLowerCase(),
    },
    budget: createBudget(approvedBudgetAtomic),
    plan: null,
    observation: null,
    caseWalletAddress,
    encryptedSecret,
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    pausedAt: null,
    closedAt: null,
  };

  // 7. Persist (version 1 in database)
  await store.createAgent(initialAgent);

  // 8. Transition: draft → awaiting_funding
  const transitionCtx: TransitionContext = {
    fundingConfirmed: false,
    activationApproved: false,
    now,
  };
  const awaitingFundingAgent = transitionAgentStatus(
    initialAgent,
    "awaiting_funding",
    transitionCtx,
  );

  // 9. Update with optimistic concurrency (version 1 → 2)
  await store.updateAgent(awaitingFundingAgent, /* expectedVersion */ 1);

  // 10. Append creation event
  await store.appendEvent(
    agentId,
    "created",
    "Resolution agent created for payment case.",
    null,
    awaitingFundingAgent.status,
    {
      funderAddress: authenticatedCaller,
      approvedBudgetAtomic: approvedBudgetAtomic.toString(),
      caseWalletAddress,
      escrowPaymentId: caseIdentity.escrowPaymentId,
    },
  );

  // 11. Append status-change event
  await store.appendEvent(
    agentId,
    "status_change",
    "Agent transitioned to awaiting funding.",
    initialAgent.status,
    awaitingFundingAgent.status,
  );

  // 12. Return public-safe view
  return toResolutionAgentPublicView(awaitingFundingAgent);
}

// ---------------------------------------------------------------------------
// Public API: getResolutionAgentPublicView
// ---------------------------------------------------------------------------

/**
 * Reads an agent by ID and returns its public-safe view.
 *
 * Only the original funder may view the agent.  This prevents unauthorised
 * enumeration of agent IDs.
 *
 * @throws If the agent is not found.
 * @throws If the caller is not the agent's funder.
 */
export async function getResolutionAgentPublicView(params: {
  agentId: string;
  authenticatedCaller: string;
  store: ResolutionAgentStore;
}): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, store } = params;

  const agent = await store.getAgentById(agentId);

  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // Only the original funder may view this agent
  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may view this agent.",
    );
  }

  return toResolutionAgentPublicView(agent);
}

// ---------------------------------------------------------------------------
// Public API: refreshFundingStatus
// ---------------------------------------------------------------------------

/**
 * Checks the on-chain USDC balance of the agent's case wallet and, if the
 * balance meets or exceeds the approved budget, advances the agent through
 * the funding pipeline:
 *
 *   `awaiting_funding` → `funded` → `awaiting_activation`
 *
 * # Idempotency
 * - If already in `awaiting_activation`: returns current state (no-op).
 * - If already in `active` or beyond: returns current state (no-op).
 * - If still in `awaiting_funding` and balance is insufficient: returns
 *   current state with the balance report.
 *
 * # Authorisation
 * Only the original funder may check the funding status.
 *
 * @throws If the agent is not found.
 * @throws If the caller is not the agent's funder.
 * @throws If the on-chain balance read fails.
 */
export async function refreshFundingStatus(
  params: FundingStatusParams,
): Promise<FundingStatusResponse> {
  const { agentId, authenticatedCaller, now, store, fundingReader } = params;

  // 1. Read agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Authorisation check
  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may check funding status.",
    );
  }

  // 3. Read on-chain balance
  const walletBalance = await fundingReader.getUsdcBalanceAtomic(
    agent.caseWalletAddress,
  );
  const isSufficient = walletBalance >= agent.policy.approvedBudgetAtomic;

  // Build the baseline response (used when no transition occurs)
  const baselineResponse: FundingStatusResponse = {
    agent: toResolutionAgentPublicView(agent),
    walletBalanceAtomic: walletBalance.toString(),
    isSufficientlyFunded: isSufficient,
  };

  // 4. Determine if a transition is applicable
  const currentStatus: ResolutionAgentStatus = agent.status;

  // Only transition from awaiting_funding when funds are sufficient
  if (currentStatus === "awaiting_funding" && isSufficient) {
    // Read current version for optimistic concurrency
    let currentVersion = await readAgentVersion(store, agentId);

    // Step A: awaiting_funding → funded
    const fundedTransitionCtx: TransitionContext = {
      fundingConfirmed: true,
      activationApproved: false,
      now,
    };
    const fundedAgent = transitionAgentStatus(
      agent,
      "funded",
      fundedTransitionCtx,
    );

    await store.updateAgent(fundedAgent, currentVersion);
    currentVersion++;

    await store.appendEvent(
      agentId,
      "status_change",
      "Funding confirmed — wallet balance meets approved budget.",
      currentStatus,
      fundedAgent.status,
      {
        walletBalanceAtomic: walletBalance.toString(),
        approvedBudgetAtomic: agent.policy.approvedBudgetAtomic.toString(),
      },
    );

    // Step B: funded → awaiting_activation
    const awaitingActivationTransitionCtx: TransitionContext = {
      fundingConfirmed: false,
      activationApproved: false,
      now,
    };
    const awaitingActivationAgent = transitionAgentStatus(
      fundedAgent,
      "awaiting_activation",
      awaitingActivationTransitionCtx,
    );

    await store.updateAgent(awaitingActivationAgent, currentVersion);
    // currentVersion++ not needed — no further transitions in this call

    await store.appendEvent(
      agentId,
      "status_change",
      "Agent is fully funded and ready for activation.",
      fundedAgent.status,
      awaitingActivationAgent.status,
    );

    return {
      agent: toResolutionAgentPublicView(awaitingActivationAgent),
      walletBalanceAtomic: walletBalance.toString(),
      isSufficientlyFunded: isSufficient,
    };
  }

  // No transition applicable — return current state
  return baselineResponse;
}

// ---------------------------------------------------------------------------
// Public API: activateResolutionAgent
// ---------------------------------------------------------------------------

/**
 * Activates a resolution agent, transitioning it from `awaiting_activation`
 * to `active`.  Once active, the agent's tools may be executed.
 *
 * # Idempotency
 * If the agent is already `active`, the call succeeds and returns the
 * current state without modification.
 *
 * # Authorisation
 * Only the original funder may activate the agent.
 *
 * # Preconditions
 * - Agent must exist.
 * - Caller must be the funder.
 * - Agent must be in `awaiting_activation` status (or already `active`).
 *
 * @throws If the agent is not found.
 * @throws If the caller is not the funder.
 * @throws If the agent is not in a status that supports activation.
 */
export async function activateResolutionAgent(
  params: ActivateAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, now, store } = params;

  // 1. Read agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Authorisation check
  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may activate this agent.",
    );
  }

  // 3. Already active (idempotent)
  if (agent.status === "active") {
    return toResolutionAgentPublicView(agent);
  }

  // 4. Validate preconditions
  if (agent.status !== "awaiting_activation") {
    throw new Error(
      `Agent cannot be activated from status "${agent.status}". ` +
        "It must be in 'awaiting_activation' state.",
    );
  }

  // 5. Read current version for optimistic concurrency
  const currentVersion = await readAgentVersion(store, agentId);

  // 6. Transition: awaiting_activation → active
  const activationCtx: TransitionContext = {
    fundingConfirmed: false,
    activationApproved: true,
    now,
  };
  const activatedAgent = transitionAgentStatus(
    agent,
    "active",
    activationCtx,
  );

  // 7. Persist with optimistic concurrency
  await store.updateAgent(activatedAgent, currentVersion);

  // 8. Append activation event
  await store.appendEvent(
    agentId,
    "status_change",
    "Agent activated by funder.",
    agent.status,
    activatedAgent.status,
  );

  // 9. Return public-safe view
  return toResolutionAgentPublicView(activatedAgent);
}
