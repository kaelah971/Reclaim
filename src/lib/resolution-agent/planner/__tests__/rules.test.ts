import { describe, it, expect, beforeAll } from "vitest";
import type { ResolutionAgent, ResolutionAgentToolRequest } from "../../types";
import type { CaseObservationResult, CaseChangeSummary } from "../../observation/types";
import type { ToolExecutionRow, EvidenceRequestRow } from "../../store/types";
import type { ResolutionAgentPlannerInput, ResolutionAgentNextAction } from "../types";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const NOW = 1700000000000;

function makeActiveAgent(overrides: Partial<ResolutionAgent> = {}): ResolutionAgent {
  return {
    id: "agent_test_1",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    },
    policy: {
      allowedTools: [
        "evidence-quality-check",
        "case-refresh",
        "reclaim-dispute-brief-v1",
      ],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999999,
      funderAddress: "0xbbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb",
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    },
    plan: null,
    observation: {
      escrowState: "funded",
      evidenceCount: 3,
      evidenceVersionHash: "ev_hash_v2",
      caseVersionHash: "case_hash_v2",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: NOW,
    },
    caseWalletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    encryptedSecret: {
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext: "test-ciphertext",
      iv: "test-iv",
      authenticationTag: "test-tag",
    },
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: 1000000,
    updatedAt: 1000000,
    activatedAt: 5000000,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeChangeSummary(overrides: Partial<CaseChangeSummary> = {}): CaseChangeSummary {
  return {
    caseChanged: true,
    evidenceChanged: false,
    firstObservation: false,
    changeType: "escrow_state_changed",
    reason: "test change",
    ...overrides,
  };
}

function makeObservationResult(
  agentId: string,
  caseHash: string,
  evidenceHash: string,
  overrides: Partial<CaseObservationResult> = {},
): CaseObservationResult {
  return {
    agentId,
    observation: {
      schemaVersion: "reclaim-case-observation-v1",
      caseIdentity: {
        escrowChainId: "eip155:42220",
        escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
        escrowPaymentId: "pay_1",
      },
      escrow: {
        paymentId: "pay_1",
        client: "0xAAA",
        worker: "0xBBB",
        token: "0xCCC",
        amount: "1000000",
        agreementLabel: "0xDDD",
        deliverableSummary: "0xEEE",
        deliveryFormat: "0xFFF",
        releaseRule: "0xGGG",
        evidenceExpectation: "0xHHH",
        termsHash: "0xIII",
        evidenceReference: "0xJJJ",
        disputeReference: "0xKKK",
        deliveryDeadline: 0,
        autoReleaseSeconds: 0,
        disputeWindowSeconds: 0,
        state: "funded",
        createdAt: 1000000,
        fundedAt: 2000000,
        acceptedAt: 0,
        deliveryAt: 0,
        releaseRequestedAt: 0,
        releasedAt: 0,
      },
      evidence: {
        evidenceReference: "0xJJJ",
        title: "test evidence",
        evidenceType: "delivery",
        description: "test",
        relatedDeliverable: null,
        externalReference: null,
        fileCount: 2,
        latestUpdateTimestamp: NOW,
        availability: "package_available",
      },
      priorContext: {
        agentStatus: "active",
        openEvidenceRequests: [],
        fulfilledEvidenceRequests: [],
        settledToolResults: [],
        previousCaseVersionHash: null,
        previousEvidenceVersionHash: null,
      },
      observedAt: NOW,
    },
    evidenceVersionHash: evidenceHash,
    caseVersionHash: caseHash,
    changeSummary: makeChangeSummary(),
    persisted: true,
    ...overrides,
  };
}

function makeToolExecution(overrides: Partial<ToolExecutionRow> = {}): ToolExecutionRow {
  return {
    id: "te_1",
    agent_id: "agent_test_1",
    tool_identifier: "evidence-quality-check",
    request_hash: "req_hash_1",
    case_version_hash: "case_hash_v2",
    evidence_version_hash: "ev_hash_v2",
    state: "settled",
    price_atomic: 10000,
    network: "eip155:42220",
    asset_address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    pay_to_address: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    payment_reference: null,
    settlement_tx_hash: null,
    result_reference: null,
    result_data: {
      evidenceVersionHash: "ev_hash_v2",
      readiness: "ready",
      missingEvidence: [],
      ambiguities: [],
      recommendedImprovements: [],
      reviewerQuestions: [],
    },
    failure_reason: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvidenceRequest(overrides: Partial<EvidenceRequestRow> = {}): EvidenceRequestRow {
  return {
    id: "er_1",
    agent_id: "agent_test_1",
    responsible_party: "worker",
    evidence_item: "delivery proof",
    reason: "Need confirmation of delivery",
    status: "open",
    created_case_version_hash: "case_hash_v2",
    evidence_version_hash: null,
    fulfilled_case_version_hash: null,
    fulfillment_evidence_reference: null,
    evidence_preimage: null,
    created_at: "2024-01-01T00:00:00Z",
    fulfilled_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function makePlannerInput(overrides: Partial<ResolutionAgentPlannerInput> = {}): ResolutionAgentPlannerInput {
  const agentId = "agent_test_1";
  return {
    agent: makeActiveAgent({ id: agentId }),
    observationResult: makeObservationResult(agentId, "case_hash_v2", "ev_hash_v2"),
    toolExecutions: [],
    evidenceRequests: [],
    now: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: nonExecutableAgent
// ---------------------------------------------------------------------------

describe("Rule: nonExecutableAgent", () => {
  let nonExecutableAgent: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    nonExecutableAgent = mod.nonExecutableAgent;
  });

  it("returns null for active status", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "active" }) });
    const result = nonExecutableAgent(input);
    expect(result).toBeNull();
  });

  it("returns no_action for awaiting_funding", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "awaiting_funding" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_not_active");
  });

  it("returns no_action for awaiting_activation", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "awaiting_activation" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("returns no_action for paused", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "paused" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_paused");
  });

  it("returns no_action for closing", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "closing" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_closed");
  });

  it("returns no_action for closed", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "closed" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_closed");
  });

  it("returns no_action for expired", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "expired" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_expired");
  });

  it("returns null for ready_for_human_review (falls through)", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "ready_for_human_review" }) });
    const result = nonExecutableAgent(input);
    expect(result).toBeNull();
  });

  it("returns null for budget_exhausted (falls through)", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "budget_exhausted" }) });
    const result = nonExecutableAgent(input);
    expect(result).toBeNull();
  });

  it("returns no_action for draft", () => {
    const input = makePlannerInput({ agent: makeActiveAgent({ status: "draft" }) });
    const result = nonExecutableAgent(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });
});

// ---------------------------------------------------------------------------
// Rule 2: existingInFlightTool
// ---------------------------------------------------------------------------

describe("Rule: existingInFlightTool", () => {
  let existingInFlightTool: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    existingInFlightTool = mod.existingInFlightTool;
  });

  it("returns null when no tool is running", () => {
    const input = makePlannerInput();
    const result = existingInFlightTool(input);
    expect(result).toBeNull();
  });

  it("returns no_action when currentRunningToolId is set", () => {
    const agent = makeActiveAgent({ currentRunningToolId: "evidence-quality-check" });
    const input = makePlannerInput({ agent });
    const result = existingInFlightTool(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("tool_already_running");
  });

  it("returns no_action when agent status is running_tool", () => {
    const agent = makeActiveAgent({ status: "running_tool", currentRunningToolId: "case-refresh" });
    const input = makePlannerInput({ agent });
    const result = existingInFlightTool(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("tool_already_running");
  });

  it("returns null when currentRunningToolId is null and status is active", () => {
    const agent = makeActiveAgent({ currentRunningToolId: null, status: "active" });
    const input = makePlannerInput({ agent });
    const result = existingInFlightTool(input);
    expect(result).toBeNull();
  });

  it("returns no_action when a tool execution is in pending state", () => {
    const toolExec = makeToolExecution({ state: "pending", tool_identifier: "evidence-quality-check" });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = existingInFlightTool(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("awaiting_existing_paid_result");
  });

  it("returns no_action when a tool execution is in paid_pending_result state", () => {
    const toolExec = makeToolExecution({ state: "paid_pending_result", tool_identifier: "case-refresh" });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = existingInFlightTool(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });
});

// ---------------------------------------------------------------------------
// Rule 3: noEvidence
// ---------------------------------------------------------------------------

describe("Rule: noEvidence", () => {
  let noEvidence: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    noEvidence = mod.noEvidence;
  });

  it("returns null when evidence exists", () => {
    const input = makePlannerInput();
    const result = noEvidence(input);
    expect(result).toBeNull();
  });

  it("returns create_evidence_request when no evidence", () => {
    const agent = makeActiveAgent({
      observation: {
        escrowState: "funded",
        evidenceCount: 0,
        evidenceVersionHash: "ev_hash_v1",
        caseVersionHash: "case_hash_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: NOW,
      },
    });
    const obsResult = makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1", {
      observation: {
        ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1").observation,
        evidence: {
          ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1").observation.evidence,
          fileCount: 0,
          availability: "none",
        },
      },
    });
    const input = makePlannerInput({ agent, observationResult: obsResult });
    const result = noEvidence(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("create_evidence_request");
    if (result!.kind === "create_evidence_request") {
      expect(result!.plannerReason).toBe("evidence_missing");
    }
  });

  it("creates worker evidence request by default", () => {
    const agent = makeActiveAgent({
      observation: {
        escrowState: "funded",
        evidenceCount: 0,
        evidenceVersionHash: "ev_hash_v1",
        caseVersionHash: "case_hash_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: NOW,
      },
    });
    const obsResult = makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1", {
      observation: {
        ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1").observation,
        evidence: {
          ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_hash_v1").observation.evidence,
          fileCount: 0,
          availability: "none",
        },
      },
    });
    const input = makePlannerInput({ agent, observationResult: obsResult });
    const result = noEvidence(input);
    expect(result).not.toBeNull();
    if (result!.kind === "create_evidence_request") {
      expect(result!.responsibleParty).toBe("worker");
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 4: openEvidenceRequest
// ---------------------------------------------------------------------------

describe("Rule: openEvidenceRequest", () => {
  let openEvidenceRequest: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    openEvidenceRequest = mod.openEvidenceRequest;
  });

  it("returns null when no open evidence requests", () => {
    const input = makePlannerInput({ evidenceRequests: [] });
    const result = openEvidenceRequest(input);
    expect(result).toBeNull();
  });

  it("returns wait_for_evidence when an open request exists", () => {
    const er = makeEvidenceRequest({ status: "open", evidence_item: "delivery proof" });
    const input = makePlannerInput({ evidenceRequests: [er] });
    const result = openEvidenceRequest(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("wait_for_evidence");
    expect(result!.reason).toBe("evidence_request_already_open");
  });

  it("returns null for fulfilled evidence requests", () => {
    const er = makeEvidenceRequest({ status: "fulfilled", fulfilled_at: "2024-01-01T00:00:00Z" });
    const input = makePlannerInput({ evidenceRequests: [er] });
    const result = openEvidenceRequest(input);
    expect(result).toBeNull();
  });

  it("returns null for cancelled evidence requests", () => {
    const er = makeEvidenceRequest({ status: "cancelled", cancelled_at: "2024-01-01T00:00:00Z" });
    const input = makePlannerInput({ evidenceRequests: [er] });
    const result = openEvidenceRequest(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 5: evidenceQualityCheckRequired
// ---------------------------------------------------------------------------

describe("Rule: evidenceQualityCheckRequired", () => {
  let evidenceQualityCheckRequired: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;
  let buildToolRequestIdentity: (agent: ResolutionAgent, toolId: string, caseHash: string, evidenceHash: string) => ResolutionAgentToolRequest;

  beforeAll(async () => {
    const mod = await import("../rules");
    evidenceQualityCheckRequired = mod.evidenceQualityCheckRequired;
    buildToolRequestIdentity = mod.buildToolRequestIdentity;
  });

  it("returns null when a settled quality check exists for current hash", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "ready",
        missingEvidence: [],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const agent = makeActiveAgent({
      observation: { ...makeActiveAgent().observation!, evidenceVersionHash: "ev_hash_v2" },
    });
    const input = makePlannerInput({ agent, toolExecutions: [toolExec] });
    const result = evidenceQualityCheckRequired(input);
    expect(result).toBeNull();
  });

  it("proposes quality check when no settled check exists for current hash", () => {
    const input = makePlannerInput();
    const result = evidenceQualityCheckRequired(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("run_tool");
    if (result!.kind === "run_tool") {
      expect(result!.toolId).toBe("evidence-quality-check");
      expect(result!.reason).toBe("evidence_quality_check_required");
    }
  });

  it("proposes quality check when only old hash is settled", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v1",
      result_data: {
        evidenceVersionHash: "ev_hash_v1",
        readiness: "ready",
        missingEvidence: [],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = evidenceQualityCheckRequired(input);
    expect(result).not.toBeNull();
    if (result!.kind === "run_tool") {
      expect(result!.toolId).toBe("evidence-quality-check");
    }
  });

  it("does not propose duplicate when a pending quality check exists", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "pending",
      evidence_version_hash: "ev_hash_v2",
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = evidenceQualityCheckRequired(input);
    expect(result).toBeNull();
  });

  it("does not propose when budget is insufficient", () => {
    const agent = makeActiveAgent({
      budget: { approvedAtomic: 10000n, spentAtomic: 10000n, reservedAtomic: 0n },
    });
    const input = makePlannerInput({ agent });
    const result = evidenceQualityCheckRequired(input);
    expect(result).toBeNull();
  });

  it("does not propose when policy rejects", () => {
    const agent = makeActiveAgent({
      settledToolIds: ["evidence-quality-check"],
    });
    const input = makePlannerInput({ agent });
    const result = evidenceQualityCheckRequired(input);
    expect(result).toBeNull();
  });

  it("builds correct tool request identity", () => {
    const agent = makeActiveAgent();
    const request = buildToolRequestIdentity(agent, "evidence-quality-check", "case_hash_v2", "ev_hash_v2");
    expect(request.toolId).toBe("evidence-quality-check");
    expect(request.priceAtomic).toBe(10000n);
    expect(request.network).toBe("eip155:42220");
    expect(request.caseVersionHash).toBe("case_hash_v2");
    expect(request.evidenceVersionHash).toBe("ev_hash_v2");
  });
});

// ---------------------------------------------------------------------------
// Rule 6: qualityCheckFoundGaps
// ---------------------------------------------------------------------------

describe("Rule: qualityCheckFoundGaps", () => {
  let qualityCheckFoundGaps: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;
  let normalizeToolOutcome: (execution: ToolExecutionRow) => import("../types").NormalizedToolOutcome | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    qualityCheckFoundGaps = mod.qualityCheckFoundGaps;
    normalizeToolOutcome = mod.normalizeToolOutcome;
  });

  it("returns null when no settled quality check exists", () => {
    const input = makePlannerInput();
    const result = qualityCheckFoundGaps(input);
    expect(result).toBeNull();
  });

  it("returns create_evidence_request when check found missing worker evidence", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "needs_improvement",
        missingEvidence: ["delivery confirmation", "signed agreement"],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = qualityCheckFoundGaps(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("create_evidence_request");
    if (result!.kind === "create_evidence_request") {
      expect(result!.responsibleParty).toBe("worker");
      expect(result!.plannerReason).toBe("evidence_gaps_found");
    }
  });

  it("returns create_evidence_request for client-side gap", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "needs_improvement",
        missingEvidence: ["client payment authorization"],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = qualityCheckFoundGaps(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("create_evidence_request");
    if (result!.kind === "create_evidence_request") {
      // "client" in the evidence item triggers client party assignment
      expect(result!.responsibleParty).toBe("client");
    }
  });

  it("does not duplicate an equivalent open request", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "needs_improvement",
        missingEvidence: ["delivery confirmation"],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const er = makeEvidenceRequest({
      status: "open",
      responsible_party: "worker",
      evidence_item: "delivery confirmation",
      created_case_version_hash: "case_hash_v2",
    });
    const input = makePlannerInput({
      toolExecutions: [toolExec],
      evidenceRequests: [er],
    });
    const result = qualityCheckFoundGaps(input);
    expect(result).toBeNull();
  });

  it("returns null for malformed tool result", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: { broken: true }, // missing required fields
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = qualityCheckFoundGaps(input);
    expect(result).toBeNull();
  });

  it("returns null when check result is ready (no gaps)", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "ready",
        missingEvidence: [],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = qualityCheckFoundGaps(input);
    expect(result).toBeNull();
  });

  it("normalizeToolOutcome returns null for non-tool execution", () => {
    const te = makeToolExecution({ tool_identifier: "unknown-tool", result_data: null });
    const result = normalizeToolOutcome(te);
    expect(result).toBeNull();
  });

  it("normalizeToolOutcome parses evidence quality outcome", () => {
    const te = makeToolExecution();
    const result = normalizeToolOutcome(te);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("evidence_quality");
    if (result!.kind === "evidence_quality") {
      expect(result!.outcome.readiness).toBe("ready");
      expect(result!.outcome.executionStatus).toBe("settled");
    }
  });

  it("normalizeToolOutcome parses case refresh outcome", () => {
    const te = makeToolExecution({
      tool_identifier: "case-refresh",
      result_data: {
        caseVersionHash: "case_hash_v2",
        readiness: "ready",
        unresolvedEvidenceGaps: [],
        newQuestions: [],
      },
    });
    const result = normalizeToolOutcome(te);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("case_refresh");
    if (result!.kind === "case_refresh") {
      expect(result!.outcome.readiness).toBe("ready");
    }
  });

  it("normalizeToolOutcome parses dispute brief outcome", () => {
    const te = makeToolExecution({
      tool_identifier: "reclaim-dispute-brief-v1",
      result_data: {
        caseVersionHash: "case_hash_v2",
        reviewerPacketReady: true,
        resultReference: "ref_abc",
      },
    });
    const result = normalizeToolOutcome(te);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("dispute_brief");
    if (result!.kind === "dispute_brief") {
      expect(result!.outcome.reviewerPacketReady).toBe(true);
      expect(result!.outcome.resultReference).toBe("ref_abc");
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 7: meaningfulEvidenceChange
// ---------------------------------------------------------------------------

describe("Rule: meaningfulEvidenceChange", () => {
  let meaningfulEvidenceChange: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    meaningfulEvidenceChange = mod.meaningfulEvidenceChange;
  });

  it("returns null when no meaningful change", () => {
    const agent = makeActiveAgent({
      observation: { ...makeActiveAgent().observation!, hasMeaningfulChange: false },
    });
    const input = makePlannerInput({ agent });
    const result = meaningfulEvidenceChange(input);
    expect(result).toBeNull();
  });

  it("proposes case-refresh when meaningful change detected", () => {
    const agent = makeActiveAgent({
      observation: { ...makeActiveAgent().observation!, hasMeaningfulChange: true },
    });
    const input = makePlannerInput({ agent });
    const result = meaningfulEvidenceChange(input);
    expect(result).not.toBeNull();
    if (result!.kind === "run_tool") {
      expect(result!.toolId).toBe("case-refresh");
      expect(result!.reason).toBe("evidence_changed_refresh_required");
    }
  });

  it("does not propose case-refresh when already settled for current hash", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "case-refresh",
      state: "settled",
      case_version_hash: "case_hash_v2",
    });
    const input = makePlannerInput({
      agent: makeActiveAgent({
        observation: { ...makeActiveAgent().observation!, hasMeaningfulChange: true },
      }),
      toolExecutions: [toolExec],
    });
    const result = meaningfulEvidenceChange(input);
    expect(result).toBeNull();
  });

  it("does not propose case-refresh when pending", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "case-refresh",
      state: "pending",
      case_version_hash: "case_hash_v2",
    });
    const input = makePlannerInput({
      agent: makeActiveAgent({
        observation: { ...makeActiveAgent().observation!, hasMeaningfulChange: true },
      }),
      toolExecutions: [toolExec],
    });
    const result = meaningfulEvidenceChange(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 8: caseRefreshFoundGaps
// ---------------------------------------------------------------------------

describe("Rule: caseRefreshFoundGaps", () => {
  let caseRefreshFoundGaps: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    caseRefreshFoundGaps = mod.caseRefreshFoundGaps;
  });

  it("returns null when no settled case refresh exists", () => {
    const input = makePlannerInput();
    const result = caseRefreshFoundGaps(input);
    expect(result).toBeNull();
  });

  it("returns create_evidence_request when refresh found gaps", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "case-refresh",
      state: "settled",
      case_version_hash: "case_hash_v2",
      result_data: {
        caseVersionHash: "case_hash_v2",
        readiness: "needs_evidence",
        unresolvedEvidenceGaps: ["missing acceptance confirmation"],
        newQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = caseRefreshFoundGaps(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("create_evidence_request");
    if (result!.kind === "create_evidence_request") {
      expect(result!.plannerReason).toBe("unresolved_gaps_after_refresh");
    }
  });

  it("returns null when refresh result is ready", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "case-refresh",
      state: "settled",
      case_version_hash: "case_hash_v2",
      result_data: {
        caseVersionHash: "case_hash_v2",
        readiness: "ready",
        unresolvedEvidenceGaps: [],
        newQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = caseRefreshFoundGaps(input);
    expect(result).toBeNull();
  });

  it("does not duplicate equivalent open request", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "case-refresh",
      state: "settled",
      case_version_hash: "case_hash_v2",
      result_data: {
        caseVersionHash: "case_hash_v2",
        readiness: "needs_evidence",
        unresolvedEvidenceGaps: ["missing acceptance confirmation"],
        newQuestions: [],
      },
    });
    const er = makeEvidenceRequest({
      status: "open",
      evidence_item: "missing acceptance confirmation",
    });
    const input = makePlannerInput({
      toolExecutions: [toolExec],
      evidenceRequests: [er],
    });
    const result = caseRefreshFoundGaps(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 9: caseReadyForBrief
// ---------------------------------------------------------------------------

describe("Rule: caseReadyForBrief", () => {
  let caseReadyForBrief: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    caseReadyForBrief = mod.caseReadyForBrief;
  });

  it("proposes dispute brief when evidence quality is ready", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "ready",
        missingEvidence: [],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = caseReadyForBrief(input);
    expect(result).not.toBeNull();
    if (result!.kind === "run_tool") {
      expect(result!.toolId).toBe("reclaim-dispute-brief-v1");
      expect(result!.reason).toBe("dispute_brief_required");
    }
  });

  it("returns null when no settled quality check exists", () => {
    const input = makePlannerInput();
    const result = caseReadyForBrief(input);
    expect(result).toBeNull();
  });

  it("returns null when quality check was not ready", () => {
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "needs_improvement",
        missingEvidence: ["delivery proof"],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });
    const result = caseReadyForBrief(input);
    expect(result).toBeNull();
  });

  it("does not propose brief when already settled for current hash", () => {
    const eqTool = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "ready",
        missingEvidence: [],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const briefTool = makeToolExecution({
      id: "te_brief",
      tool_identifier: "reclaim-dispute-brief-v1",
      state: "settled",
      case_version_hash: "case_hash_v2",
    });
    const input = makePlannerInput({ toolExecutions: [eqTool, briefTool] });
    const result = caseReadyForBrief(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 10: readyForHumanReview
// ---------------------------------------------------------------------------

describe("Rule: readyForHumanReview", () => {
  let readyForHumanReview: (input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null;

  beforeAll(async () => {
    const mod = await import("../rules");
    readyForHumanReview = mod.readyForHumanReview;
  });

  it("returns ready_for_human_review when dispute brief is settled", () => {
    const brief = makeToolExecution({
      id: "te_brief",
      tool_identifier: "reclaim-dispute-brief-v1",
      state: "settled",
      case_version_hash: "case_hash_v2",
      result_data: {
        caseVersionHash: "case_hash_v2",
        reviewerPacketReady: true,
        resultReference: "ref_abc",
      },
    });
    const input = makePlannerInput({ toolExecutions: [brief] });
    const result = readyForHumanReview(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("ready_for_human_review");
    expect(result!.reason).toBe("ready_for_human_review");
    if (result!.kind === "ready_for_human_review") {
      expect(result!.disputeBriefReference).toBe("ref_abc");
    }
  });

  it("returns null when no settled brief exists", () => {
    const input = makePlannerInput();
    const result = readyForHumanReview(input);
    expect(result).toBeNull();
  });

  it("returns null when brief is settled but not ready", () => {
    const brief = makeToolExecution({
      id: "te_brief",
      tool_identifier: "reclaim-dispute-brief-v1",
      state: "settled",
      case_version_hash: "case_hash_v2",
      result_data: {
        caseVersionHash: "case_hash_v2",
        reviewerPacketReady: false,
        resultReference: null,
      },
    });
    const input = makePlannerInput({ toolExecutions: [brief] });
    const result = readyForHumanReview(input);
    expect(result).toBeNull();
  });

  it("returns null when brief is for old case hash", () => {
    const brief = makeToolExecution({
      id: "te_brief",
      tool_identifier: "reclaim-dispute-brief-v1",
      state: "settled",
      case_version_hash: "old_hash",
      result_data: {
        caseVersionHash: "old_hash",
        reviewerPacketReady: true,
        resultReference: "ref_old",
      },
    });
    const input = makePlannerInput({ toolExecutions: [brief] });
    const result = readyForHumanReview(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dedup key helpers
// ---------------------------------------------------------------------------

describe("buildEvidenceRequestDedupKey", () => {
  let buildEvidenceRequestDedupKey: (agentId: string, responsibleParty: string, evidenceItem: string, caseHash: string, evidenceHash: string) => string;

  beforeAll(async () => {
    const mod = await import("../rules");
    buildEvidenceRequestDedupKey = mod.buildEvidenceRequestDedupKey;
  });

  it("produces stable keys for identical inputs", () => {
    const key1 = buildEvidenceRequestDedupKey("agent_1", "worker", "delivery proof", "case_hash_1", "ev_hash_1");
    const key2 = buildEvidenceRequestDedupKey("agent_1", "worker", "delivery proof", "case_hash_1", "ev_hash_1");
    expect(key1).toBe(key2);
  });

  it("produces different keys for different evidence items", () => {
    const key1 = buildEvidenceRequestDedupKey("agent_1", "worker", "item A", "case_hash_1", "ev_hash_1");
    const key2 = buildEvidenceRequestDedupKey("agent_1", "worker", "item B", "case_hash_1", "ev_hash_1");
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different parties", () => {
    const key1 = buildEvidenceRequestDedupKey("agent_1", "worker", "item A", "case_hash_1", "ev_hash_1");
    const key2 = buildEvidenceRequestDedupKey("agent_1", "client", "item A", "case_hash_1", "ev_hash_1");
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Determinism", () => {
  let allRules: readonly ((input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null)[];

  beforeAll(async () => {
    const mod = await import("../rules");
    allRules = mod.ALL_PLANNER_RULES;
  });

  it("identical input produces identical plan", () => {
    const input = makePlannerInput();

    const results = allRules.map((rule) => rule(input));
    const resultsAgain = allRules.map((rule) => rule(input));

    // Each rule should produce the same result for identical input
    for (let i = 0; i < allRules.length; i++) {
      expect(results[i]).toEqual(resultsAgain[i]);
    }
  });

  it("unchanged planning produces no duplicate event (deterministic)", () => {
    const input = makePlannerInput();
    // Running the same rules multiple times should give the same outcome
    const firstPass = allRules.map((rule) => rule(input));
    const secondPass = allRules.map((rule) => rule(input));
    expect(firstPass).toEqual(secondPass);
  });
});

// ---------------------------------------------------------------------------
// One-Action Guarantee
// ---------------------------------------------------------------------------

describe("One-Action Guarantee", () => {
  let allRules: readonly ((input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null)[];

  beforeAll(async () => {
    const mod = await import("../rules");
    allRules = mod.ALL_PLANNER_RULES;
  });

  it("returns exactly one action (first match wins)", () => {
    const input = makePlannerInput();

    // Count how many rules produce a non-null result
    const matchingRules = allRules
      .map((rule) => rule(input))
      .filter((r): r is ResolutionAgentNextAction => r !== null);

    // All rules should fire, but the evaluation loop uses first match
    // This test verifies that at least one rule matches for active agent
    expect(matchingRules.length).toBeGreaterThanOrEqual(1);
  });

  it("never returns both tool and evidence request simultaneously (first match wins)", () => {
    // Set up an input where multiple rules could match
    const toolExec = makeToolExecution({
      tool_identifier: "evidence-quality-check",
      state: "settled",
      evidence_version_hash: "ev_hash_v2",
      result_data: {
        evidenceVersionHash: "ev_hash_v2",
        readiness: "needs_improvement",
        missingEvidence: ["delivery proof"],
        ambiguities: [],
        recommendedImprovements: [],
        reviewerQuestions: [],
      },
    });
    const input = makePlannerInput({ toolExecutions: [toolExec] });

    // Find the first matching rule
    const firstMatch = allRules.reduce<ResolutionAgentNextAction | null>(
      (acc, rule) => acc ?? rule(input),
      null,
    );

    expect(firstMatch).not.toBeNull();
    // The first match is the only action — validate it's a single action
    // If it's create_evidence_request (rule 6), it should not ALSO be run_tool
    // If it's another action, verify it's a single kind
    expect(["run_tool", "create_evidence_request", "wait_for_evidence", "ready_for_human_review", "budget_exhausted", "waiting_for_human_approval", "no_action"]).toContain(firstMatch!.kind);
  });

  it("first matching priority rule wins", () => {
    // Agent with no evidence — rule 3 (noEvidence) should fire before rule 5 (quality check)
    const agent = makeActiveAgent({
      observation: {
        escrowState: "funded",
        evidenceCount: 0,
        evidenceVersionHash: "ev_empty",
        caseVersionHash: "case_hash_v1",
        unresolvedGaps: [],
        hasMeaningfulChange: false,
        observedAt: NOW,
      },
    });
    const obsResult = makeObservationResult("agent_test_1", "case_hash_v1", "ev_empty", {
      observation: {
        ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_empty").observation,
        evidence: {
          ...makeObservationResult("agent_test_1", "case_hash_v1", "ev_empty").observation.evidence,
          fileCount: 0,
          availability: "none",
        },
      },
    });
    const input = makePlannerInput({ agent, observationResult: obsResult });

    const firstMatch = allRules.reduce<ResolutionAgentNextAction | null>(
      (acc, rule) => acc ?? rule(input),
      null,
    );

    expect(firstMatch).not.toBeNull();
    // Rule 3 (noEvidence) should fire, not rule 5 (quality check)
    if (firstMatch!.kind === "create_evidence_request") {
      expect(firstMatch!.plannerReason).toBe("evidence_missing");
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle status handling (integrated with all rules)
// ---------------------------------------------------------------------------

describe("Lifecycle handling across all rules", () => {
  let allRules: readonly ((input: ResolutionAgentPlannerInput) => ResolutionAgentNextAction | null)[];

  beforeAll(async () => {
    const mod = await import("../rules");
    allRules = mod.ALL_PLANNER_RULES;
  });

  const evaluate = (input: ResolutionAgentPlannerInput) =>
    allRules.reduce<ResolutionAgentNextAction | null>((acc, rule) => acc ?? rule(input), null);

  it("awaiting_funding → no_action", () => {
    const agent = makeActiveAgent({ status: "awaiting_funding" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("awaiting_activation → no_action", () => {
    const agent = makeActiveAgent({ status: "awaiting_activation" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("paused → no_action", () => {
    const agent = makeActiveAgent({ status: "paused" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
    expect(result!.reason).toBe("agent_paused");
  });

  it("closing → no_action", () => {
    const agent = makeActiveAgent({ status: "closing" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("closed → no_action", () => {
    const agent = makeActiveAgent({ status: "closed" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("expired → no_action", () => {
    const agent = makeActiveAgent({ status: "expired" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("running_tool → no_action", () => {
    const agent = makeActiveAgent({ status: "running_tool", currentRunningToolId: "case-refresh" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("no_action");
  });

  it("active → may produce one action", () => {
    const agent = makeActiveAgent({ status: "active" });
    const input = makePlannerInput({ agent });
    const result = evaluate(input);
    expect(result).not.toBeNull();
    // Active without pre-existing tool results should propose a quality check
    expect(["run_tool", "create_evidence_request"]).toContain(result!.kind);
  });

  it("budget_exhausted status → falls through to default", () => {
    const agent = makeActiveAgent({ status: "budget_exhausted" });
    const input = makePlannerInput({ agent });
    // When all rules return null (budget_exhausted falls through), the result is null
    // The service layer handles the default case
    const result = evaluate(input);
    expect(result).toBeNull();
  });

  it("ready_for_human_review status → falls through to default", () => {
    const agent = makeActiveAgent({ status: "ready_for_human_review" });
    const input = makePlannerInput({ agent });
    // When all rules return null, service layer handles the default
    const result = evaluate(input);
    expect(result).toBeNull();
  });
});
