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
import { reserveAmount, applySpend, releaseReservation } from "../budget";
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

  // ---- Step 6b: Compute in-memory budget reservation ----------------------
  let updatedBudget;
  try {
    updatedBudget = reserveAmount(agent.budget, CANONICAL_PRICE);
  } catch {
    return {
      kind: "skipped",
      reason: "Insufficient budget to reserve 10000 atomic",
    };
  }

  // ---- Step 6c: Atomically persist reservation + transition ---------------
  // CRITICAL: budget reservation MUST be persisted BEFORE the execution row
  // is created.  If the process crashes after the budget is reserved but
  // before the execution exists, recovery can recompute the deterministic
  // request hash from the agent's currentRunningToolId and case identity.
  //
  // A single updateAgent call atomically:
  //   1. reserves 10000 atomic USDC (reservedAtomic += 10000)
  //   2. sets currentRunningToolId = "evidence-quality-check"
  //   3. transitions active → running_tool
  //   4. validates version (optimistic concurrency)
  //
  // These four writes commit together or not at all via the version gate.
  const reservedAgent: ResolutionAgent = {
    ...agent,
    budget: updatedBudget,
    currentRunningToolId: CANONICAL_TOOL_ID,
  };
  const runningAgent = transitionAgentStatus(reservedAgent, "running_tool", { now });

  let currentAgentVersion = currentVersion;
  let agentAfterTransition: ResolutionAgent;
  try {
    agentAfterTransition = await store.updateAgent(runningAgent, currentAgentVersion);
    currentAgentVersion++;
  } catch {
    return {
      kind: "failed_recoverable",
      reason: "Failed to reserve budget — agent version conflict or status change",
    };
  }

  await store.appendEvent(
    agent.id,
    "tool_execution_started",
    "Reserved budget and entered running_tool",
    "active",
    "running_tool",
    { toolId: CANONICAL_TOOL_ID, requestHash },
  );

  // ---- Step 6d: Create durable execution row ------------------------------
  // The budget is already reserved.  If execution creation fails (unique
  // constraint from a race), release the reservation and revert.
  try {
    await store.createToolExecution(
      agent.id,
      CANONICAL_TOOL_ID,
      requestHash,
      CANONICAL_PRICE,
      CANONICAL_NETWORK,
      CANONICAL_ASSET,
      CANONICAL_PAY_TO,
    );
  } catch {
    await releaseReservationAndRevert(
      store, agent, agentAfterTransition, requestHash, now, currentAgentVersion,
      "Tool execution creation failed (unique constraint race)",
    );
    return {
      kind: "failed_recoverable",
      reason: "Tool execution creation failed (unique constraint race)",
    };
  }

  // Update execution to "reserved" — setup is complete
  await store.updateToolExecution(agent.id, requestHash, {
    state: "reserved",
    case_version_hash: plan.caseVersionHash,
    evidence_version_hash: plan.evidenceVersionHash,
  });

  // ---- Step 6f: Decrypt case wallet ---------------------------------------
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
      store, agent, agentAfterTransition, requestHash, now, currentAgentVersion,
      "Wallet decryption failed",
    );
    return {
      kind: "failed_recoverable",
      reason: "Wallet decryption failed",
    };
  }

  // ---- Step 6g: Verify decrypted address matches persisted address --------
  if (account.address.toLowerCase() !== agent.caseWalletAddress.toLowerCase()) {
    await releaseReservationAndMarkFailed(
      store, agent, agentAfterTransition, requestHash, now, currentAgentVersion,
      "Wallet address mismatch",
    );
    return {
      kind: "failed_safe",
      reason: "Decrypted wallet address does not match persisted caseWalletAddress",
    };
  }

  // ---- Step 6h: Settle through x402 settlement client ---------------------
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
    await store.updateToolExecution(agent.id, requestHash, {
      state: "failed_recoverable",
      failure_reason: "Settlement threw an unexpected error",
    });
    return {
      kind: "failed_recoverable",
      reason: "Settlement threw an unexpected error",
    };
  }

  // ---- Step 6i: Handle settlement result ----------------------------------
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
      ...agentAfterTransition,
      budget: applySpend(agentAfterTransition.budget, CANONICAL_PRICE),
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
    agentAfterTransition,
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
// Helper: release reservation and revert agent to active
// Used when execution creation fails uniquely after budget was reserved.
// ---------------------------------------------------------------------------

async function releaseReservationAndRevert(
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

  await store.appendEvent(
    originalAgent.id,
    "tool_execution_failed",
    reason,
    "running_tool",
    "active",
    { toolId: CANONICAL_TOOL_ID, requestHash },
  );
}

// ---------------------------------------------------------------------------
// Helper: release reservation and mark execution as failed_unpaid
// ---------------------------------------------------------------------------

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
