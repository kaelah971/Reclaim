// ---------------------------------------------------------------------------
// Resolution Agent API — Auth Message Tests
//
// Validates wallet-signable message format for creation and activation.
// Messages must be non-empty, distinct, and contain all required identifiers
// so that signature verification can tie the signature to a single action.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildCreateAgentMessage,
  buildActivationMessage,
} from "../auth";

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
    expect(msg).toContain(createParams.escrowContractAddress);
  });

  it("includes escrow payment ID", () => {
    const msg = buildCreateAgentMessage(createParams);
    expect(msg).toContain(createParams.escrowPaymentId);
  });

  it("includes budget atomic", () => {
    const msg = buildCreateAgentMessage(createParams);
    // Bigint as string should appear somewhere in the message
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
    // Wallet signing libraries (viem, ethers) typically require UTF-8 strings
    // without null bytes. The message should be plain printable text.
    const msg = buildCreateAgentMessage(createParams);
    expect(() => new TextEncoder().encode(msg)).not.toThrow();
    // Should not contain null bytes
    expect(msg).not.toContain("\0");
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
    // Even if the funder is the same, the activation message must be
    // distinct from a creation message to prevent signature replay or
    // confusion.
    const createMsg = buildCreateAgentMessage(createParams);
    const activateMsg = buildActivationMessage({
      agentId: "agent_same_funder",
      funderAddress: funderA,
    });
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
