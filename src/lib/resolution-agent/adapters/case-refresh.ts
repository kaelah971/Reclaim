// ---------------------------------------------------------------------------
// Case Refresh Adapter
//
// Implements the canonical tool execution flow for the case-refresh tool.
// Follows the same pattern as executeEvidenceQualityCheck:
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
  CaseRefreshDependencies,
  X402SettlementResult,
} from "./types";
import { buildCaseRefreshInput } from "./case-refresh-input";
import { normalizeCaseRefreshResult } from "./case-refresh-result";
import {
  computeCaseRefreshHashFromInput,
} from "../../x402/caseRefreshRequestHash";
import { applySpend, releaseReservation } from "../budget";
import { transitionAgentStatus } from "../state-machine";
import {
  CASE_REFRESH_PRICE_ATOMIC,
} from "../tools";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
  type AgentCaseIdentity,
} from "../types";
import type { CaseRefreshInput } from "../../x402/caseRefreshValidation";

// ---------------------------------------------------------------------------
// Canonical tool configuration constants
// ---------------------------------------------------------------------------

const CANONICAL_TOOL_ID = "case-refresh" as const;
const CANONICAL_PRICE = CASE_REFRESH_PRICE_ATOMIC; // 10000n
const CANONICAL_NETWORK = AGENT_FACILITATOR_NETWORK; // "eip155:42220"
const CANONICAL_ASSET = AGENT_MAINNET_USDC_ADDRESS;
const CANONICAL_PAY_TO = AGENT_PAY_TO_ADDRESS;

// ---------------------------------------------------------------------------
// Main adapter entry point
// ---------------------------------------------------------------------------

export async function executeCaseRefresh(params: {
  agent: ResolutionAgent;
  plan: ResolutionAgentPlan;
  action: ResolutionAgentNextAction;
  leaseContext: LeaseContext;
  now: number;
  dependencies: CaseRefreshDependencies;
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
  const caseRefreshInput = buildServiceInput(
    agent.identity,
    observation,
    agent.caseWalletAddress,
  );
  const requestHash = computeRequestHash(
    caseRefreshInput,
    agent.caseWalletAddress,
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
    caseRefreshInput,
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

  return null;
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
  _caseWalletAddress: string,
): CaseRefreshInput {
  const base = buildCaseRefreshInput(caseIdentity, observation);
  return {
    escrowChainId: base.escrowChainId,
    escrowContractAddress: base.escrowContractAddress,
    escrowPaymentId: base.escrowPaymentId,
    agreementLabel: base.agreementLabel,
    deliverableSummary: base.deliverableSummary,
    deliveryFormat: base.deliveryFormat,
    releaseRule: base.releaseRule,
    evidenceExpectation: base.evidenceExpectation,
    escrowState: base.escrowState,
    caseVersionHash: base.caseVersionHash,
    evidenceVersionHash: base.evidenceVersionHash,
    evidenceAvailability: base.evidenceAvailability,
    evidenceReference: base.evidenceReference ?? null,
    evidenceCount: base.evidenceCount,
    openEvidenceRequests: base.openEvidenceRequests,
    fulfilledEvidenceRequests: base.fulfilledEvidenceRequests,
    // These are populated by planner context elsewhere; default to null
    previousQualityCheck: null,
    previousCaseRefresh: null,
  };
}

// ---------------------------------------------------------------------------
// Compute canonical request hash
// ---------------------------------------------------------------------------

function computeRequestHash(
  input: CaseRefreshInput,
  payer: string,
): string {
  return computeCaseRefreshHashFromInput(
    input,
    payer,
    CANONICAL_NETWORK,
    CANONICAL_ASSET,
    CANONICAL_PAY_TO,
    String(CANONICAL_PRICE),
  );
}

// ---------------------------------------------------------------------------
// Handle existing execution (dedup / recovery / waiting)
// ---------------------------------------------------------------------------

function handleExistingExecution(params: {
  existing: ToolExecutionRow;
}): ActionExecutionResult {
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
  dependencies: CaseRefreshDependencies;
  caseRefreshInput: CaseRefreshInput;
  requestHash: string;
}): Promise<ActionExecutionResult> {
  const {
    agent,
    plan,
    now,
    dependencies,
    caseRefreshInput,
    requestHash,
  } = params;
  const { store, settlementClient, generator, walletDecryptor, paymentStore } =
    dependencies;

  // ---- Step 6a: Version check (concurrency guard) -------------------------
  const currentVersion = await store.getAgentVersion(agent.id);

  // ---- Step 6b: Atomic RPC — reserve budget + create execution + transition
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

  if (freshAgent.status !== "running_tool") {
    return { kind: "failed_recoverable", reason: "Agent status not running_tool after reservation" };
  }
  if (freshAgent.currentRunningToolId !== CANONICAL_TOOL_ID) {
    return { kind: "failed_recoverable", reason: "currentRunningToolId not set after reservation" };
  }

  let currentAgentVersion = currentVersion + 1;

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
    settlementResult = await settlementClient.settleCaseRefresh({
      payerAccount: account,
      requestHash,
      serviceInput: caseRefreshInput,
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

  // ---- Step 6h: Handle settlement result ----------------------------------
  if (settlementResult.success) {
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
        // Non-fatal
      }
    }

    const spentAgent: ResolutionAgent = {
      ...freshAgent,
      budget: applySpend(freshAgent.budget, CANONICAL_PRICE),
    };

    await store.updateToolExecution(agent.id, requestHash, {
      state: "paid_pending_result",
      settlement_tx_hash: txHash ?? undefined,
      payment_reference: settlementResult.receipt?.paymentIdentifier ?? null,
    });

    let agentAfterSpend: ResolutionAgent;
    try {
      agentAfterSpend = await store.updateAgent(spentAgent, currentAgentVersion);
      currentAgentVersion++;
    } catch {
      return {
        kind: "failed_recoverable",
        reason: "Payment succeeded but budget update failed",
      };
    }

    // ---- Generate result --------------------------------------------------
    let generationResult;
    try {
      generationResult = await generator.generate({
        serviceInput: caseRefreshInput,
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
    const outcome = normalizeCaseRefreshResult(
      generationResult.result,
      "settled",
    );

    await store.updateToolExecution(agent.id, requestHash, {
      state: "settled",
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
      "Case refresh completed and settled",
      "running_tool",
      "active",
      {
        toolId: CANONICAL_TOOL_ID,
        requestHash,
      },
    );

    return { kind: "executed" };
  }

  if (settlementResult.ambiguous) {
    await store.updateToolExecution(agent.id, requestHash, {
      state: "failed_recoverable",
      failure_reason: settlementResult.error ?? "Settlement outcome ambiguous",
    });

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

async function releaseReservationAndMarkFailed(
  store: CaseRefreshDependencies["store"],
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
