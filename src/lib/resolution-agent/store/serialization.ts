// ---------------------------------------------------------------------------
// Resolution Agent Store — bi-directional serialization between domain types
// and database rows
// ---------------------------------------------------------------------------

import type { ResolutionAgent, EncryptedWalletSecret } from "../types";
import { agentStatusSchema } from "../types";
import type {
  ResolutionAgentRow,
} from "./types";
import { ResolutionAgentSerializationError } from "./errors";

// ---------------------------------------------------------------------------
// Domain → DB insert row
// ---------------------------------------------------------------------------

export function agentToInsertRow(agent: ResolutionAgent): Record<string, unknown> {
  // Validate encrypted secret fields
  const s = agent.encryptedSecret;
  if (!s || typeof s.ciphertext !== "string" || s.ciphertext.length === 0) {
    throw new ResolutionAgentSerializationError(
      "Invalid encrypted wallet secret: missing or empty ciphertext",
    );
  }
  if (!s || typeof s.iv !== "string" || s.iv.length === 0) {
    throw new ResolutionAgentSerializationError(
      "Invalid encrypted wallet secret: missing or empty iv",
    );
  }
  if (!s || typeof s.authenticationTag !== "string" || s.authenticationTag.length === 0) {
    throw new ResolutionAgentSerializationError(
      "Invalid encrypted wallet secret: missing or empty authentication tag",
    );
  }
  if (agent.policy.approvedBudgetAtomic < 0n) {
    throw new ResolutionAgentSerializationError(
      "Invalid budget: approved budget must be non-negative",
    );
  }

  return {
    id: crypto.randomUUID(),
    agent_id: agent.id,
    escrow_chain_id: agent.identity.escrowChainId,
    escrow_contract_address: agent.identity.escrowContractAddress.toLowerCase(),
    escrow_payment_id: agent.identity.escrowPaymentId,
    goal: agent.goal,
    status: agent.status,
    case_wallet_address: agent.caseWalletAddress.toLowerCase(),
    encrypted_wallet_secret: agent.encryptedSecret as unknown as Record<string, unknown>,
    funder_address: agent.policy.funderAddress.toLowerCase(),
    allowed_tools: agent.policy.allowedTools as string[],
    approved_budget_atomic: Number(agent.policy.approvedBudgetAtomic),
    spent_budget_atomic: Number(agent.budget.spentAtomic),
    reserved_budget_atomic: Number(agent.budget.reservedAtomic),
    current_plan: (agent.plan as unknown as Record<string, unknown>) ?? null,
    observations: (agent.observation as unknown as Record<string, unknown>) ?? null,
    evidence_version_hash: agent.observation?.evidenceVersionHash ?? null,
    case_version_hash: agent.observation?.caseVersionHash ?? null,
    expires_at: new Date(agent.policy.expiresAt).toISOString(),
    created_at: new Date(agent.createdAt).toISOString(),
    updated_at: new Date().toISOString(),
    funded_at: null,
    activated_at: agent.activatedAt ? new Date(agent.activatedAt).toISOString() : null,
    paused_at: agent.pausedAt ? new Date(agent.pausedAt).toISOString() : null,
    closed_at: agent.closedAt ? new Date(agent.closedAt).toISOString() : null,
    version: 1,
    lease_owner: null,
    lease_expires_at: null,
  };
}

// ---------------------------------------------------------------------------
// Domain → DB update row
// ---------------------------------------------------------------------------

export function agentToUpdateRow(agent: ResolutionAgent): Record<string, unknown> {
  return {
    escrow_chain_id: agent.identity.escrowChainId,
    escrow_contract_address: agent.identity.escrowContractAddress.toLowerCase(),
    escrow_payment_id: agent.identity.escrowPaymentId,
    goal: agent.goal,
    status: agent.status,
    case_wallet_address: agent.caseWalletAddress.toLowerCase(),
    encrypted_wallet_secret: agent.encryptedSecret as unknown as Record<string, unknown>,
    funder_address: agent.policy.funderAddress.toLowerCase(),
    allowed_tools: agent.policy.allowedTools as string[],
    approved_budget_atomic: Number(agent.policy.approvedBudgetAtomic),
    spent_budget_atomic: Number(agent.budget.spentAtomic),
    reserved_budget_atomic: Number(agent.budget.reservedAtomic),
    current_plan: (agent.plan as unknown as Record<string, unknown>) ?? null,
    observations: (agent.observation as unknown as Record<string, unknown>) ?? null,
    evidence_version_hash: agent.observation?.evidenceVersionHash ?? null,
    case_version_hash: agent.observation?.caseVersionHash ?? null,
    expires_at: new Date(agent.policy.expiresAt).toISOString(),
    updated_at: new Date().toISOString(),
    funded_at: null,
    activated_at: agent.activatedAt ? new Date(agent.activatedAt).toISOString() : null,
    paused_at: agent.pausedAt ? new Date(agent.pausedAt).toISOString() : null,
    closed_at: agent.closedAt ? new Date(agent.closedAt).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// DB row → Domain
// ---------------------------------------------------------------------------

export function rowToAgent(row: ResolutionAgentRow): ResolutionAgent {
  // Validate status against the known schema before constructing
  const statusResult = agentStatusSchema.safeParse(row.status);
  if (!statusResult.success) {
    throw new ResolutionAgentSerializationError(
      `Invalid agent status in database row`,
    );
  }

  let encryptedSecret: EncryptedWalletSecret;
  try {
    // The encrypted wallet secret is stored as a JSONB object — cast to expected shape
    encryptedSecret = row.encrypted_wallet_secret as unknown as EncryptedWalletSecret;
    // Minimal structural validation (avoid leaking secret contents in errors)
    if (!encryptedSecret || typeof encryptedSecret.ciphertext !== "string" || encryptedSecret.ciphertext.length === 0) {
      throw new ResolutionAgentSerializationError(
        "Invalid encrypted wallet secret structure in database row",
      );
    }
  } catch (err) {
    if (err instanceof ResolutionAgentSerializationError) throw err;
    throw new ResolutionAgentSerializationError(
      "Failed to deserialize encrypted wallet secret",
    );
  }

  try {
    const approvedBudgetAtomic = BigInt(row.approved_budget_atomic);
    const spentBudgetAtomic = BigInt(row.spent_budget_atomic);
    const reservedBudgetAtomic = BigInt(row.reserved_budget_atomic);

    return {
      id: row.agent_id,
      goal: row.goal as ResolutionAgent["goal"],
      status: statusResult.data,
      identity: {
        escrowChainId: row.escrow_chain_id,
        escrowContractAddress: row.escrow_contract_address,
        escrowPaymentId: row.escrow_payment_id,
      },
      policy: {
        allowedTools: row.allowed_tools as ResolutionAgent["policy"]["allowedTools"],
        approvedBudgetAtomic,
        expiresAt: new Date(row.expires_at ?? row.created_at).getTime(),
        funderAddress: row.funder_address,
      },
      budget: {
        approvedAtomic: approvedBudgetAtomic,
        spentAtomic: spentBudgetAtomic,
        reservedAtomic: reservedBudgetAtomic,
      },
      plan: row.current_plan as ResolutionAgent["plan"],
      observation: row.observations as ResolutionAgent["observation"],
      caseWalletAddress: row.case_wallet_address,
      encryptedSecret,
      settledToolIds: [], // Populated from tool_executions table via store methods
      currentRunningToolId: null, // Populated from tool_executions table via store methods
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      activatedAt: row.activated_at ? new Date(row.activated_at).getTime() : null,
      pausedAt: row.paused_at ? new Date(row.paused_at).getTime() : null,
      closedAt: row.closed_at ? new Date(row.closed_at).getTime() : null,
    };
  } catch (err) {
    if (err instanceof ResolutionAgentSerializationError) throw err;
    throw new ResolutionAgentSerializationError(
      "Failed to deserialize agent from database row",
    );
  }
}
