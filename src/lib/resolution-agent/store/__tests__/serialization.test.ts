import { describe, it, expect } from "vitest";
import { agentToInsertRow, rowToAgent } from "../serialization";
import { ResolutionAgentSerializationError } from "../errors";
import type { ResolutionAgent, EncryptedWalletSecret } from "../../types";
import {
  AGENT_STATES,
  ENCRYPTED_WALLET_SECRET_VERSION,
  ENCRYPTED_WALLET_SECRET_ALGORITHM,
} from "../../types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SYNTHETIC_CIPHERTEXT =
  "synthetic-ciphertext-for-serialization-test-base64";
const SYNTHETIC_IV = "synthetic-iv-for-serialization-test-base64";
const SYNTHETIC_AUTH_TAG =
  "synthetic-authtag-for-serialization-test-base64";

const BASE_EPOCH = 1000000;
const BASE_EPOCH_ISO = new Date(BASE_EPOCH).toISOString();
const ACTIVATED_EPOCH = 4000000;
const ACTIVATED_EPOCH_ISO = new Date(ACTIVATED_EPOCH).toISOString();

function makeTestEncryptedSecret(
  overrides: Partial<EncryptedWalletSecret> = {},
): EncryptedWalletSecret {
  return {
    version: ENCRYPTED_WALLET_SECRET_VERSION,
    algorithm: ENCRYPTED_WALLET_SECRET_ALGORITHM,
    ciphertext: SYNTHETIC_CIPHERTEXT,
    iv: SYNTHETIC_IV,
    authenticationTag: SYNTHETIC_AUTH_TAG,
    ...overrides,
  };
}

function makeTestAgent(
  overrides: Partial<ResolutionAgent> = {},
): ResolutionAgent {
  return {
    id: "agent_ser_001",
    goal: "Prepare this payment case for fair human review.",
    status: "active",
    identity: {
      escrowPaymentId: "pay_ser_001",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: {
      allowedTools: ["evidence-quality-check", "case-refresh"],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999,
      funderAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    budget: {
      approvedAtomic: 1000000n,
      spentAtomic: 20000n,
      reservedAtomic: 10000n,
    },
    plan: {
      steps: [
        { kind: "read_agreement", description: "Read the dispute agreement" },
        { kind: "check_evidence", description: "Verify uploaded evidence" },
      ],
      currentStepIndex: 0,
      lastUpdated: 5000000,
      caseVersionHash: "0xdef456",
      evidenceVersionHash: "0xabc123",
    },
    observation: {
      escrowState: "funded",
      evidenceCount: 2,
      evidenceVersionHash: "0xabc123",
      caseVersionHash: "0xdef456",
      unresolvedGaps: [],
      hasMeaningfulChange: true,
      observedAt: 5000000,
    },
    caseWalletAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    encryptedSecret: makeTestEncryptedSecret(),
    settledToolIds: [],
    currentRunningToolId: null,
    createdAt: BASE_EPOCH,
    updatedAt: 5000000,
    activatedAt: ACTIVATED_EPOCH,
    pausedAt: null,
    closedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// agentToInsertRow — basic field mapping
// ---------------------------------------------------------------------------

describe("agentToInsertRow", () => {
  it("converts a valid agent to insert row with correct field mapping", () => {
    const agent = makeTestAgent();
    const row = agentToInsertRow(agent);

    expect(row).toBeDefined();
    expect(row.agent_id).toBe("agent_ser_001");
    expect(row.goal).toBe("Prepare this payment case for fair human review.");
    expect(row.status).toBe("active");
    expect(row.escrow_payment_id).toBe("pay_ser_001");
    expect(row.escrow_chain_id).toBe("eip155:42220");
    expect(row.case_wallet_address).toBe(
      "0xcccccccccccccccccccccccccccccccccccccccc",
    );
  });

  it("maps agent_id correctly", () => {
    const agent = makeTestAgent({ id: "custom_agent_id_42" });
    const row = agentToInsertRow(agent);
    expect(row.agent_id).toBe("custom_agent_id_42");
  });

  it("goal fixed string persists", () => {
    const agent = makeTestAgent();
    const row = agentToInsertRow(agent);
    expect(row.goal).toBe("Prepare this payment case for fair human review.");
  });

  it("allowed_tools as string array maps correctly", () => {
    const agent = makeTestAgent({
      policy: {
        ...makeTestAgent().policy,
        allowedTools: ["evidence-quality-check", "reclaim-dispute-brief-v1"],
      },
    });
    const row = agentToInsertRow(agent);
    expect(row.allowed_tools).toEqual([
      "evidence-quality-check",
      "reclaim-dispute-brief-v1",
    ]);
  });

  it("plan object serializes to JSONB-compatible object", () => {
    const agent = makeTestAgent({
      plan: {
        steps: [
          { kind: "read_agreement", description: "Read agreement" },
          {
            kind: "purchase_evidence_check",
            description: "Run evidence check",
            toolId: "evidence-quality-check",
          },
          { kind: "finalize", description: "Finalize review" },
        ],
        currentStepIndex: 2,
        lastUpdated: 7000000,
        caseVersionHash: "0x111111",
        evidenceVersionHash: "0x222222",
      },
    });
    const row = agentToInsertRow(agent);

    expect(row.current_plan).toBeDefined();
    const plan = row.current_plan as Record<string, unknown>;
    expect(plan.currentStepIndex).toBe(2);
    expect(plan.caseVersionHash).toBe("0x111111");
    expect(Array.isArray(plan.steps)).toBe(true);
    expect((plan.steps as Array<Record<string, unknown>>)).toHaveLength(3);
  });

  it("observation serializes correctly with evidence gaps", () => {
    const agent = makeTestAgent({
      observation: {
        escrowState: "funded",
        evidenceCount: 3,
        evidenceVersionHash: "0xevhash",
        caseVersionHash: "0xcasehash",
        unresolvedGaps: [
          {
            id: "gap_001",
            description: "Missing employment contract",
            responsibleParty: "worker",
            status: "open",
            createdAt: 3000000,
            caseChangedAfterFulfillment: false,
          },
        ],
        hasMeaningfulChange: false,
        observedAt: 6000000,
      },
    });
    const row = agentToInsertRow(agent);

    expect(row.observations).toBeDefined();
    const obs = row.observations as Record<string, unknown>;
    expect(obs.evidenceCount).toBe(3);
    const gaps = obs.unresolvedGaps as Array<Record<string, unknown>>;
    expect(gaps).toHaveLength(1);
    expect(gaps[0].id).toBe("gap_001");
    expect(gaps[0].responsibleParty).toBe("worker");
    expect(gaps[0].status).toBe("open");
  });

  it("nullable fields (activated_at, paused_at, closed_at) are null when not set", () => {
    const agent = makeTestAgent({
      activatedAt: null,
      pausedAt: null,
      closedAt: null,
    });
    const row = agentToInsertRow(agent);

    expect(row.activated_at).toBeNull();
    expect(row.paused_at).toBeNull();
    expect(row.closed_at).toBeNull();
  });

  it("timestamps are stored as ISO date strings", () => {
    const agent = makeTestAgent({
      activatedAt: 1000000,
      pausedAt: 2000000,
      closedAt: 3000000,
    });
    const row = agentToInsertRow(agent);

    expect(row.activated_at).toBe(new Date(1000000).toISOString());
    expect(row.paused_at).toBe(new Date(2000000).toISOString());
    expect(row.closed_at).toBe(new Date(3000000).toISOString());
    expect(row.created_at).toBe(new Date(BASE_EPOCH).toISOString());
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — bigint handling
// ---------------------------------------------------------------------------

describe("agentToInsertRow — bigint budget handling", () => {
  it("converts bigint budget values to numbers for DB storage", () => {
    const agent = makeTestAgent({
      budget: { approvedAtomic: 500000n, spentAtomic: 12345n, reservedAtomic: 0n },
      policy: {
        ...makeTestAgent().policy,
        approvedBudgetAtomic: 500000n,
      },
    });
    const row = agentToInsertRow(agent);

    // Bigints are converted to plain Numbers since PostgreSQL BIGINT
    // is represented as JavaScript number via Supabase-js
    expect(typeof row.approved_budget_atomic).toBe("number");
    expect(row.approved_budget_atomic).toBe(500000);
    expect(row.spent_budget_atomic).toBe(12345);
    expect(row.reserved_budget_atomic).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — address normalization
// ---------------------------------------------------------------------------

describe("agentToInsertRow — address normalization", () => {
  it("normalizes case_wallet_address to lowercase in DB row", () => {
    const agent = makeTestAgent({
      caseWalletAddress: "0xAaBbCcDdEeFf0011223344556677889900AaBbCc",
    });
    const row = agentToInsertRow(agent);
    expect(row.case_wallet_address).toBe(
      "0xaabbccddeeff0011223344556677889900aabbcc",
    );
  });

  it("normalizes funder_address to lowercase in DB row", () => {
    const agent = makeTestAgent({
      policy: {
        ...makeTestAgent().policy,
        funderAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
      },
    });
    const row = agentToInsertRow(agent);
    expect(row.funder_address).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("normalizes escrow_contract_address to lowercase in DB row", () => {
    const agent = makeTestAgent({
      identity: {
        escrowPaymentId: "pay_addr",
        escrowChainId: "eip155:42220",
        escrowContractAddress: "0xAAAAaaaabbbbBBBBccccCCCCddddDDDDeeeeEEEE",
      },
    });
    const row = agentToInsertRow(agent);
    // 40 hex chars after 0x, all lowercase
    expect(row.escrow_contract_address).toBe(
      "0xaaaaaaaabbbbbbbbccccccccddddddddeeeeeeee",
    );
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — encrypted envelope
// ---------------------------------------------------------------------------

describe("agentToInsertRow — encrypted secret envelope", () => {
  it("encrypted envelope is passed through intact", () => {
    const agent = makeTestAgent({
      encryptedSecret: makeTestEncryptedSecret({
        keyVersionId: "kv_1",
      }),
    });
    const row = agentToInsertRow(agent);

    const secret = row.encrypted_wallet_secret as Record<string, unknown>;
    expect(secret.version).toBe(1);
    expect(secret.algorithm).toBe("AES-256-GCM");
    expect(secret.ciphertext).toBe(SYNTHETIC_CIPHERTEXT);
    expect(secret.iv).toBe(SYNTHETIC_IV);
    expect(secret.authenticationTag).toBe(SYNTHETIC_AUTH_TAG);
    expect(secret.keyVersionId).toBe("kv_1");
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — version number
// ---------------------------------------------------------------------------

describe("agentToInsertRow — version number", () => {
  it("version defaults to 1 for new rows", () => {
    const agent = makeTestAgent();
    const row = agentToInsertRow(agent);
    expect(row.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — status validation
// ---------------------------------------------------------------------------

describe("agentToInsertRow — status validation", () => {
  it("valid statuses are mapped directly", () => {
    for (const status of AGENT_STATES) {
      const agent = makeTestAgent({ status });
      const row = agentToInsertRow(agent);
      expect(row.status).toBe(status);
    }
  });

  it("agent with valid status maps correctly", () => {
    const agent = makeTestAgent({ status: "awaiting_funding" });
    const row = agentToInsertRow(agent);
    expect(row.status).toBe("awaiting_funding");
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — encrypted envelope validation (pending implementation)
// ---------------------------------------------------------------------------

describe("agentToInsertRow — encrypted envelope validation", () => {
  it("rejects missing ciphertext", () => {
    const agent = makeTestAgent({
      encryptedSecret: { version: 1, algorithm: "AES-256-GCM" } as EncryptedWalletSecret,
    });
    expect(() => agentToInsertRow(agent)).toThrow(
      ResolutionAgentSerializationError,
    );
  });

  it("rejects missing iv", () => {
    const agent = makeTestAgent({
      encryptedSecret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "ct",
      } as EncryptedWalletSecret,
    });
    expect(() => agentToInsertRow(agent)).toThrow(
      ResolutionAgentSerializationError,
    );
  });

  it("rejects missing authentication tag", () => {
    const agent = makeTestAgent({
      encryptedSecret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "ct",
        iv: "iv",
      } as EncryptedWalletSecret,
    });
    expect(() => agentToInsertRow(agent)).toThrow(
      ResolutionAgentSerializationError,
    );
  });
});

// ---------------------------------------------------------------------------
// agentToInsertRow — bigint validation (pending implementation)
// ---------------------------------------------------------------------------

describe("agentToInsertRow — bigint validation", () => {
  it("NaN bigint values are handled gracefully", () => {
    // NaN cannot be constructed as a bigint in JS. The NaN case is
    // exercised at the row level: rowToAgent receiving a non-numeric
    // value for a bigint field should throw a clear error.
    const agent = makeTestAgent({
      budget: { approvedAtomic: 0n, spentAtomic: 0n, reservedAtomic: 0n },
    });
    const row = {
      ...agentToInsertRow(agent),
      approved_budget_atomic: "not-a-number",
    } as unknown as Parameters<typeof rowToAgent>[0];
    expect(() => rowToAgent(row)).toThrow(ResolutionAgentSerializationError);
  });

  it("negative approved budget is handled gracefully", () => {
    const agent = makeTestAgent({
      budget: { approvedAtomic: -1n, spentAtomic: 0n, reservedAtomic: 0n },
      policy: { ...makeTestAgent().policy, approvedBudgetAtomic: -1n },
    });
    // Should either throw a clear error or normalize — we assert the behavior
    expect(() => agentToInsertRow(agent)).toThrow(
      ResolutionAgentSerializationError,
    );
  });
});

// ---------------------------------------------------------------------------
// rowToAgent — basic reconstruction
// ---------------------------------------------------------------------------

describe("rowToAgent", () => {
  function makeValidRow(overrides: Record<string, unknown> = {}) {
    return {
      agent_id: "row_agent_001",
      goal: "Prepare this payment case for fair human review.",
      status: "active",
      escrow_payment_id: "pay_row_001",
      escrow_chain_id: "eip155:42220",
      escrow_contract_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      allowed_tools: ["evidence-quality-check", "case-refresh"],
      approved_budget_atomic: 1000000,
      spent_budget_atomic: 20000,
      reserved_budget_atomic: 10000,
      expires_at: "9999-12-31T23:59:59.000Z",
      funder_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      current_plan: {
        steps: [
          { kind: "read_agreement", description: "Read agreement" },
        ],
        currentStepIndex: 0,
        lastUpdated: 5000000,
        caseVersionHash: "0xdef456",
        evidenceVersionHash: "0xabc123",
      },
      observations: {
        escrowState: "funded",
        evidenceCount: 2,
        evidenceVersionHash: "0xabc123",
        caseVersionHash: "0xdef456",
        unresolvedGaps: [],
        hasMeaningfulChange: true,
        observedAt: 5000000,
      },
      case_wallet_address: "0xcccccccccccccccccccccccccccccccccccccccc",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: SYNTHETIC_CIPHERTEXT,
        iv: SYNTHETIC_IV,
        authenticationTag: SYNTHETIC_AUTH_TAG,
      },
      created_at: BASE_EPOCH_ISO,
      updated_at: BASE_EPOCH_ISO,
      activated_at: ACTIVATED_EPOCH_ISO,
      paused_at: null,
      closed_at: null,
      version: 1,
      lease_owner: null,
      lease_expires_at: null,
      current_running_tool_id: null,
      // Additional fields the implementation may look at
      id: "db-uuid-001",
      evidence_version_hash: "0xabc123",
      case_version_hash: "0xdef456",
      funded_at: null,
      ...overrides,
    };
  }

  it("reconstructs a valid agent from a row", () => {
    const row = makeValidRow();
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);

    expect(agent.id).toBe("row_agent_001");
    expect(agent.goal).toBe(
      "Prepare this payment case for fair human review.",
    );
    expect(agent.status).toBe("active");
    expect(agent.identity.escrowPaymentId).toBe("pay_row_001");
    expect(agent.identity.escrowChainId).toBe("eip155:42220");
    expect(agent.identity.escrowContractAddress).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("bigint budget values survive round-trip exactly", () => {
    const row = makeValidRow({
      approved_budget_atomic: 1000000,
      spent_budget_atomic: 0,
      reserved_budget_atomic: 50000,
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);

    expect(agent.budget.approvedAtomic).toBe(1000000n);
    expect(agent.budget.spentAtomic).toBe(0n);
    expect(agent.budget.reservedAtomic).toBe(50000n);

    // Re-serialize and verify the numbers match
    const backToRow = agentToInsertRow(agent);
    expect(backToRow.approved_budget_atomic).toBe(1000000);
    expect(backToRow.spent_budget_atomic).toBe(0);
    expect(backToRow.reserved_budget_atomic).toBe(50000);
  });

  it("encrypted envelope survives round-trip exactly", () => {
    const row = makeValidRow({
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: SYNTHETIC_CIPHERTEXT,
        iv: SYNTHETIC_IV,
        authenticationTag: SYNTHETIC_AUTH_TAG,
        keyVersionId: "kv_live",
      },
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);
    const backToRow = agentToInsertRow(agent);

    const secret = backToRow.encrypted_wallet_secret as Record<string, unknown>;
    expect(secret.version).toBe(1);
    expect(secret.algorithm).toBe("AES-256-GCM");
    expect(secret.ciphertext).toBe(SYNTHETIC_CIPHERTEXT);
    expect(secret.iv).toBe(SYNTHETIC_IV);
    expect(secret.authenticationTag).toBe(SYNTHETIC_AUTH_TAG);
    expect(secret.keyVersionId).toBe("kv_live");
  });

  it("reconstructs plan from row", () => {
    const row = makeValidRow({
      current_plan: {
        steps: [
          {
            kind: "purchase_dispute_brief",
            description: "Purchase brief",
            toolId: "reclaim-dispute-brief-v1",
          },
        ],
        currentStepIndex: 1,
        lastUpdated: 8000000,
        caseVersionHash: "0xplan",
        evidenceVersionHash: "0xevplan",
      },
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);

    expect(agent.plan).not.toBeNull();
    expect(agent.plan!.steps).toHaveLength(1);
    expect(agent.plan!.steps[0].kind).toBe("purchase_dispute_brief");
    expect(agent.plan!.steps[0].toolId).toBe("reclaim-dispute-brief-v1");
    expect(agent.plan!.currentStepIndex).toBe(1);
    expect(agent.plan!.caseVersionHash).toBe("0xplan");
  });

  it("reconstructs observation from row with evidence gaps", () => {
    const row = makeValidRow({
      observations: {
        escrowState: "disputed",
        evidenceCount: 5,
        evidenceVersionHash: "0xobshash",
        caseVersionHash: "0xcaseobs",
        unresolvedGaps: [
          {
            id: "gap_row_1",
            description: "Pending ID verification",
            responsibleParty: "client",
            status: "open",
            createdAt: 4000000,
            caseChangedAfterFulfillment: true,
          },
          {
            id: "gap_row_2",
            description: "Bank statement needed",
            responsibleParty: "worker",
            status: "fulfilled",
            createdAt: 4100000,
            fulfilledAt: 4200000,
            caseChangedAfterFulfillment: false,
          },
        ],
        hasMeaningfulChange: true,
        observedAt: 7000000,
      },
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);

    expect(agent.observation).not.toBeNull();
    expect(agent.observation!.escrowState).toBe("disputed");
    expect(agent.observation!.evidenceCount).toBe(5);
    const gaps = agent.observation!.unresolvedGaps;
    expect(gaps).toHaveLength(2);
    expect(gaps[0].id).toBe("gap_row_1");
    expect(gaps[0].responsibleParty).toBe("client");
    expect(gaps[1].id).toBe("gap_row_2");
    expect(gaps[1].responsibleParty).toBe("worker");
  });

  it("handles NULL-safe nullable columns", () => {
    const row = makeValidRow({
      activated_at: null,
      paused_at: null,
      closed_at: null,
      current_plan: null,
      observations: null,
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);

    expect(agent.activatedAt).toBeNull();
    expect(agent.pausedAt).toBeNull();
    expect(agent.closedAt).toBeNull();
    // plan and observation are null when not present
    expect(agent.plan).toBeNull();
    expect(agent.observation).toBeNull();
  });

  it("funder_address survives round-trip exactly", () => {
    // Normalization happens on INSERT (agentToInsertRow lowercases it).
    // On SELECT (rowToAgent), the value is passed through as-is since
    // it was already normalized when written.
    const row = makeValidRow({
      funder_address: "0xabcdef1234567890abcdef1234567890abcdef12",
    });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);
    expect(agent.policy.funderAddress).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("lease_owner and lease_expires_at are stored in the row but not on domain agent", () => {
    // lease_owner and lease_expires_at are store-level concurrency fields.
    // They are NOT part of the ResolutionAgent domain type. rowToAgent
    // should still accept rows that contain them without error (forward
    // compatibility), but they are not mapped onto the domain object.
    const row = makeValidRow({
      lease_owner: "server-east-1",
      lease_expires_at: "2025-01-01T00:00:00.000Z",
    });
    // Should not throw when these extra columns are present
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).not.toThrow();
  });

  it("lease_owner and lease_expires_at are null does not cause errors in row", () => {
    const row = makeValidRow({
      lease_owner: null,
      lease_expires_at: null,
    });
    // Should not throw when lease fields are null
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).not.toThrow();
  });

  it("version number is read from row for domain round-trips", () => {
    // rowToAgent reads the version from the row. agentToInsertRow always
    // sets version to 1 (fresh insert). agentToUpdateRow handles version
    // incrementing for updates. This test verifies that reading a row
    // with a specific version doesn't throw.
    const row = makeValidRow({ version: 7 });
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);
    // Domain agent is reconstructed successfully with the versioned row
    expect(agent).toBeDefined();
    expect(agent.id).toBe("row_agent_001");

    // agentToInsertRow always starts at version 1 for new inserts
    const insertRow = agentToInsertRow(agent);
    expect(insertRow.version).toBe(1);
  });

  it("settledToolIds defaults to empty array when reconstructed from row", () => {
    const row = makeValidRow();
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);
    // settledToolIds are populated from tool_executions table, not the agent row
    expect(Array.isArray(agent.settledToolIds)).toBe(true);
    expect(agent.settledToolIds).toHaveLength(0);
  });

  it("currentRunningToolId defaults to null when reconstructed from row", () => {
    const row = makeValidRow();
    const agent = rowToAgent(row as Parameters<typeof rowToAgent>[0]);
    // currentRunningToolId is populated from tool_executions table
    expect(agent.currentRunningToolId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rowToAgent — error handling
// ---------------------------------------------------------------------------

describe("rowToAgent — error handling", () => {
  function makeRowBase() {
    return {
      agent_id: "err_agent",
      goal: "Prepare this payment case for fair human review.",
      status: "flying", // deliberately invalid
      escrow_payment_id: "pay_err",
      escrow_chain_id: "eip155:42220",
      escrow_contract_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      allowed_tools: ["evidence-quality-check"],
      approved_budget_atomic: 0,
      spent_budget_atomic: 0,
      reserved_budget_atomic: 0,
      expires_at: "9999-12-31T23:59:59.000Z",
      funder_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      current_plan: null,
      observations: null,
      case_wallet_address: "0xcccccccccccccccccccccccccccccccccccccccc",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: SYNTHETIC_CIPHERTEXT,
        iv: SYNTHETIC_IV,
        authenticationTag: SYNTHETIC_AUTH_TAG,
      },
      created_at: BASE_EPOCH_ISO,
      updated_at: BASE_EPOCH_ISO,
      activated_at: null,
      paused_at: null,
      closed_at: null,
      version: 1,
      lease_owner: null,
      lease_expires_at: null,
      current_running_tool_id: null,
      id: "db-uuid-err",
      evidence_version_hash: null,
      case_version_hash: null,
      funded_at: null,
    };
  }

  it("malformed status in row throws ResolutionAgentSerializationError", () => {
    const row = { ...makeRowBase(), status: "flying" };
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).toThrow(ResolutionAgentSerializationError);
  });

  it("non-existent status throws ResolutionAgentSerializationError", () => {
    const row = { ...makeRowBase(), status: "warp_speed" };
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).toThrow(ResolutionAgentSerializationError);
  });

  it("malformed encrypted envelope (missing required fields) throws ResolutionAgentSerializationError", () => {
    const row = {
      ...makeRowBase(),
      status: "active",
      encrypted_wallet_secret: {
        version: 1,
        // algorithm, ciphertext, iv, authenticationTag all missing
      },
    };
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).toThrow(ResolutionAgentSerializationError);
  });

  it("malformed encrypted envelope (empty ciphertext) throws ResolutionAgentSerializationError", () => {
    const row = {
      ...makeRowBase(),
      status: "active",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "",
        iv: "iv",
        authenticationTag: "tag",
      },
    };
    expect(() =>
      rowToAgent(row as Parameters<typeof rowToAgent>[0]),
    ).toThrow(ResolutionAgentSerializationError);
  });

  it("serialization errors do NOT contain ciphertext in the error message", () => {
    const row = {
      ...makeRowBase(),
      status: "active",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "",
        iv: "sensitive-iv-data",
        authenticationTag: "sensitive-auth-tag-data",
      },
    };

    try {
      rowToAgent(row as Parameters<typeof rowToAgent>[0]);
      expect.fail("Expected error to be thrown");
    } catch (err) {
      const message = String(
        err instanceof Error ? err.message : err,
      );
      expect(message).not.toContain("sensitive-iv-data");
      expect(message).not.toContain("sensitive-auth-tag-data");
      expect(message).not.toContain(SYNTHETIC_CIPHERTEXT);
    }
  });

  it("serialization errors do NOT contain IV in the error message", () => {
    const row = {
      ...makeRowBase(),
      status: "active",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "some-ciphertext",
        iv: "",
        authenticationTag: "tag",
      },
    };

    try {
      rowToAgent(row as Parameters<typeof rowToAgent>[0]);
      expect.fail("Expected error to be thrown");
    } catch (err) {
      const message = String(
        err instanceof Error ? err.message : err,
      );
      expect(message).not.toContain(SYNTHETIC_IV);
      expect(message).not.toContain(SYNTHETIC_CIPHERTEXT);
    }
  });

  it("serialization errors do NOT contain authenticationTag in the error message", () => {
    const row = {
      ...makeRowBase(),
      status: "active",
      encrypted_wallet_secret: {
        version: 1,
        algorithm: "AES-256-GCM",
        ciphertext: "ct",
        iv: "iv",
        authenticationTag: "",
      },
    };

    try {
      rowToAgent(row as Parameters<typeof rowToAgent>[0]);
      expect.fail("Expected error to be thrown");
    } catch (err) {
      const message = String(
        err instanceof Error ? err.message : err,
      );
      expect(message).not.toContain(SYNTHETIC_AUTH_TAG);
      expect(message).not.toContain(SYNTHETIC_CIPHERTEXT);
    }
  });
});
