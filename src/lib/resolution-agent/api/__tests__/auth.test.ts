// ---------------------------------------------------------------------------
// Resolution Agent API — Auth Message Tests
//
// Validates wallet-signable message format for creation and activation.
// Messages must be non-empty, distinct, and contain all required identifiers
// so that signature verification can tie the signature to a single action.
//
// HARDENED: messages now include policy version, authorization expiry,
// canonical escrow contract address, tool allowlists, and fixed goals
// to prevent signature replays across different contexts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildCreateAgentMessage,
  buildActivationMessage,
} from "../auth";
import {
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
} from "../escrow-reader";
import { FIXED_AGENT_GOAL } from "../../types";
import { V1_TOOLS } from "../../tools";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const funderA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const funderB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const createParams = {
  escrowChainId: "eip155:11142220",
  escrowContractAddress: "0x1111111111111111111111111111111111111111",
  escrowPaymentId: "pay_test_001",
  budgetAtomic: 30_000n as bigint,
  funderAddress: funderA,
};

const altCreateParams = {
  escrowChainId: "eip155:11142220",
  escrowContractAddress: "0x2222222222222222222222222222222222222222",
  escrowPaymentId: "pay_test_002",
  budgetAtomic: 50_000n as bigint,
  funderAddress: funderA,
};

const activationParams = {
  agentId: "agent_abc123",
  escrowChainId: "eip155:11142220",
  escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
  escrowPaymentId: "pay_test_001",
  goal: FIXED_AGENT_GOAL,
  approvedBudgetAtomic: 30_000n as bigint,
  refundAddress: funderA,
  policyVersion: "v1",
  allowedToolIds: [...V1_TOOLS.map((t) => t.id)] as readonly string[],
  agentExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  authorizationExpiresAt: Date.now() + 5 * 60 * 1000,
  funderAddress: funderA,
};

// ---------------------------------------------------------------------------
// buildCreateAgentMessage
// ---------------------------------------------------------------------------

describe("buildCreateAgentMessage", () => {
  it("includes 'Reclaim' application name", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toMatch(/Reclaim/i);
  });

  it("includes escrow chain ID", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(createParams.escrowChainId);
  });

  it("includes escrow contract address", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(CANONICAL_ESCROW_CONTRACT_ADDRESS);
  });

  it("includes escrow payment ID", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(createParams.escrowPaymentId);
  });

  it("includes budget atomic", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain("30000");
  });

  it("includes funder address", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(funderA);
  });

  it("is different for different cases", () => {
    const msg1 = buildCreateAgentMessage(createParams);
    const msg2 = buildCreateAgentMessage(altCreateParams);
    expect(msg1).not.toBe(msg2);
  });

  it("is different for different funders", () => {
    const msg1 = buildCreateAgentMessage(createParams);
    const msg2 = buildCreateAgentMessage({
      ...createParams,
      funderAddress: funderB,
    });
    expect(msg1).not.toBe(msg2);
  });

  it("returns a non-empty string", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("message can be formatted for wallet signing", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(() => new TextEncoder().encode(msg)).not.toThrow();
    expect(msg).not.toContain("\0");
  });

  // -----------------------------------------------------------------------
  // HARDENED: create message tests
  // -----------------------------------------------------------------------

  it("create message includes policyVersion 'v1'", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain("Policy Version: v1");
  });

  it("create message includes authorization expiration timestamp", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toMatch(/Authorization Expires: \d+/);
  });

  it("create message includes canonical escrow contract address", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(CANONICAL_ESCROW_CONTRACT_ADDRESS);
  });

  it("authorization expiry is in the future (within 5 minutes)", () => {
    const beforeCall = Date.now();
    const msg = buildCreateAgentMessage(createParams);
    const afterCall = Date.now();

    const match = msg.match(/Authorization Expires: (\d+)/);
    expect(match).not.toBeNull();
    const expiry = parseInt(match![1], 10);

    const fiveMinutesMs = 5 * 60 * 1000;
    expect(expiry).toBeGreaterThanOrEqual(beforeCall);
    expect(expiry).toBeLessThanOrEqual(afterCall + fiveMinutesMs + 1000);
  });

  it("different budget produces different message", () => {
    const msg1 = buildCreateAgentMessage(createParams);
    const msg2 = buildCreateAgentMessage({
      ...createParams,
      budgetAtomic: 40_000n,
    });
    expect(msg1).not.toBe(msg2);
  });

  it("different paymentId produces different message", () => {
    const msg1 = buildCreateAgentMessage(createParams);
    const msg2 = buildCreateAgentMessage({
      ...createParams,
      escrowPaymentId: "pay_different_999",
    });
    expect(msg1).not.toBe(msg2);
  });

  it("different funder produces different message", () => {
    const msg1 = buildCreateAgentMessage(createParams);
    const msg2 = buildCreateAgentMessage({
      ...createParams,
      funderAddress: funderB,
    });
    expect(msg1).not.toBe(msg2);
  });
});

// ---------------------------------------------------------------------------
// buildActivationMessage
// ---------------------------------------------------------------------------

describe("buildActivationMessage", () => {
  it("includes agentId", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain(activationParams.agentId);
  });

  it("includes funder address", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain(activationParams.funderAddress);
  });

  it("is different for different agent IDs", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      agentId: "agent_xyz789",
    });
    expect(msg1).not.toBe(msg2);
  });

  it("differs from creation message for same params", () => {
    const createMsg = buildCreateAgentMessage(createParams);
    const activateMsg = buildActivationMessage(activationParams);
    expect(createMsg).not.toBe(activateMsg);
  });

  it("returns a non-empty string", () => {
    const msg = buildActivationMessage(activationParams);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("message can be formatted for wallet signing", () => {
    const msg = buildActivationMessage(activationParams);
    expect(() => new TextEncoder().encode(msg)).not.toThrow();
    expect(msg).not.toContain("\0");
  });

  it("includes 'Reclaim' application name", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toMatch(/Reclaim/i);
  });

  // -----------------------------------------------------------------------
  // HARDENED: activation message tests
  // -----------------------------------------------------------------------

  it("activation message includes action 'activate_resolution_agent'", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Action: activate_resolution_agent");
  });

  it("activation message includes agentId", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Agent ID: agent_abc123");
  });

  it("activation message includes escrowChainId", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Escrow Chain ID: eip155:11142220");
  });

  it("activation message includes escrowContractAddress", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Escrow Contract: " + CANONICAL_ESCROW_CONTRACT_ADDRESS);
  });

  it("activation message includes escrowPaymentId", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Escrow Payment ID: pay_test_001");
  });

  it("activation message includes fixed goal", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Goal: " + FIXED_AGENT_GOAL);
  });

  it("activation message includes approved budget as string", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Approved Budget (atomic USDC): 30000");
  });

  it("activation message includes refund address", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Refund Address: " + funderA);
  });

  it("activation message includes policy version", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Policy Version: v1");
  });

  it("activation message includes all three canonical tool identifiers", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("evidence-quality-check");
    expect(msg).toContain("case-refresh");
    expect(msg).toContain("reclaim-dispute-brief-v1");
  });

  it("activation message includes agent expiry timestamp", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toMatch(/Agent Expiry: \d+/);
  });

  it("activation message includes authorization expiry timestamp", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toMatch(/Authorization Expires: \d+/);
  });

  it("activation message includes version 'v1'", () => {
    const msg = buildActivationMessage(activationParams);
    expect(msg).toContain("Version: v1");
  });

  it("changing any bound field produces different message", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      agentId: "agent_different_999",
    });
    expect(msg1).not.toBe(msg2);
  });

  it("changed budget → different message", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      approvedBudgetAtomic: 50_000n,
    });
    expect(msg1).not.toBe(msg2);
  });

  it("changed refund address → different message", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      refundAddress: funderB,
    });
    expect(msg1).not.toBe(msg2);
  });

  it("changed agent expiry → different message", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      agentExpiresAt: activationParams.agentExpiresAt + 86_400_000,
    });
    expect(msg1).not.toBe(msg2);
  });

  it("creation message differs from activation message", () => {
    const createMsg = buildCreateAgentMessage(createParams);
    const activateMsg = buildActivationMessage(activationParams);
    expect(createMsg).not.toBe(activateMsg);
  });

  it("signature for one agent produces different message than for another agent", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage({
      ...activationParams,
      agentId: "agent_second_instance",
      escrowPaymentId: "pay_different_case",
    });
    expect(msg1).not.toBe(msg2);
  });

  it("activation message can be reconstructed server-side (deterministic given same inputs)", () => {
    const msg1 = buildActivationMessage(activationParams);
    const msg2 = buildActivationMessage(activationParams);

    // Both should contain the same bound fields (timestamps/nonces differ)
    const boundFields = [
      "Action: activate_resolution_agent",
      "Agent ID: agent_abc123",
      "Escrow Chain ID: eip155:11142220",
      "Escrow Payment ID: pay_test_001",
      "Goal: " + FIXED_AGENT_GOAL,
      "Approved Budget (atomic USDC): 30000",
      "Refund Address: " + funderA,
      "Policy Version: v1",
      "Version: v1",
    ];

    for (const field of boundFields) {
      expect(msg1).toContain(field);
      expect(msg2).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: both functions exist and are callable
// ---------------------------------------------------------------------------

describe("auth message module shape", () => {
  it("buildCreateAgentMessage is a function", () => {
    expect(typeof buildCreateAgentMessage).toBe("function");
  });

  it("buildActivationMessage is a function", () => {
    expect(typeof buildActivationMessage).toBe("function");
  });

  it("buildCreateAgentMessage accepts 1 argument", () => {
    expect(buildCreateAgentMessage.length).toBeGreaterThanOrEqual(1);
  });

  it("buildActivationMessage accepts 1 argument", () => {
    expect(buildActivationMessage.length).toBeGreaterThanOrEqual(1);
  });
});
