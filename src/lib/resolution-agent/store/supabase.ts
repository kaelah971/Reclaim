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
import type { WorkerCandidate } from "../worker/types";
import { RUNNABLE_AGENT_STATUSES } from "../worker/types";
import { DEFAULT_LEASE_DURATION_MS } from "../worker/types";
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
const TABLE_EVENTS = "resolution_agent_events";
const TABLE_TOOL_EXECUTIONS = "resolution_agent_tool_executions";
const TABLE_EVIDENCE_REQUESTS = "resolution_agent_evidence_requests";

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
    // Agents are persisted with CAIP-2 chain ids ("eip155:11142220").
    // Normalize a numeric input ("11142220") to the same canonical form so
    // lookups always match the persisted binding regardless of caller format.
    const normalizedChainId = chainId.startsWith("eip155:")
      ? chainId
      : `eip155:${chainId}`;

    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .select("*")
      .eq("escrow_chain_id", normalizedChainId)
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
  // Version — read current concurrency-control version
  // -------------------------------------------------------------------------

  async getAgentVersion(agentId: string): Promise<number> {
    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .select("version")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error || !data) return 0;

    return (data as { version: number }).version;
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
    caseVersionHash?: string,
    evidenceVersionHash?: string,
  ): Promise<EvidenceRequestRow> {
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      responsible_party: responsibleParty,
      evidence_item: evidenceItem,
      reason,
      status: "open",
      created_case_version_hash: caseVersionHash ?? null,
      evidence_version_hash: evidenceVersionHash ?? null,
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
        | "fulfillment_evidence_reference"
        | "evidence_preimage"
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

  // -------------------------------------------------------------------------
  // Worker — list runnable agents
  // -------------------------------------------------------------------------

  /**
   * Lists agents eligible for worker processing, ordered by oldest update first.
   */
  async listRunnableAgents(limit = 5): Promise<WorkerCandidate[]> {
    const statuses = [...RUNNABLE_AGENT_STATUSES];
    const { data, error } = await this.client
      .from(TABLE_AGENTS)
      .select("agent_id, status, lease_owner, lease_expires_at, updated_at")
      .in("status", statuses)
      .order("updated_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] listRunnableAgents failed: ${error.message}`,
      );
      return [];
    }

    const rows = data as Array<{
      agent_id: string;
      status: string;
      lease_owner: string | null;
      lease_expires_at: string | null;
      updated_at: string;
    }> | null;

    if (!rows) return [];

    return rows.map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      updatedAt: row.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Worker — atomic lease acquisition
  // -------------------------------------------------------------------------

  /**
   * Attempt to acquire a lease on an agent atomically.
   *
   * Conditions (all must be true at the moment of the database write):
   *   - agent_id matches;
   *   - status is in the canonical runnable set;
   *   - lease_owner matches the observed value (IS NULL for unleased,
   *     or equals the previous owner for an expired lease);
   *   - when acquiring an expired lease, lease_expires_at must still
   *     be <= now so that a concurrent renewal prevents acquisition.
   *
   * The read-then-check before the update is a fast-path guard, not
   * the authoritative decision.  Only the conditional UPDATE predicate
   * decides whether the lease is actually acquired.
   *
   * Returns the LeaseContext on success, null on conflict.
   */
  async tryAcquireAgentLease(
    agentId: string,
    ownerToken: string,
    now: number,
  ): Promise<import("../worker/types").LeaseContext | null> {
    const expiresAt = new Date(now + DEFAULT_LEASE_DURATION_MS).toISOString();
    const nowISO = new Date(now).toISOString();

    // Fast-path read — used only to determine *which* conditional
    // predicate chain to attach.  The atomic UPDATE is the authority.
    const { data: agent, error: fetchErr } = await this.client
      .from(TABLE_AGENTS)
      .select("agent_id, status, lease_owner, lease_expires_at")
      .eq("agent_id", agentId)
      .single();

    if (fetchErr || !agent) return null;

    const currentStatus = (agent as Record<string, unknown>).status as string;
    if (
      !RUNNABLE_AGENT_STATUSES.includes(
        currentStatus as typeof RUNNABLE_AGENT_STATUSES[number],
      )
    ) {
      return null;
    }

    const existingOwner = (agent as Record<string, unknown>).lease_owner as string | null;
    const existingExpiry = (agent as Record<string, unknown>).lease_expires_at as string | null;

    // Fast-path: active unexpired lease → bail out without UPDATE
    if (existingOwner && existingExpiry) {
      const expiryTime = new Date(existingExpiry).getTime();
      if (!isNaN(expiryTime) && expiryTime > now) return null;
    }

    // Build the conditional UPDATE.  The essential predicates are:
    //  (1) agent_id
    //  (2) status IN runnable set
    //  (3) lease_owner matches the observed value (IS NULL for unleased)
    //
    // For an expired lease we ADDITIONALLY require that lease_expires_at
    // has not been extended by a concurrent renewal.
    const runnableStatuses = [...RUNNABLE_AGENT_STATUSES] as string[];

    let updateQuery = this.client
      .from(TABLE_AGENTS)
      .update({
        lease_owner: ownerToken,
        lease_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agentId)
      .in("status", runnableStatuses);

    // PostgreSQL IS NULL vs equality: .is() must only be used for null.
    // Non-null lease owner tokens require .eq() for exact string match.
    if (existingOwner === null) {
      updateQuery = updateQuery.is("lease_owner", null);
    } else {
      updateQuery = updateQuery.eq("lease_owner", existingOwner);
    }

    // If the previous lease existed (even if expired), the database
    // predicate must also require that lease_expires_at has not
    // changed.  A concurrent renewal changes lease_expires_at but
    // NOT lease_owner — without this extra predicate a stale
    // acquisition would steal the renewed lease.
    if (existingOwner !== null) {
      updateQuery = updateQuery.lte("lease_expires_at", nowISO);
    }

    const { data: updated, error } = await updateQuery
      .select("lease_owner, lease_expires_at, status")
      .maybeSingle();

    if (error || !updated) return null;

    // Post-update verification — the returned row MUST match the
    // newly written owner token.  A mismatch indicates a concurrent
    // write that the query builder silently accepted or a bug.
    const result = updated as Record<string, unknown>;
    if (result.lease_owner !== ownerToken) {
      return null;
    }

    // Safety: verify status is still runnable (paranoid check)
    if (
      !RUNNABLE_AGENT_STATUSES.includes(
        (result.status as string) as typeof RUNNABLE_AGENT_STATUSES[number],
      )
    ) {
      return null;
    }

    return {
      agentId,
      ownerToken,
      acquiredAt: now,
      expiresAt: now + DEFAULT_LEASE_DURATION_MS,
    };
  }

  // -------------------------------------------------------------------------
  // Worker — renew lease (only current owner)
  // -------------------------------------------------------------------------

  /**
   * Renew a lease.  Only the current owner may renew, and only when
   * the agent is still in a runnable status.  The database predicate
   * ensures a stale renter whose ownership was concurrently taken
   * cannot extend a lease it no longer holds.
   */
  async renewAgentLease(
    agentId: string,
    ownerToken: string,
    now: number,
  ): Promise<boolean> {
    const expiresAt = new Date(now + DEFAULT_LEASE_DURATION_MS).toISOString();
    const runnableStatuses = [...RUNNABLE_AGENT_STATUSES] as string[];
    const { error } = await this.client
      .from(TABLE_AGENTS)
      .update({
        lease_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agentId)
      .eq("lease_owner", ownerToken)
      .in("status", runnableStatuses);

    return !error;
  }

  // -------------------------------------------------------------------------
  // Worker — release lease (only current owner)
  // -------------------------------------------------------------------------

  async releaseAgentLease(
    agentId: string,
    ownerToken: string,
  ): Promise<boolean> {
    const { error } = await this.client
      .from(TABLE_AGENTS)
      .update({
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agentId)
      .eq("lease_owner", ownerToken);

    if (error) {
      console.error(
        `[SupabaseResolutionAgentStore] releaseAgentLease failed: ${error.message}`,
      );
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Atomic tool-execution reservation (RPC)
  // -------------------------------------------------------------------------

  /**
   * Atomically reserve budget, create a tool execution row, and transition
   * the agent to running_tool in a single PostgreSQL transaction.
   *
   * Called by adapters instead of the multi-step updateAgent +
   * createToolExecution + updateToolExecution dance.  Crash-consistent
   * by design: the budget reservation, execution creation, and status
   * transition all commit together or not at all.
   */
  async reserveToolExecutionAtomically(params: {
    agentId: string;
    expectedAgentVersion: number;
    requestHash: string;
    toolId: string;
    caseVersionHash: string;
    evidenceVersionHash: string;
    priceAtomic: bigint;
    network: string;
    asset: string;
    payTo: string;
    serviceIdentifier: string;
    policyVersion: string;
    now: number;
  }): Promise<
    | { kind: "created"; agentId: string; requestHash: string; state: string }
    | { kind: "existing"; agentId: string; requestHash: string; state: string }
  > {
    const { data, error } = await this.client.rpc(
      "reserve_resolution_agent_tool_execution",
      {
        p_agent_id: params.agentId,
        p_expected_version: params.expectedAgentVersion,
        p_request_hash: params.requestHash,
        p_tool_id: params.toolId,
        p_case_version_hash: params.caseVersionHash,
        p_evidence_version_hash: params.evidenceVersionHash,
        p_price_atomic: Number(params.priceAtomic),
        p_network: params.network,
        p_asset: params.asset,
        p_pay_to: params.payTo,
        p_service_identifier: params.serviceIdentifier,
        p_policy_version: params.policyVersion,
        p_now: new Date(params.now).toISOString(),
      },
    );

    if (error) {
      const msg = error.message || "";
      if (msg.includes("not found")) throw new Error("Agent not found");
      if (msg.includes("Version conflict")) throw new Error("Version conflict");
      if (msg.includes("status") || msg.includes("cannot start")) throw new Error("Invalid lifecycle state");
      if (msg.includes("budget") || msg.includes("Insufficient")) throw new Error("Insufficient budget");
      throw error;
    }

    const result = data as { kind: string; agent_id: string; request_hash: string; state: string };
    return {
      kind: result.kind as "created" | "existing",
      agentId: result.agent_id,
      requestHash: result.request_hash,
      state: result.state,
    };
  }

  // -------------------------------------------------------------------------
  // Worker — get latest tool execution
  // -------------------------------------------------------------------------

  async getLatestToolExecution(
    agentId: string,
  ): Promise<ToolExecutionRow | null> {
    const { data, error } = await this.client
      .from(TABLE_TOOL_EXECUTIONS)
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return (data as ToolExecutionRow) ?? null;
  }
}
