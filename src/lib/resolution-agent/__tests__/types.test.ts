import { describe, it, expect } from "vitest";
import {
  FIXED_AGENT_GOAL,
  AGENT_STATES,
  AGENT_TOOL_IDS,
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
  agentStatusSchema,
  agentToolIdSchema,
  encryptedWalletSecretSchema,
  agentCaseIdentitySchema,
  agentBudgetSchema,
  resolutionAgentPolicySchema,
  resolutionAgentToolRequestSchema,
} from "../types";

describe("Agent Goal", () => {
  it("goal is a fixed string", () => {
    expect(FIXED_AGENT_GOAL).toBe(
      "Prepare this payment case for fair human review.",
    );
  });

  it("goal is not free-form", () => {
    expect(typeof FIXED_AGENT_GOAL).toBe("string");
    expect(FIXED_AGENT_GOAL.length).toBeGreaterThan(0);
  });
});

describe("Agent States", () => {
  it("has exactly 15 states", () => {
    expect(AGENT_STATES).toHaveLength(15);
  });

  it("includes draft", () => {
    expect(AGENT_STATES).toContain("draft");
  });

  it("includes active", () => {
    expect(AGENT_STATES).toContain("active");
  });

  it("includes ready_for_human_review", () => {
    expect(AGENT_STATES).toContain("ready_for_human_review");
  });

  it("includes closed as terminal", () => {
    expect(AGENT_STATES).toContain("closed");
  });

  it("does not include autonomous escrow settlement state", () => {
    const states = AGENT_STATES as readonly string[];
    expect(states).not.toContain("escrow_settled");
    expect(states).not.toContain("winner_selected");
    expect(states).not.toContain("funds_released");
    expect(states).not.toContain("dispute_resolved");
    expect(states).not.toContain("refund_initiated");
  });
});

describe("Tool IDs", () => {
  it("has exactly 3 V1 tools", () => {
    expect(AGENT_TOOL_IDS).toHaveLength(3);
  });

  it("includes evidence-quality-check", () => {
    expect(AGENT_TOOL_IDS).toContain("evidence-quality-check");
  });

  it("includes case-refresh", () => {
    expect(AGENT_TOOL_IDS).toContain("case-refresh");
  });

  it("includes reclaim-dispute-brief-v1", () => {
    expect(AGENT_TOOL_IDS).toContain("reclaim-dispute-brief-v1");
  });

  it("does not include refund-eligibility-scan", () => {
    expect(AGENT_TOOL_IDS).not.toContain("refund-eligibility-scan");
  });
});

describe("Canonical Config Values", () => {
  it("facilitator network is Celo Mainnet", () => {
    expect(AGENT_FACILITATOR_NETWORK).toBe("eip155:42220");
  });

  it("mainnet USDC address is canonical", () => {
    expect(AGENT_MAINNET_USDC_ADDRESS).toBe(
      "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    );
  });

  it("payTo address is registered Track 2 wallet", () => {
    expect(AGENT_PAY_TO_ADDRESS).toBe(
      "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    );
  });
});

describe("Zod Schemas", () => {
  it("validates correct status", () => {
    expect(agentStatusSchema.parse("active")).toBe("active");
  });

  it("rejects invalid status", () => {
    expect(() => agentStatusSchema.parse("flying")).toThrow();
  });

  it("validates correct tool id", () => {
    expect(agentToolIdSchema.parse("evidence-quality-check")).toBe(
      "evidence-quality-check",
    );
  });

  it("rejects invalid tool id", () => {
    expect(() => agentToolIdSchema.parse("arbitrary-tool")).toThrow();
  });

  it("validates encrypted wallet secret", () => {
    const secret = {
      _brand: "EncryptedWalletSecret" as const,
      ciphertext: "abc123",
      iv: "def456",
      tag: "ghi789",
    };
    expect(encryptedWalletSecretSchema.parse(secret)).toEqual(secret);
  });

  it("validates case identity", () => {
    const identity = {
      escrowPaymentId: "pay_1",
      escrowChainId: "eip155:42220",
      escrowContractAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    };
    expect(agentCaseIdentitySchema.parse(identity)).toEqual(identity);
  });

  it("rejects invalid hex address in case identity", () => {
    expect(() =>
      agentCaseIdentitySchema.parse({
        escrowPaymentId: "pay_1",
        escrowChainId: "eip155:42220",
        escrowContractAddress: "not-a-hex-address",
      }),
    ).toThrow();
  });

  it("validates budget with bigint fields", () => {
    const budget = {
      approvedAtomic: 1000000n,
      spentAtomic: 0n,
      reservedAtomic: 0n,
    };
    expect(agentBudgetSchema.parse(budget)).toEqual(budget);
  });

  it("validates policy", () => {
    const policy = {
      allowedTools: ["evidence-quality-check", "case-refresh"],
      approvedBudgetAtomic: 1000000n,
      expiresAt: 9999999999,
      funderAddress: "0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA",
    };
    expect(resolutionAgentPolicySchema.parse(policy)).toEqual(policy);
  });

  it("validates tool request", () => {
    const request = {
      toolId: "evidence-quality-check" as const,
      priceAtomic: 10000n,
      network: "eip155:42220",
      asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      payTo: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      caseVersionHash: "0xabcdef",
      evidenceVersionHash: "0x123456",
    };
    expect(resolutionAgentToolRequestSchema.parse(request)).toEqual(request);
  });
});
