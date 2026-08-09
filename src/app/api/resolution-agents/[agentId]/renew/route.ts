// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/renew
//
// Explicitly renews the policy expiry of an EXISTING resolution agent.
// Only the original funder may renew, and the new expiry must be strictly
// later than the current expiry (renewal only extends — never shrinks) and
// in the future. Policies are NEVER auto-renewed; this signed action is the
// only renewal path.
//
// Everything else is preserved unchanged: agent id, case wallet, approved
// budget, spent/reserved accounting, payment binding, allowed tools.
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the canonical renew-policy message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// Body (JSON):
//   expiresAt — new policy expiry as epoch-ms string
//
// Responses:
//   200 — policy renewed, returns ResolutionAgentPublicView
//   400 — invalid body / message binding / expiry not a strict extension
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder / status not renewable
//   404 — agent not found
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import {
  createStore,
  renewResolutionAgentPolicy,
} from "@/lib/resolution-agent/api/service";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";
import { renewPolicyRequestSchema } from "@/lib/resolution-agent/api/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(request.headers);

    if (!walletAddress || !signedMessage || !walletSignature) {
      return NextResponse.json(
        { error: "Wallet authentication required.", code: "MISSING_WALLET_HEADERS" },
        { status: 401 },
      );
    }

    const authResult = await verifyAuth({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        { error: `Wallet signature verification failed: ${authResult.error}`, code: "SIGNATURE_INVALID" },
        { status: 401 },
      );
    }

    if (!signedMessage.includes(agentId)) {
      return NextResponse.json(
        { error: `Renew-policy message must contain the agent ID "${agentId}".`, code: "MESSAGE_AGENT_ID_MISMATCH" },
        { status: 400 },
      );
    }

    if (!signedMessage.includes("renew_resolution_agent_policy")) {
      return NextResponse.json(
        { error: "Signed message must bind to the renew_resolution_agent_policy action.", code: "MESSAGE_ACTION_MISMATCH" },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const parseResult = renewPolicyRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Request body validation failed.",
          code: "VALIDATION_ERROR",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const store = createStore();
    const now = Date.now();
    const newExpiresAt = Number(parseResult.data.expiresAt);

    const publicView = await renewResolutionAgentPolicy({
      agentId,
      authenticatedCaller: walletAddress,
      newExpiresAt,
      now,
      store,
    });

    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
