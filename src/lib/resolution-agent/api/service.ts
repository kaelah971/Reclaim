// ---------------------------------------------------------------------------
// Resolution Agent API — core business logic service
//
// SERVER-ONLY — pure service layer.  No HTTP handling, no route definitions,
// no request/response serialisation.  Consumed by Next.js route handlers.
//
// Dependencies:
//   - SupabaseResolutionAgentStore for persistence
//   - FundingReader for on-chain balance queries
//   - EscrowCaseAuthorizationReader for on-chain party verification
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
import { decryptCaseWalletPrivateKey } from "../server/encryption";
import { privateKeyToAccount } from "viem/accounts";
import { parseWalletEncryptionKey, WALLET_ENCRYPTION_KEY_ENV } from "../server/config";
import type { FundingReader } from "./funding";
import { SUPPORTED_BUDGETS, type SupportedBudget } from "./types";
import type { EscrowCaseAuthorizationReader } from "./escrow-reader";
import {
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "./escrow-reader";
import { buildActivationMessage } from "./auth";

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
export const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 1000;

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
  /** On-chain escrow reader for party verification. */
  escrowReader: EscrowCaseAuthorizationReader;
}

export interface FundingStatusParams {
  /** The agent to check funding for. */
  agentId: string;
  /** Verified wallet address of the caller. */
  authenticatedCaller: string;
  /** Current timestamp in milliseconds since epoch. */
  now: number;
  /** Persistence store. */
  store: ResolutionAgentStore;
  /** On-chain USDC balance reader. */
  fundingReader: FundingReader;
  /** On-chain escrow reader for party verification. */
  escrowReader: EscrowCaseAuthorizationReader;
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
  /** On-chain escrow reader (for consistency). */
  escrowReader: EscrowCaseAuthorizationReader;
  /**
   * The signed activation message from the client.  The server will
   * reconstruct the canonical message from the agent's stored state and
   * verify it matches this signed message.
   */
  signedMessage: string;
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

/**
 * Checks whether `caller` is an authorized party for the given agent by
 * looking up the on-chain case parties (client/worker) via the escrow reader.
 *
 * Authorization is granted if the caller matches:
 *  1. The stored funder address, OR
 *  2. The on-chain client address, OR
 *  3. The on-chain worker address
 *
 * All comparisons are case-insensitive.
 */
async function isAuthorizedForAgent(
  agent: ResolutionAgent,
  caller: string,
  escrowReader: EscrowCaseAuthorizationReader,
): Promise<boolean> {
  // Stored funder always has access
  if (
    agent.policy.funderAddress.toLowerCase() === caller.toLowerCase()
  ) {
    return true;
  }

  // Check on-chain parties via the escrow reader
  const parties = await escrowReader.getCaseParties({
    escrowPaymentId: agent.identity.escrowPaymentId,
  });

  if (parties.exists) {
    const callerLower = caller.toLowerCase();
    if (
      parties.client.toLowerCase() === callerLower ||
      parties.worker.toLowerCase() === callerLower
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies that a signed activation message matches the agent's canonical
 * permissions by reconstructing the expected message from the agent's stored
 * state and comparing it line-by-line with the signed message.
 *
 * Variable fields (Timestamp, Nonce) are skipped in the comparison.
 * The Authorization Expires field is parsed from the signed message and
 * validated to ensure the authorization hasn't expired.
 */
function verifyActivationMessageMatchesAgent(
  signedMessage: string,
  agent: ResolutionAgent,
): void {
  // Build the canonical message from the agent's current stored state
  const canonicalMessage = buildActivationMessage({
    agentId: agent.id,
    funderAddress: agent.policy.funderAddress,
    escrowChainId: agent.identity.escrowChainId,
    escrowContractAddress: agent.identity.escrowContractAddress,
    escrowPaymentId: agent.identity.escrowPaymentId,
    goal: agent.goal,
    approvedBudgetAtomic: agent.policy.approvedBudgetAtomic,
    refundAddress: agent.policy.funderAddress,
    policyVersion: "v1",
    allowedToolIds: [...agent.policy.allowedTools],
    agentExpiresAt: agent.policy.expiresAt,
    authorizationExpiresAt: Date.now() + 5 * 60 * 1000, // placeholder, ignored in comparison
  });

  const canonicalLines = canonicalMessage.split("\n");
  const signedLines = signedMessage.split("\n");

  // Line count must match — ensures no fields were added/removed
  if (canonicalLines.length !== signedLines.length) {
    throw new Error(
      "Activation authorization does not match the agent's canonical permissions.",
    );
  }

  // Compare line-by-line, skipping variable fields
  for (let i = 0; i < canonicalLines.length; i++) {
    const cLine = canonicalLines[i];
    const sLine = signedLines[i];

    // Skip variable fields — these differ between client and server
    if (
      cLine.startsWith("Timestamp:") ||
      cLine.startsWith("Nonce:") ||
      cLine.startsWith("Authorization Expires:")
    ) {
      continue;
    }

    if (cLine !== sLine) {
      throw new Error(
        "Activation authorization does not match the agent's canonical permissions.",
      );
    }
  }

  // Validate the authorization expiry timestamp from the signed message
  const authExpiryLine = signedLines.find((l) =>
    l.startsWith("Authorization Expires:"),
  );
  if (authExpiryLine) {
    const expiryStr = authExpiryLine.replace("Authorization Expires:", "").trim();
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry)) {
      throw new Error(
        "Invalid authorization expiry in activation message.",
      );
    }
    if (Date.now() > expiry) {
      throw new Error("Activation authorization has expired.");
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: createResolutionAgentForCase
// ---------------------------------------------------------------------------

/**
 * Creates a new resolution agent for a given payment case.
 *
 * # Flow
 * 1. Verifies the caller is a legitimate case party (client or worker)
 *    by reading the canonical escrow contract on-chain.
 * 2. Validates the approved budget against the server allowlist.
 * 3. Checks whether an agent already exists for this case identity.
 *    - Same funder  → returns the existing agent (idempotent).
 *    - Different funder → throws an error (one agent per case).
 * 4. Generates a cryptographically random case wallet and immediately
 *    encrypts the private key with the server's wallet encryption key.
 *    The plaintext private key is never persisted or returned.
 * 5. Constructs the domain object with status "draft".
 * 6. Persists via the store (version 1).
 * 7. Transitions to "awaiting_funding" and updates (version 2).
 * 8. Appends a creation event.
 * 9. Returns a public-safe view (no encrypted secrets exposed).
 *
 * # Idempotency
 * If the same funder calls this twice with the same case identity, the
 * second call returns the existing agent unchanged.
 *
 * @throws If the budget is not in the server allowlist.
 * @throws If the caller is not a valid case party (client or worker).
 * @throws If the payment does not exist on-chain.
 * @throws If an agent already exists for this case with a different funder.
 * @throws If wallet generation or encryption fails.
 * @throws If persistence fails (store errors propagate).
 */
export async function createResolutionAgentForCase(
  params: CreateAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { authenticatedCaller, caseIdentity, approvedBudgetAtomic, now, store, escrowReader } = params;

  // 0. Verify on-chain authorization: caller must be client or worker
  const parties = await escrowReader.getCaseParties({
    escrowPaymentId: caseIdentity.escrowPaymentId,
  });

  if (!parties.exists) {
    throw new Error(
      `Escrow payment "${caseIdentity.escrowPaymentId}" does not exist on-chain. ` +
        "The payment must be created in the escrow contract before a resolution agent can be created.",
    );
  }

  const callerLower = authenticatedCaller.toLowerCase();
  const isClient = parties.client.toLowerCase() === callerLower;
  const isWorker = parties.worker.toLowerCase() === callerLower;

  if (!isClient && !isWorker) {
    throw new Error(
      "Access denied: only the client or worker of this escrow payment may create a resolution agent.",
    );
  }

  // 1. Validate budget
  validateApprovedBudget(approvedBudgetAtomic);

  // 2. Check for existing agent by case identity (using canonical escrow address)
  const existingAgent = await store.getAgentByCaseIdentity(
    caseIdentity.escrowChainId,
    CANONICAL_ESCROW_CONTRACT_ADDRESS,
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

  // 6. Build the initial domain object with canonical escrow contract address
  const canonicalCaseIdentity: AgentCaseIdentity = {
    escrowPaymentId: caseIdentity.escrowPaymentId,
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
  };

  const allowedTools: ResolutionAgentToolId[] = V1_TOOLS.map((t) => t.id);
  const expiresAt = now + DEFAULT_EXPIRY_MS;

  const initialAgent: ResolutionAgent = {
    id: agentId,
    goal: FIXED_AGENT_GOAL,
    status: "draft",
    identity: canonicalCaseIdentity,
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
    reclaimAmountAtomic: null,
    reclaimDestination: null,
    reclaimNonce: null,
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
 * # Authorisation
 * Access is granted if the caller is:
 *  1. The stored funder address, OR
 *  2. The on-chain client of the escrow payment, OR
 *  3. The on-chain worker of the escrow payment
 *
 * This prevents unauthorised enumeration of agent IDs while allowing both
 * parties of a payment case to view the resolution agent.
 *
 * @throws If the agent is not found.
 * @throws If the caller is not authorized.
 */
export async function getResolutionAgentPublicView(params: {
  agentId: string;
  authenticatedCaller: string;
  store: ResolutionAgentStore;
  escrowReader: EscrowCaseAuthorizationReader;
}): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, store, escrowReader } = params;

  const agent = await store.getAgentById(agentId);

  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // Verify authorization: funder, client, or worker
  const authorized = await isAuthorizedForAgent(agent, authenticatedCaller, escrowReader);
  if (!authorized) {
    throw new Error(
      "Access denied: only the agent's funder or the escrow case parties (client/worker) may view this agent.",
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
 * Access is granted if the caller is the stored funder, the on-chain client,
 * or the on-chain worker.
 *
 * @throws If the agent is not found.
 * @throws If the caller is not authorized.
 * @throws If the on-chain balance read fails.
 */
export async function refreshFundingStatus(
  params: FundingStatusParams,
): Promise<FundingStatusResponse> {
  const { agentId, authenticatedCaller, now, store, fundingReader, escrowReader } = params;

  // 1. Read agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Authorisation check (funder, client, or worker)
  const authorized = await isAuthorizedForAgent(agent, authenticatedCaller, escrowReader);
  if (!authorized) {
    throw new Error(
      "Access denied: only the agent's funder or the escrow case parties may check funding status.",
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
 * Only the original funder may activate the agent.  This is enforced by
 * both the standard auth check AND verification that the signed activation
 * message matches the agent's canonical permissions.
 *
 * # Activation message verification (CRITICAL HARDENING)
 * The server reconstructs the canonical activation message from the agent's
 * stored state (all permissions, tools, budget, expiry) and compares it
 * against the signed message provided by the client.  If they don't match,
 * the activation is rejected — even if the signature is valid.
 *
 * @throws If the agent is not found.
 * @throws If the caller is not the funder.
 * @throws If the signed activation message does not match the agent's
 *         canonical permissions.
 * @throws If the authorization expiry has passed.
 * @throws If the agent is not in a status that supports activation.
 */
export async function activateResolutionAgent(
  params: ActivateAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, now, store, signedMessage } = params;

  // 1. Read agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Authorisation check — only the original funder may activate
  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may activate this agent.",
    );
  }

  // 3. Verify the signed activation message matches the agent's canonical
  //    permissions (CRITICAL HARDENING — prevents signature reuse)
  verifyActivationMessageMatchesAgent(signedMessage, agent);

  // 4. Already active (idempotent)
  if (agent.status === "active") {
    return toResolutionAgentPublicView(agent);
  }

  // 5. Validate preconditions
  if (agent.status !== "awaiting_activation") {
    throw new Error(
      `Agent cannot be activated from status "${agent.status}". ` +
        "It must be in 'awaiting_activation' state.",
    );
  }

  // 6. Read current version for optimistic concurrency
  const currentVersion = await readAgentVersion(store, agentId);

  // 7. Transition: awaiting_activation → active
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

  // 8. Persist with optimistic concurrency
  await store.updateAgent(activatedAgent, currentVersion);

  // 9. Append activation event
  await store.appendEvent(
    agentId,
    "status_change",
    "Agent activated by funder after canonical permission verification.",
    agent.status,
    activatedAgent.status,
  );

  // 10. Return public-safe view
  return toResolutionAgentPublicView(activatedAgent);
}

// ---------------------------------------------------------------------------
// Public API: pauseResolutionAgent
// ---------------------------------------------------------------------------

export interface PauseAgentParams {
  agentId: string;
  authenticatedCaller: string;
  now: number;
  store: ResolutionAgentStore;
}

/**
 * Pauses a resolution agent, preventing new autonomous work.
 *
 * # Eligibility
 * The agent must be in a pausable state (active, waiting_for_evidence,
 * waiting_for_human_approval, ready_for_human_review, budget_exhausted,
 * or failed_recoverable).  running_tool is NOT pausable — wait for the
 * tool execution to complete.
 *
 * # Idempotency
 * Already-paused agents return safely without change or duplicate events.
 *
 * # Safety
 * - running_tool is rejected — prevents race between pause and wallet
 *   decryption / x402 signing / facilitator settlement
 * - No budget change
 * - No wallet decryption
 * - No x402 execution
 * - No evidence request cancellation
 *
 * # Authorisation
 * Only the original funder may pause.
 *
 * @throws If the agent is not found or cannot be transitioned.
 */
export async function pauseResolutionAgent(
  params: PauseAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, now, store } = params;

  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may pause this agent.",
    );
  }

  // Cannot pause while running_tool — the worker may be mid-execution
  // and pause would create a race between wallet decryption, x402 signing,
  // and settlement.  Wait for the tool execution to reach a recoverable
  // boundary (completed/failed/settled) before pausing.
  if (agent.status === "running_tool") {
    throw new Error(
      "Agent is currently executing a paid tool. " +
        "Wait for the tool execution to complete or reach a recoverable state before pausing.",
    );
  }

  // Idempotent — already paused
  if (agent.status === "paused") {
    return toResolutionAgentPublicView(agent);
  }

  // Cannot pause from terminal states
  if (agent.status === "closed" || agent.status === "closing" || agent.status === "expired") {
    throw new Error(
      `Agent cannot be paused from status "${agent.status}".`,
    );
  }

  const currentVersion = await readAgentVersion(store, agentId);

  const transitionCtx: TransitionContext = { now };
  const pausedAgent = transitionAgentStatus(agent, "paused", transitionCtx);

  await store.updateAgent(pausedAgent, currentVersion);

  await store.appendEvent(
    agentId,
    "agent_paused",
    "Agent paused by funder",
    agent.status,
    pausedAgent.status,
    { pausedBy: authenticatedCaller },
  );

  return toResolutionAgentPublicView(pausedAgent);
}

// ---------------------------------------------------------------------------
// Public API: resumeResolutionAgent
// ---------------------------------------------------------------------------

export interface ResumeAgentParams {
  agentId: string;
  authenticatedCaller: string;
  now: number;
  store: ResolutionAgentStore;
}

/**
 * Resumes a paused resolution agent.
 *
 * # Eligibility
 * The agent must currently be in "paused" status.
 *
 * # Target State
 * Always resumes to "active".  The next worker iteration handles
 * observation, recovery classification, and planning automatically.
 * Waiting conditions (evidence requests, in-flight tools) are
 * reconstructed by the planner, not bypassed.
 *
 * # Idempotency
 * Non-paused agents return safely without change or duplicate events.
 *
 * # Safety
 * - No budget change
 * - No wallet decryption
 * - No worker execution
 * - No tool execution
 * - No x402 settlement
 *
 * # Authorisation
 * Only the original funder may resume.
 *
 * @throws If the agent is not found or cannot be transitioned.
 */
export async function resumeResolutionAgent(
  params: ResumeAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, now, store } = params;

  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  if (
    agent.policy.funderAddress.toLowerCase() !==
    authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may resume this agent.",
    );
  }

  // Idempotent — not paused
  if (agent.status !== "paused") {
    return toResolutionAgentPublicView(agent);
  }

  const currentVersion = await readAgentVersion(store, agentId);

  const transitionCtx: TransitionContext = { now };
  const resumedAgent = transitionAgentStatus(agent, "active", transitionCtx);

  await store.updateAgent(resumedAgent, currentVersion);

  await store.appendEvent(
    agentId,
    "agent_resumed",
    "Agent resumed by funder",
    agent.status,
    resumedAgent.status,
    { resumedBy: authenticatedCaller },
  );

  return toResolutionAgentPublicView(resumedAgent);
}

// ---------------------------------------------------------------------------
// Reclaim Transfer Abstraction
// ---------------------------------------------------------------------------

/**
 * Abstraction for transferring USDC from the case wallet to the funder.
 * The production implementation uses viem to construct and broadcast an
 * ERC-20 transfer on Celo Mainnet.
 *
 * Tests inject a mock to avoid live RPC calls.
 */
export interface ReclaimTransferClient {
  fetchNonce(from: string): Promise<number>;
  transferUsdc(params: {
    privateKey: string;
    from: string;
    to: string;
    amountAtomic: bigint;
    storedNonce?: number;
  }): Promise<{ txHash: string; nonce: number }>;
}

// ---------------------------------------------------------------------------
// Public API: closeResolutionAgent
// ---------------------------------------------------------------------------

export interface CloseAgentParams {
  agentId: string;
  authenticatedCaller: string;
  now: number;
  store: ResolutionAgentStore;
  fundingReader: FundingReader;
  transferClient: ReclaimTransferClient;
}

/**
 * Close a resolution agent and reclaim unused USDC from the case wallet.
 *
 * # Flow
 * 1. Authenticate — only the original funder may close.
 * 2. Validate close eligibility:
 *    - NOT running_tool
 *    - No in-flight tool executions (pending, settling, paid_pending_result)
 *    - No unresolved reserved budget (reservedAtomic must be 0)
 *    - Not already closed
 *    - Not in draft / awaiting_funding
 * 3. Read the actual on-chain USDC balance of the case wallet.
 * 4. Compute reclaimable amount.
 * 5. Transfer USDC from case wallet → funder address.
 * 6. Mark the agent closed.
 * 7. Append close/reclaim events.
 *
 * # Safety
 * - Only the funder may close
 * - Reclaim destination is always the stored funder address
 * - Actual wallet balance determines transfer amount (not approved - spent)
 * - Escrow contract is never touched
 * - Zero-balance wallets close without a transaction
 *
 * # Idempotency
 * - Already-closed agents return safely
 * - Concurrent close attempts guarded by optimistic versioning
 */
export async function closeResolutionAgent(
  params: CloseAgentParams,
): Promise<ResolutionAgentPublicView> {
  const { agentId, authenticatedCaller, now, store, fundingReader, transferClient } = params;

  // 1. Load agent
  const agent = await store.getAgentById(agentId);
  if (!agent) {
    throw new ResolutionAgentNotFoundError(agentId);
  }

  // 2. Auth — only funder
  if (
    agent.policy.funderAddress.toLowerCase() !== authenticatedCaller.toLowerCase()
  ) {
    throw new Error(
      "Access denied: only the agent's funder may close this agent.",
    );
  }

  // 3. Already closed — idempotent
  if (agent.status === "closed") {
    return toResolutionAgentPublicView(agent);
  }

  // 4. Cannot close while running_tool
  if (agent.status === "running_tool") {
    throw new Error(
      "Agent is currently executing a paid tool. Wait for the tool execution to complete before closing.",
    );
  }

  // 5. Cannot close draft/awaiting_funding (no wallet yet)
  if (agent.status === "draft" || agent.status === "awaiting_funding") {
    throw new Error(
      `Agent cannot be closed from status "${agent.status}".`,
    );
  }

  // 6. Check for unresolved tool executions
  const toolExecutions = await (store as ResolutionAgentStore & { listToolExecutions(agentId: string): Promise<{ state: string }[]> }).listToolExecutions(agentId);
  const hasInFlight = toolExecutions.some(
    (te: { state: string }) =>
      te.state === "pending" || te.state === "settling" || te.state === "paid_pending_result",
  );
  if (hasInFlight) {
    throw new Error(
      "Cannot close while there are in-flight tool executions. Wait for them to settle or recover before closing.",
    );
  }

  // 7. Check reserved budget is resolved
  if (agent.budget.reservedAtomic > 0n) {
    throw new Error(
      `Cannot close while there is reserved budget (${agent.budget.reservedAtomic} atomic USDC). Tool reservations must be released or spent first.`,
    );
  }

  // 8. Check for persisted reclaim intent from a previous attempt
  //    (crash recovery: if reclaim was prepared but not completed,
  //     reuse the exact same amount, destination, and nonce)
  let reclaimAmount: bigint;
  let destination: string;
  let reclaimNonce: number | null = agent.reclaimNonce ?? null;

  const hasPreparedReclaim = agent.reclaimAmountAtomic !== null &&
    agent.reclaimDestination !== null;

  if (hasPreparedReclaim) {
    // Retry path: freeze the original intent — do NOT re-read balance
    reclaimAmount = agent.reclaimAmountAtomic!;
    destination = agent.reclaimDestination!;
  } else {
    // First attempt: read actual on-chain USDC balance
    try {
      reclaimAmount = await fundingReader.getUsdcBalanceAtomic(agent.caseWalletAddress);
    } catch {
      throw new Error("Failed to read the case wallet's USDC balance from Celo Mainnet.");
    }
    destination = agent.policy.funderAddress;
  }

  // 9. Transition to closing (skip if already closing)
  const closingStore = store as ResolutionAgentStore & { getAgentVersion(id: string): Promise<number> };
  const currentVersion = await closingStore.getAgentVersion(agentId);

  let closingAgent: ResolutionAgent;
  if (agent.status === "closing") {
    closingAgent = agent;
  } else {
    closingAgent = transitionAgentStatus(agent, "closing", { now });
    await store.updateAgent(closingAgent, currentVersion);
  }

  await store.appendEvent(
    agentId,
    "agent_closing",
    "Agent closing initiated by funder",
    agent.status,
    closingAgent.status,
    { reclaimAmount: reclaimAmount.toString(), destination },
  );

  // 10. Reclaim USDC if balance > 0
  if (reclaimAmount > 0n) {
    try {
      const encryptionKey = parseWalletEncryptionKey(
        process.env[WALLET_ENCRYPTION_KEY_ENV],
      );
      const privateKey = decryptCaseWalletPrivateKey({
        encryptedSecret: closingAgent.encryptedSecret,
        caseIdentity: closingAgent.identity,
        agentId: closingAgent.id,
        encryptionKey,
      });

      const account = privateKeyToAccount(privateKey as `0x${string}`);
      if (account.address.toLowerCase() !== closingAgent.caseWalletAddress.toLowerCase()) {
        throw new Error("Decrypted wallet address does not match persisted case wallet address.");
      }

      // Freeze reclaim intent: if not already set, persist amount + destination + nonce
      // BEFORE broadcast. On retry, these exact values are reused.
      if (!hasPreparedReclaim) {
        reclaimNonce = await transferClient.fetchNonce(account.address);

        // Persist frozen intent on the agent row (survives process crash)
        const intentAgent: ResolutionAgent = {
          ...closingAgent,
          reclaimAmountAtomic: reclaimAmount,
          reclaimDestination: destination,
          reclaimNonce,
        };
        const preBroadcastVersion = await closingStore.getAgentVersion(agentId);
        await store.updateAgent(intentAgent, preBroadcastVersion);
        closingAgent = intentAgent;
      }

      await store.appendEvent(
        agentId,
        "agent_reclaim_prepared",
        `Preparing to reclaim ${reclaimAmount} atomic USDC to ${destination} (nonce ${reclaimNonce})`,
        "closing",
        null,
        { reclaimAmount: reclaimAmount.toString(), destination, nonce: reclaimNonce },
      );

      const { txHash, nonce } = await transferClient.transferUsdc({
        privateKey,
        from: account.address,
        to: destination,
        amountAtomic: reclaimAmount,
        storedNonce: reclaimNonce ?? undefined,
      });

      await store.appendEvent(
        agentId,
        "agent_reclaim",
        `Reclaimed ${reclaimAmount} atomic USDC to ${destination} (tx ${txHash})`,
        "closing",
        null,
        { reclaimAmount: reclaimAmount.toString(), destination, txHash, nonce },
      );
    } catch (err) {
      // If the transfer fails, the agent stays in "closing" for retry
      await store.appendEvent(
        agentId,
        "agent_reclaim_failed",
        `Reclaim failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        "closing",
        null,
        {},
      );
      throw new Error(
        `Reclaim transfer failed: ${err instanceof Error ? err.message : "Unknown error"}. The agent remains in closing state for retry.`,
      );
    }
  }

  // 12. Mark closed
  const closingVersion = await closingStore.getAgentVersion(agentId);
  const closedAgent = transitionAgentStatus(closingAgent, "closed", { now });
  await store.updateAgent(closedAgent, closingVersion);

  await store.appendEvent(
    agentId,
    "agent_closed",
    "Agent permanently closed",
    closingAgent.status,
    closedAgent.status,
    { reclaimAmount: reclaimAmount.toString(), destination },
  );

  return toResolutionAgentPublicView(closedAgent);
}
