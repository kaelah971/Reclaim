import { describe, it, expect } from "vitest";
import {
  V1_TOOLS,
  getToolDefinition,
  isToolAllowlisted,
  getAllowedToolIds,
  EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC,
  CASE_REFRESH_PRICE_ATOMIC,
  DISPUTE_BRIEF_PRICE_ATOMIC,
} from "../tools";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
} from "../types";

describe("Tool Allowlist", () => {
  it("has exactly 3 tools", () => {
    expect(V1_TOOLS).toHaveLength(3);
  });

  it("evidence-quality-check has correct canonical values", () => {
    const tool = getToolDefinition("evidence-quality-check");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("evidence-quality-check");
    expect(tool!.priceAtomic).toBe(10000n);
    expect(tool!.network).toBe(AGENT_FACILITATOR_NETWORK);
    expect(tool!.asset).toBe(AGENT_MAINNET_USDC_ADDRESS);
    expect(tool!.payTo).toBe(AGENT_PAY_TO_ADDRESS);
    expect(tool!.requiresEvidence).toBe(true);
    expect(tool!.requiresMeaningfulChange).toBe(false);
  });

  it("case-refresh has correct canonical values", () => {
    const tool = getToolDefinition("case-refresh");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("case-refresh");
    expect(tool!.priceAtomic).toBe(10000n);
    expect(tool!.network).toBe(AGENT_FACILITATOR_NETWORK);
    expect(tool!.asset).toBe(AGENT_MAINNET_USDC_ADDRESS);
    expect(tool!.payTo).toBe(AGENT_PAY_TO_ADDRESS);
    expect(tool!.requiresMeaningfulChange).toBe(true);
    expect(tool!.requiresEvidence).toBe(false);
  });

  it("reclaim-dispute-brief-v1 has correct canonical values", () => {
    const tool = getToolDefinition("reclaim-dispute-brief-v1");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("reclaim-dispute-brief-v1");
    expect(tool!.priceAtomic).toBe(10000n);
    expect(tool!.network).toBe(AGENT_FACILITATOR_NETWORK);
    expect(tool!.asset).toBe(AGENT_MAINNET_USDC_ADDRESS);
    expect(tool!.payTo).toBe(AGENT_PAY_TO_ADDRESS);
    expect(tool!.requiresMeaningfulChange).toBe(false);
    expect(tool!.requiresEvidence).toBe(false);
  });

  it("all prices are 10000 atomic units (0.01 USDC with 6 decimals)", () => {
    expect(EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC).toBe(10000n);
    expect(CASE_REFRESH_PRICE_ATOMIC).toBe(10000n);
    expect(DISPUTE_BRIEF_PRICE_ATOMIC).toBe(10000n);
  });

  it("arbitrary tool identifier is rejected", () => {
    expect(isToolAllowlisted("evil-tool")).toBe(false);
  });

  it("all ids in allowlist match canonical tool definition ids", () => {
    const ids = getAllowedToolIds();
    for (const id of ids) {
      const def = getToolDefinition(id);
      expect(def).toBeDefined();
      expect(def!.id).toBe(id);
    }
  });

  it("all tools use Celo Mainnet facilitator network", () => {
    for (const tool of V1_TOOLS) {
      expect(tool.network).toBe("eip155:42220");
    }
  });

  it("all tools use canonical mainnet USDC address", () => {
    for (const tool of V1_TOOLS) {
      expect(tool.asset).toBe(
        "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      );
    }
  });

  it("all tools use registered payTo wallet", () => {
    for (const tool of V1_TOOLS) {
      expect(tool.payTo).toBe(
        "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
      );
    }
  });

  it("altered tool price should differ from canonical definition", () => {
    const tool = getToolDefinition("evidence-quality-check");
    expect(tool!.priceAtomic).not.toBe(999999n);
  });

  it("altered payTo would differ from canonical definition", () => {
    const tool = getToolDefinition("evidence-quality-check");
    expect(tool!.payTo).not.toBe(
      "0x0000000000000000000000000000000000000001",
    );
  });

  it("altered network would differ from canonical definition", () => {
    const tool = getToolDefinition("evidence-quality-check");
    expect(tool!.network).not.toBe("eip155:1");
  });

  it("altered asset would differ from canonical definition", () => {
    const tool = getToolDefinition("evidence-quality-check");
    expect(tool!.asset).not.toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });
});
