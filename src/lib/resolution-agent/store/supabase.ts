// ---------------------------------------------------------------------------
// SupabaseResolutionAgentStore — durable implementation backed by Supabase
//
// Uses direct @supabase/supabase-js client calls against the resolution_agents,
// agent_events, tool_executions, and evidence_requests tables.
//
// All state mutations use optimistic concurrency control (version column on
// resolution_agents) and conditional WHERE clauses to prevent races across
// serverless instances.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { ResolutionAgent } from "../types";
import type {
  ResolutionAgentRow,
  AgentEventRow,
  ToolExecutionRow,
  EvidenceRequestRow,
} from "./types";
import { agentToInsertRow, agentToUpdateRow, rowToAgent } from "./serialization";
import {
  ResolutionAgentAlreadyExistsError,
  ResolutionAgentConcurrencyError,
  ResolutionAgentToolExecutionConflictError,
} from "./errors";

// ---------------------------------------------------------------------------
// Table name constants
// ---------------------------------------------------------------------------

const TABLE_AGENTS = "resolution_agents";
const TABLE_EVENTS = "agent_events";
const TABLE_TOOL_EXECUTIONS = "tool_executions";
const TABLE_EVIDENCE_REQUESTS = "evidence_requests";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SupabaseResolutionAgentStore {
  private readonly client: SupabaseClient;

  /**
   * @param client Optional Supabase client for testing. If not provided,
   * uses the shared singleton from getSupabaseClient().
   */
  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  // -------------------------------------------------------------------------
  // CRUD — Create
  // -------------------------------------------------------------------------

  async createAgent(agent: ResolutionAgent): Promise<ResolutionAgent> {
    const insertRow = agentToInsertRow(agent);

    const { error } = await this.client
      .from(TABLE_AGENTS)
      .insert(insertRow);

    if (error) {
      if (error.code === "23505") {
        throw new ResolutionAgentAlreadyExistsError(agent.id);
      }
      throw error;
    }

    return agent;
  }

  // -------------------------------------------------------------------------
  // CRUD — Read by ID
  // -------------------------------------------------------------------------

  async getAgentById(agentId: string): Promise<ResolutionAgent | null> {
    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .select("*")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] getAgentById failed: ${error.message}`,
      );
      return null;
    }

    if (!data) return null;

    return rowToAgent(data as ResolutionAgentRow);
  }

  // -------------------------------------------------------------------------
  // CRUD — Read by case identity
  // -------------------------------------------------------------------------

  async getAgentByCaseIdentity(
    chainId: string,
    contractAddress: string,
    paymentId: string,
  ): Promise<ResolutionAgent | null> {
    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .select("*")
      .eq("escrow_chain_id", chainId)
      .eq("escrow_contract_address", contractAddress.toLowerCase())
      .eq("escrow_payment_id", paymentId)
      .maybeSingle();

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] getAgentByCaseIdentity failed: ${error.message}`,
      );
      return null;
    }

    if (!data) return null;

    return rowToAgent(data as ResolutionAgentRow);
  }

  // -------------------------------------------------------------------------
  // CRUD — Update with optimistic concurrency control
  // -------------------------------------------------------------------------

  async updateAgent(
    agent: ResolutionAgent,
    expectedVersion: number,
  ): Promise<ResolutionAgent> {
    const updateRow = {
      ...agentToUpdateRow(agent),
      version: expectedVersion + 1,
    };

    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .update(updateRow)
      .eq("agent_id", agent.id)
      .eq("version", expectedVersion)
      .select("version");

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] updateAgent failed: ${error.message}`,
      );
      throw error;
    }

    if (!data || data.length === 0) {
      // Concurrency conflict — fetch the actual version for the error message
      const { data: currentRow } = await this.client
        .from(TABLE_AGENTS)
        .select("version")
        .eq("agent_id", agent.id)
        .maybeSingle();

      const actualVersion = (currentRow as { version: number } | null)?.version ?? -1;
      throw new ResolutionAgentConcurrencyError(
        agent.id,
        expectedVersion,
        actualVersion,
      );
    }

    return agent;
  }

  // -------------------------------------------------------------------------
  // Events — append
  // -------------------------------------------------------------------------

  async appendEvent(
    agentId: string,
    eventType: string,
    reason: string,
    previousStatus: string | null,
    nextStatus: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client
      .from(TABLE_EVENTS)
      .insert({
        id: crypto.randomUUID(),
        agent_id: agentId,
        event_type: eventType,
        reason,
        previous_status: previousStatus,
        next_status: nextStatus,
        metadata: metadata ?? null,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] appendEvent failed: ${error.message}`,
      );
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Events — list
  // -------------------------------------------------------------------------

  async listEvents(
    agentId: string,
    limit = 100,
  ): Promise<AgentEventRow[]> {
    const { data, error } = await this.client
      .from(TABLE_EVENTS)
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] listEvents failed: ${error.message}`,
      );
      return [];
    }

    return (data as AgentEventRow[]) ?? [];
  }

  // -------------------------------------------------------------------------
  // Tool Executions — create
  // -------------------------------------------------------------------------

  async createToolExecution(
    agentId: string,
    toolIdentifier: string,
    requestHash: string,
    priceAtomic: bigint,
    network: string,
    asset: string,
    payTo: string,
  ): Promise<void> {
    const { error } = await this.client
      .from(TABLE_TOOL_EXECUTIONS)
      .insert({
        id: crypto.randomUUID(),
        agent_id: agentId,
        tool_identifier: toolIdentifier,
        request_hash: requestHash,
        case_version_hash: null,
        evidence_version_hash: null,
        state: "pending",
        price_atomic: Number(priceAtomic),
        network,
        asset_address: asset.toLowerCase(),
        pay_to_address: payTo.toLowerCase(),
        payment_reference: null,
        settlement_tx_hash: null,
        result_reference: null,
        result_data: null,
        failure_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (error) {
      if (error.code === "23505") {
        throw new ResolutionAgentToolExecutionConflictError(agentId, requestHash);
      }
      console.error(
        `[SupabaseResolutionAgentStore] createToolExecution failed: ${error.message}`,
      );
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Tool Executions — get by request hash
  // -------------------------------------------------------------------------

  async getToolExecutionByRequestHash(
    agentId: string,
    requestHash: string,
  ): Promise<ToolExecutionRow | null> {
    const { data, error } = await this.client
      .from(TABLE_TOOL_EXECUTIONS)
      .select("*")
      .eq("agent_id", agentId)
      .eq("request_hash", requestHash)
      .maybeSingle();

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] getToolExecutionByRequestHash failed: ${error.message}`,
      );
      return null;
    }

    return (data as ToolExecutionRow) ?? null;
  }

  // -------------------------------------------------------------------------
  // Tool Executions — list by agent
  // -------------------------------------------------------------------------

  /**
   * Lists all tool executions for a given agent, ordered by creation date
   * (most recent first). Used by the observation service to build the prior
   * context of settled tool results.
   */
  async listToolExecutions(agentId: string): Promise<ToolExecutionRow[]> {
    const { data, error } = await this.client
      .from(TABLE_TOOL_EXECUTIONS)
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] listToolExecutions failed: ${error.message}`,
      );
      return [];
    }

    return (data as ToolExecutionRow[]) ?? [];
  }

  // -------------------------------------------------------------------------
  // Tool Executions — update
  // -------------------------------------------------------------------------

  async updateToolExecution(
    agentId: string,
    requestHash: string,
    updates: Partial<
      Pick<
        ToolExecutionRow,
        | "state"
        | "payment_reference"
        | "settlement_tx_hash"
        | "result_reference"
        | "result_data"
        | "failure_reason"
        | "case_version_hash"
        | "evidence_version_hash"
      >
    >,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.client
      .from(TABLE_TOOL_EXECUTIONS)
      .update(updateData)
      .eq("agent_id", agentId)
      .eq("request_hash", requestHash);

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] updateToolExecution failed: ${error.message}`,
      );
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Evidence Requests — create
  // -------------------------------------------------------------------------

  async createEvidenceRequest(
    agentId: string,
    responsibleParty: "client" | "worker",
    evidenceItem: string,
    reason: string,
  ): Promise<EvidenceRequestRow> {
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      responsible_party: responsibleParty,
      evidence_item: evidenceItem,
      reason,
      status: "open",
      created_case_version_hash: null,
      fulfilled_case_version_hash: null,
      created_at: new Date().toISOString(),
      fulfilled_at: null,
      cancelled_at: null,
    };

    const { data, error } = await this.client
      .from(TABLE_EVIDENCE_REQUESTS)
      .insert(row)
      .select("*")
      .single();

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] createEvidenceRequest failed: ${error.message}`,
      );
      throw error;
    }

    return data as EvidenceRequestRow;
  }

  // -------------------------------------------------------------------------
  // Evidence Requests — list
  // -------------------------------------------------------------------------

  async listEvidenceRequests(agentId: string): Promise<EvidenceRequestRow[]> {
    const { data, error } = await this.client
      .from(TABLE_EVIDENCE_REQUESTS)
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] listEvidenceRequests failed: ${error.message}`,
      );
      return [];
    }

    return (data as EvidenceRequestRow[]) ?? [];
  }

  // -------------------------------------------------------------------------
  // Evidence Requests — update
  // -------------------------------------------------------------------------

  async updateEvidenceRequest(
    agentId: string,
    requestId: string,
    updates: Partial<
      Pick<
        EvidenceRequestRow,
        | "status"
        | "fulfilled_case_version_hash"
        | "fulfilled_at"
        | "cancelled_at"
      >
    >,
  ): Promise<void> {
    const { error } = await this.client
      .from(TABLE_EVIDENCE_REQUESTS)
      .update(updates as Record<string, unknown>)
      .eq("agent_id", agentId)
      .eq("id", requestId);

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] updateEvidenceRequest failed: ${error.message}`,
      );
      throw error;
    }
  }
}
