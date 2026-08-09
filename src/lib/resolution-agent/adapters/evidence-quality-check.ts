// ---------------------------------------------------------------------------
// Evidence Quality Check Adapter
//
// Implements the canonical tool execution flow:
//   1. Validate action identity (canonical tool config)
//   2. Version / hash consistency checks
//   3. Handle existing execution (dedup, recovery, waiting)
//   4. Create new execution: reserve → decrypt → settle → generate → persist
//
// SERVER-ONLY — do NOT export from the public barrel.
// ---------------------------------------------------------------------------

import type { ResolutionAgent, ResolutionAgentPlan } from "../types";
import type { ResolutionAgentNextAction } from "../planner/types";
import type { ActionExecutionResult, LeaseContext } from "../worker/types";
import type { ToolExecutionRow } from "../store/types";
import type {
  EvidenceQualityCheckDependencies,
  X402SettlementResult,
} from "./types";
import {
  buildEvidenceCheckInput,
  computeEvidenceInputHash,
  type ServiceInput,
} from "./evidence-quality-input";
import { normalizeEvidenceQualityResult } from "./evidence-quality-result";
import {
  computeEvidenceCheckHash,
  EVIDENCE_CHECK_SERVICE_IDENTIFIER,
} from "../../x402/requestHash";
import { applySpend, releaseReservation } from "../budget";
import { transitionAgentStatus } from "../state-machine";
import {
  EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC,
} from "../tools";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
  type AgentCaseIdentity,
} from "../types";
import type { EvidenceCheckIdentity } from "../../x402/requestHash";

// ---------------------------------------------------------------------------
// Canonical tool configuration constants
// ---------------------------------------------------------------------------

const CANONICAL_TOOL_ID = "evidence-quality-check" as const;
const CANONICAL_PRICE = EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC; // 10000n
const CANONICAL_NETWORK = AGENT_FACILITATOR_NETWORK; // "eip155:42220"
const CANONICAL_ASSET = AGENT_MAINNET_USDC_ADDRESS;
const CANONICAL_PAY_TO = AGENT_PAY_TO_ADDRESS;

// ---------------------------------------------------------------------------
// Main adapter entry point
// ---------------------------------------------------------------------------

export async function executeEvidenceQualityCheck(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction;
  leaseContext: LeaseContext;
  now: number;
  dependencies: EvidenceQualityCheckDependencies;
}): Promise<ActionExecutionResult> {
  const { agent, plan, action, leaseContext, now, dependencies } = params;
  const { store } = dependencies;

  // ---- Step 1: Validate action kind ---------------------------------------
  if (action.kind !== "run_tool") {
    return { kind: "skipped", reason: `Action kind is not run_tool: ${action.kind}` };
  }

  // ---- Step 2: Validate tool identity -------------------------------------
  const validationError = validateCanonicalToolConfig(action);
  if (validationError) {
    return validationError;
  }

  // ---- Step 3: Validate plan hashes / lease agent ID match -----------------
  const hashError = validatePlanHashConsistency(agent, plan, leaseContext);
  if (hashError) {
    return hashError;
  }

  // ---- Step 4: Reconstruct canonical request identity ---------------------
  const observation = agent.observation;
  if (!observation) {
    return { kind: "skipped", reason: "Agent has no observation — cannot build service input" };
  }
  const evidenceInput = buildServiceInput(
    agent.identity,
    observation,
    agent.caseWalletAddress,
  );
  const evidenceInputHash = computeEvidenceInputHash(evidenceInput);
  const requestHash = computeCanonicalRequestHash(
    agent.identity,
    agent.caseWalletAddress,
    evidenceInputHash,
  );

  // ---- Step 5: Check for existing execution -------------------------------
  const existing = await store.getToolExecutionByRequestHash(
    agent.id,
    requestHash,
  );

  if (existing) {
    return handleExistingExecution({ existing });
  }

  // ---- Step 6: Create new execution ---------------------------------------
  return createExecution({
    agent,
    plan,
    leaseContext,
    now,
    dependencies,
    evidenceInput,
    evidenceInputHash,
    requestHash,
  });
}

// ---------------------------------------------------------------------------
// Canonical validation
// ---------------------------------------------------------------------------

function validateCanonicalToolConfig(
  action: ResolutionAgentNextAction & { kind: "run_tool" },
): ActionExecutionResult | null {
  const { toolId, toolRequest } = action;

  if (toolId !== CANONICAL_TOOL_ID) {
    return {
      kind: "unsupported_action",
      actionKind: toolId,
    };
  }

  if (toolRequest.priceAtomic !== CANONICAL_PRICE) {
    return {
      kind: "skipped",
      reason: `Price mismatch: expected ${CANONICAL_PRICE}, got ${toolRequest.priceAtomic}`,
    };
  }

  if (toolRequest.network !== CANONICAL_NETWORK) {
    return {
      kind: "skipped",
      reason: `Network mismatch: expected ${CANONICAL_NETWORK}, got ${toolRequest.network}`,
    };
  }

  if (toolRequest.asset !== CANONICAL_ASSET) {
    return {
      kind: "skipped",
      reason: `Asset mismatch: expected ${CANONICAL_ASSET}, got ${toolRequest.asset}`,
    };
  }

  if (toolRequest.payTo !== CANONICAL_PAY_TO) {
    return {
      kind: "skipped",
      reason: `PayTo mismatch: expected ${CANONICAL_PAY_TO}, got ${toolRequest.payTo}`,
    };
  }

  return null; // all checks passed
}

// ---------------------------------------------------------------------------
// Plan hash consistency validation
// ---------------------------------------------------------------------------

function validatePlanHashConsistency(
  agent: ResolutionAgent,
  plan: ResolutionAgentPlan,
  leaseContext: LeaseContext,
): ActionExecutionResult | null {
  if (leaseContext.agentId !== agent.id) {
    return {
      kind: "failed_safe",
      reason: `Lease agent ID mismatch: ${leaseContext.agentId} vs ${agent.id}`,
    };
  }

  if (agent.observation) {
    if (plan.caseVersionHash !== agent.observation.caseVersionHash) {
      return { kind: "stale_plan" };
    }
    if (plan.evidenceVersionHash !== agent.observation.evidenceVersionHash) {
      return { kind: "stale_plan" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build service input from observation
// ---------------------------------------------------------------------------

function buildServiceInput(
  caseIdentity: AgentCaseIdentity,
  observation: NonNullable<ResolutionAgent["observation"]>,
  caseWalletAddress: string,
): ServiceInput {
  const base = buildEvidenceCheckInput(caseIdentity, observation);
  return {
    ...base,
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    escrowPaymentId: caseIdentity.escrowPaymentId,
    payer: caseWalletAddress,
    paymentNetwork: CANONICAL_NETWORK,
    asset: CANONICAL_ASSET,
    payTo: CANONICAL_PAY_TO,
    amount: String(CANONICAL_PRICE),
    scheme: "exact",
  };
}

// ---------------------------------------------------------------------------
// Compute canonical request hash
// ---------------------------------------------------------------------------

function computeCanonicalRequestHash(
  caseIdentity: AgentCaseIdentity,
  payer: string,
  evidenceInputHash: string,
): string {
  const identity: EvidenceCheckIdentity = {
    service: EVIDENCE_CHECK_SERVICE_IDENTIFIER,
    escrowChainId: caseIdentity.escrowChainId,
    escrowContractAddress: caseIdentity.escrowContractAddress,
    escrowPaymentId: caseIdentity.escrowPaymentId,
    payer: payer.toLowerCase(),
    paymentNetwork: CANONICAL_NETWORK,
    asset: CANONICAL_ASSET.toLowerCase(),
    payTo: CANONICAL_PAY_TO.toLowerCase(),
    amount: String(CANONICAL_PRICE),
    scheme: "exact",
    evidenceInputHash,
  };
  return computeEvidenceCheckHash(identity);
}

// ---------------------------------------------------------------------------
// Handle existing execution (dedup / recovery / waiting)
// ---------------------------------------------------------------------------

async function handleExistingExecution(params: {
  existing: ToolExecutionRow;
}): Promise<ActionExecutionResult> {
  const { existing } = params;

  switch (existing.state) {
    case "settled": {
      return { kind: "executed" };
    }

    case "paid_pending_result": {
      return { kind: "waiting", reason: "paid_pending_result — recovery needed" };
    }

    case "settling":
    case "reserved":
    case "pending": {
      return {
        kind: "waiting",
        reason: `Execution in state "${existing.state}" — waiting for completion`,
      };
    }

    case "failed_unpaid": {
      return {
        kind: "skipped",
        reason: "Execution previously confirmed unpaid — planner must decide retry",
      };
    }

    case "failed_recoverable": {
      return {
        kind: "waiting",
        reason: "Execution in failed_recoverable state — recovery may retry",
      };
    }

    case "cancelled": {
      return {
        kind: "skipped",
        reason: "Execution was cancelled — no recovery",
      };
    }

    default: {
      return {
        kind: "waiting",
        reason: `Unknown execution state: ${existing.state}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Create new execution (the full flow)
//
// Uses the atomic RPC function reserve_resolution_agent_tool_execution
// to reserve budget, create an execution row, and transition to running_tool
// in a single PostgreSQL transaction.  This eliminates the crash-vulnerable
// window between budget reservation and execution creation that existed in
// the previous multi-step client-side sequence.
// ---------------------------------------------------------------------------

async function createExecution(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  leaseContext: LeaseContext;
  now: number;
  dependencies: EvidenceQualityCheckDependencies;
  evidenceInput: ServiceInput;
  evidenceInputHash: string;
  requestHash: string;
}): Promise<ActionExecutionResult> {
  const {
    agent,
    plan,
    now,
    dependencies,
    evidenceInput,
    requestHash,
  } = params;
  const { store, settlementClient, generator, walletDecryptor, paymentStore } =
    dependencies;

  // ---- Step 6a: Version check (concurrency guard) -------------------------
  const currentVersion = await store.getAgentVersion(agent.id);

  // ---- Step 6b: Atomic RPC — reserve budget + create execution + transition
  // The RPC handles everything atomically:
  //   1. Locks the agent row with FOR UPDATE
  //   2. Validates version, lifecycle, budget
  //   3. Checks for idempotent existing execution
  //   4. Creates execution in 'reserved' state
  //   5. Updates agent: reserved_budget += price, current_running_tool_id, status = 'running_tool'
  // All within a single database transaction.
  let rpcResult;
  try {
    rpcResult = await store.reserveToolExecutionAtomically({
      agentId: agent.id,
      expectedAgentVersion: currentVersion,
      requestHash,
      toolId: CANONICAL_TOOL_ID,
      caseVersionHash: plan.caseVersionHash,
      evidenceVersionHash: plan.evidenceVersionHash,
      priceAtomic: CANONICAL_PRICE,
      network: CANONICAL_NETWORK,
      asset: CANONICAL_ASSET,
      payTo: CANONICAL_PAY_TO,
      serviceIdentifier: CANONICAL_TOOL_ID,
      policyVersion: "v1",
      now,
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? "";
    if (msg.includes("Agent not found")) {
      return { kind: "failed_safe", reason: "Agent not found during atomic reservation" };
    }
    if (msg.includes("Version conflict")) {
      return { kind: "failed_recoverable", reason: "Version conflict during atomic reservation" };
    }
    if (msg.includes("status") || msg.includes("cannot start")) {
      return { kind: "skipped", reason: "Agent is not in a state that allows tool execution" };
    }
    if (msg.includes("budget") || msg.includes("Insufficient")) {
      return { kind: "skipped", reason: "Insufficient budget for tool execution" };
    }
    return { kind: "failed_recoverable", reason: `Atomic reservation failed: ${msg}` };
  }

  // ---- Step 6c: Handle existing execution (idempotent return from RPC) ----
  if (rpcResult.kind === "existing") {
    // A concurrent call already created this execution — deduce result from state
    switch (rpcResult.state) {
      case "settled":
        return { kind: "executed" };
      case "paid_pending_result":
        return { kind: "waiting", reason: "paid_pending_result — recovery needed" };
      case "settling":
      case "reserved":
      case "pending":
        return { kind: "waiting", reason: `Execution in state "${rpcResult.state}" — waiting for completion` };
      case "failed_unpaid":
        return { kind: "skipped", reason: "Execution previously confirmed unpaid — planner must decide retry" };
      case "failed_recoverable":
        return { kind: "waiting", reason: "Execution in failed_recoverable state — recovery may retry" };
      case "cancelled":
        return { kind: "skipped", reason: "Execution was cancelled — no recovery" };
      default:
        return { kind: "waiting", reason: `Unknown execution state: ${rpcResult.state}` };
    }
  }

  // ---- Step 6d: Reload agent from store to get the updated state ----------
  const freshAgent = await store.getAgentById(agent.id);
  if (!freshAgent) {
    return { kind: "failed_safe", reason: "Agent not found after atomic reservation" };
  }

  // Validate the fresh agent has the expected state after the RPC
  if (freshAgent.status !== "running_tool") {
    return { kind: "failed_recoverable", reason: "Agent status not running_tool after reservation" };
  }
  if (freshAgent.currentRunningToolId !== CANONICAL_TOOL_ID) {
    return { kind: "failed_recoverable", reason: "currentRunningToolId not set after reservation" };
  }

  let currentAgentVersion = currentVersion + 1; // RPC incremented version

  await store.appendEvent(
    agent.id,
    "tool_execution_started",
    "Reserved budget and entered running_tool via atomic RPC",
    "active",
    "running_tool",
    { toolId: CANONICAL_TOOL_ID, requestHash },
  );

  // ---- Step 6e: Decrypt case wallet ---------------------------------------
  let account;
  try {
    account = await walletDecryptor.decrypt({
      encryptedSecret: agent.encryptedSecret,
      caseIdentity: agent.identity,
      agentId: agent.id,
    });
  } catch {
    // Decryption failed — release reservation, mark failed_unpaid
    await releaseReservationAndMarkFailed(
      store, agent, freshAgent, requestHash, now, currentAgentVersion,
      "Wallet decryption failed",
    );
    return {
      kind: "failed_recoverable",
      reason: "Wallet decryption failed",
    };
  }

  // ---- Step 6f: Verify decrypted address matches persisted address --------
  if (account.address.toLowerCase() !== agent.caseWalletAddress.toLowerCase()) {
    await releaseReservationAndMarkFailed(
      store, agent, freshAgent, requestHash, now, currentAgentVersion,
      "Wallet address mismatch",
    );
    return {
      kind: "failed_safe",
      reason: "Decrypted wallet address does not match persisted caseWalletAddress",
    };
  }

  // ---- Step 6g: Settle through x402 settlement client ---------------------
  let settlementResult: X402SettlementResult;
  try {
    settlementResult = await settlementClient.settleEvidenceQualityCheck({
      payerAccount: account,
      requestHash,
      serviceInput: evidenceInput,
      expectedPriceAtomic: CANONICAL_PRICE,
      network: CANONICAL_NETWORK,
      asset: CANONICAL_ASSET,
      payTo: CANONICAL_PAY_TO,
    });
  } catch {
    // Settlement threw before any result — attempt to release the unpaid
    // reservation (the release RPC independently verifies zero settlement
    // before touching anything; best-effort, never fatal).
    await releaseUnpaidReservation(store, agent.id, requestHash, currentAgentVersion, now);
    await store.updateToolExecution(agent.id, requestHash, {
      state: "failed_recoverable",
      failure_reason: "Settlement threw an unexpected error",
    });
    return {
      kind: "failed_recoverable",
      reason: "Settlement threw an unexpected error",
    };
  }

  // ---- Step 6h: Handle settlement result ----------------------------------
  if (settlementResult.success) {
    // ---- Success: persist payment proof, move reserved → spent ------------
    const txHash = settlementResult.txHash;
    if (txHash) {
      try {
        await paymentStore.persistPaymentProof({
          agentId: agent.id,
          requestHash,
          txHash,
          receipt: settlementResult.receipt,
        });
      } catch {
        // Non-fatal — we still have the txHash in the execution row
      }
    }

    // Move reserved → spent
    const spentAgent: ResolutionAgent = {
      ...freshAgent,
      budget: applySpend(freshAgent.budget, CANONICAL_PRICE),
    };

    // Mark execution as paid_pending_result
    await store.updateToolExecution(agent.id, requestHash, {
      state: "paid_pending_result",
      settlement_tx_hash: txHash ?? undefined,
      payment_reference: settlementResult.receipt?.paymentIdentifier ?? null,
    });

    // Persist spent budget
    let agentAfterSpend: ResolutionAgent;
    try {
      agentAfterSpend = await store.updateAgent(spentAgent, currentAgentVersion);
      currentAgentVersion++;
    } catch {
      // Budget update failed but payment went through — mark recoverable
      return {
        kind: "failed_recoverable",
        reason: "Payment succeeded but budget update failed",
      };
    }

    // ---- Generate result --------------------------------------------------
    let generationResult;
    try {
      generationResult = await generator.generate({
        serviceInput: evidenceInput,
      });
    } catch {
      await store.updateToolExecution(agent.id, requestHash, {
        state: "paid_pending_result",
        failure_reason: "AI generation failed",
      });
      return {
        kind: "failed_recoverable",
        reason: "AI generation failed — result pending",
      };
    }

    // ---- Normalize and persist result -------------------------------------
    const outcome = normalizeEvidenceQualityResult({
      assessment: generationResult.assessment,
      evidenceVersionHash: plan.evidenceVersionHash,
      executionStatus: "settled",
    });

    await store.updateToolExecution(agent.id, requestHash, {
      state: "settled",
      result_reference: generationResult.assessment.assessmentId,
      result_data: outcome as unknown as Record<string, unknown>,
    });

    // ---- Transition agent to active ---------------------------------------
    const activeAgent = transitionAgentStatus(agentAfterSpend, "active", { now });
    try {
      await store.updateAgent(activeAgent, currentAgentVersion);
    } catch {
      // Non-fatal — execution is already settled
    }

    await store.appendEvent(
      agent.id,
      "tool_execution_settled",
      "Evidence quality check completed and settled",
      "running_tool",
      "active",
      {
        toolId: CANONICAL_TOOL_ID,
        requestHash,
        assessmentId: generationResult.assessment.assessmentId,
        qualityScore: generationResult.assessment.qualityScore,
      },
    );

    return { kind: "executed" };
  }

  if (settlementResult.ambiguous) {
    // ---- Ambiguous: mark as failed_recoverable ----------------------------
    await store.updateToolExecution(agent.id, requestHash, {
      state: "failed_recoverable",
      failure_reason: settlementResult.error ?? "Settlement outcome ambiguous",
    });

    // Do NOT release reservation — payment may have gone through
    return {
      kind: "failed_recoverable",
      reason: settlementResult.error ?? "Settlement outcome ambiguous",
    };
  }

  // ---- Confirmed unpaid: release reservation, mark failed_unpaid ----------
  await releaseReservationAndMarkFailed(
    store,
    agent,
    freshAgent,
    requestHash,
    now,
    currentAgentVersion,
    settlementResult.error ?? "Payment not confirmed",
  );

  return {
    kind: "skipped",
    reason: settlementResult.error ?? "Settlement returned unpaid",
  };
}

// ---------------------------------------------------------------------------
// Helper: release reservation and mark execution as failed_unpaid
// ---------------------------------------------------------------------------

/**
 * Best-effort atomic release of an UNPAID reservation after a settlement
 * failure. The release RPC independently verifies zero settlement proof
 * and idempotency before touching any state; never fatal.
 */
async function releaseUnpaidReservation(
  store: EvidenceQualityCheckDependencies["store"],
  agentId: string,
  requestHash: string,
  expectedVersion: number,
  now: number,
): Promise<void> {
  try {
    await store.releaseUnpaidToolExecution({
      agentId,
      requestHash,
      expectedAgentVersion: expectedVersion,
      now,
    });
  } catch {
    // Best-effort — recovery can retry later; never fatal.
  }
}

async function releaseReservationAndMarkFailed(
  store: EvidenceQualityCheckDependencies["store"],
  originalAgent: ResolutionAgent,
  runningAgent: ResolutionAgent,
  requestHash: string,
  now: number,
  currentVersion: number,
  reason: string,
): Promise<void> {
  const releasedAgent: ResolutionAgent = {
    ...runningAgent,
    budget: releaseReservation(runningAgent.budget, CANONICAL_PRICE),
    currentRunningToolId: null,
  };
  const activeAgent = transitionAgentStatus(releasedAgent, "active", { now });

  await store.updateAgent(activeAgent, currentVersion).catch(() => { /* best effort */ });

  // Mark execution as failed_unpaid
  await store.updateToolExecution(originalAgent.id, requestHash, {
    state: "failed_unpaid",
    failure_reason: reason,
  });

  await store.appendEvent(
    originalAgent.id,
    "tool_execution_failed",
    reason,
    "running_tool",
    "active",
    { toolId: CANONICAL_TOOL_ID, requestHash },
  );
}
