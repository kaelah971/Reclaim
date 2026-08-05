import type {
  ResolutionAgentToolDefinition,
  ResolutionAgentToolId,
} from "./types";
import {
  AGENT_FACILITATOR_NETWORK,
  AGENT_MAINNET_USDC_ADDRESS,
  AGENT_PAY_TO_ADDRESS,
} from "./types";

// ---------------------------------------------------------------------------
// Canonical Tool Prices (atomic USDC units)
// $0.01 USDC × 10^6 = 10000 atomic units
// ---------------------------------------------------------------------------

export const EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC = 10000n as bigint;
export const CASE_REFRESH_PRICE_ATOMIC = 10000n as bigint;
export const DISPUTE_BRIEF_PRICE_ATOMIC = 10000n as bigint;

// ---------------------------------------------------------------------------
// V1 Tool Allowlist (exactly three tools)
// ---------------------------------------------------------------------------

export const V1_TOOLS: readonly ResolutionAgentToolDefinition[] = [
  {
    id: "evidence-quality-check",
    displayName: "Evidence Quality Check",
    priceAtomic: EVIDENCE_QUALITY_CHECK_PRICE_ATOMIC,
    network: AGENT_FACILITATOR_NETWORK,
    asset: AGENT_MAINNET_USDC_ADDRESS,
    payTo: AGENT_PAY_TO_ADDRESS,
    requiresMeaningfulChange: false,
    requiresEvidence: true,
    purpose:
      "Assess completeness, relevance, specificity, consistency, and review readiness.",
  },
  {
    id: "case-refresh",
    displayName: "Case Refresh",
    priceAtomic: CASE_REFRESH_PRICE_ATOMIC,
    network: AGENT_FACILITATOR_NETWORK,
    asset: AGENT_MAINNET_USDC_ADDRESS,
    payTo: AGENT_PAY_TO_ADDRESS,
    requiresMeaningfulChange: true,
    requiresEvidence: false,
    purpose:
      "Rebuild the case snapshot after meaningful evidence or payment-state changes and update the agent plan.",
  },
  {
    id: "reclaim-dispute-brief-v1",
    displayName: "Dispute Brief",
    priceAtomic: DISPUTE_BRIEF_PRICE_ATOMIC,
    network: AGENT_FACILITATOR_NETWORK,
    asset: AGENT_MAINNET_USDC_ADDRESS,
    payTo: AGENT_PAY_TO_ADDRESS,
    requiresMeaningfulChange: false,
    requiresEvidence: false,
    purpose:
      "Produce a neutral reviewer-ready case packet once the case is sufficiently complete.",
  },
] as const;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const toolMap = new Map<ResolutionAgentToolId, ResolutionAgentToolDefinition>();
for (const tool of V1_TOOLS) {
  toolMap.set(tool.id, tool);
}

export function getToolDefinition(
  id: ResolutionAgentToolId,
): ResolutionAgentToolDefinition | undefined {
  return toolMap.get(id);
}

export function isToolAllowlisted(id: string): id is ResolutionAgentToolId {
  return toolMap.has(id as ResolutionAgentToolId);
}

export function getAllowedToolIds(): ResolutionAgentToolId[] {
  return V1_TOOLS.map((t) => t.id);
}
