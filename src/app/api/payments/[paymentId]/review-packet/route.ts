// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/review-packet
//
// Public-safe, read-only: returns the latest durable human-review packet
// (the resolution agent's review_packet_prepared event) for the given
// escrow payment. All content is case data already public to the parties;
// no secrets, private keys, or internal state are exposed.
//
// Response:
//   200 { found: true,  agentId, packetEventId, packet } — packet metadata
//   200 { found: false }                                  — no packet yet
//   400 — invalid payment id
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { SupabaseResolutionAgentStore } from "@/lib/resolution-agent/store/supabase";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  CeloEscrowCaseReader,
  CeloSepoliaEscrowCaseReader,
} from "@/lib/resolution-agent/api/escrow-reader";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  isSupportedChain,
} from "@/lib/web3/chains";

const PACKET_EVENT_TYPE = "review_packet_prepared";

/**
 * Resolve an explicit chainId (?chainId=). Defaults to Celo Sepolia to
 * preserve behavior. Validated against the canonical supported-chain mapping.
 */
function resolveReviewPacketChainId(request: NextRequest): number | null {
  let raw: string | null = null;
  try {
    const url = new URL(request.url);
    raw =
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId");
  } catch {
    raw = null;
  }
  if (raw === null || raw.trim() === "") return CELO_CHAIN_ID;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (!isSupportedChain(parsed)) return null;
  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
    if (!paymentId || !/^\d+$/.test(paymentId)) {
      return NextResponse.json(
        { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    const store = new SupabaseResolutionAgentStore();
    // Chain-aware escrow identity (Sepolia default preserves behavior;
    // ?chainId=42220 binds to the canonical Mainnet escrow).
    const chainId = resolveReviewPacketChainId(request);
    if (chainId === null) {
      return NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      );
    }
    const escrowReader =
      chainId === CELO_MAINNET_CHAIN_ID
        ? new CeloEscrowCaseReader(
            chainId,
            process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL,
          )
        : new CeloSepoliaEscrowCaseReader(
            process.env.CELO_SEPOLIA_RPC_URL,
          );

    const agent = await store.getAgentByCaseIdentity(
      String(escrowReader.chainId),
      escrowReader.contractAddress,
      paymentId,
    );

    if (!agent) {
      return NextResponse.json({ found: false, paymentId }, { status: 200 });
    }

    // Latest durable review packet event for this agent.
    const supabase = getSupabaseClient();
    const { data: events } = await supabase
      .from("resolution_agent_events")
      .select("id, created_at, metadata, reason")
      .eq("agent_id", agent.id)
      .eq("event_type", PACKET_EVENT_TYPE)
      .order("created_at", { ascending: false })
      .limit(1);

    const latest = Array.isArray(events) && events.length > 0 ? events[0] : null;
    if (!latest) {
      return NextResponse.json({ found: false, paymentId, agentId: agent.id }, { status: 200 });
    }

    const packet = (latest as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | null;

    return NextResponse.json(
      {
        found: true,
        paymentId,
        agentId: agent.id,
        packetEventId: (latest as Record<string, unknown>).id,
        packetCreatedAt: (latest as Record<string, unknown>).created_at,
        packet,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[review-packet]", err);
    return NextResponse.json(
      { error: "Failed to load the review packet.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
