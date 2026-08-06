// ---------------------------------------------------------------------------
// POST /api/resolution-agents/[agentId]/activate
//
// Activate a Resolution Agent so it can begin executing tools autonomously.
// The caller MUST be the original funder.  The signed activation message is
// verified against the agent's canonical permissions to prevent signature
// reuse (CRITICAL HARDENING).
//
// Headers:
//   x-wallet-address   — funder's EVM address
//   x-wallet-message   — the plaintext activation message that was signed
//   x-wallet-signature — hex-encoded ECDSA signature
//
// The activation message (in x-wallet-message) must include ALL agent
// permissions (tools, budget, expiry, goal, refund address) so the server
// can verify it byte-for-byte against the agent's stored state.  Use
// buildActivationMessage() from @/lib/resolution-agent/api/auth to
// produce the canonical message format.
//
// Responses:
//   200 — activated, returns ResolutionAgentPublicView
//   401 — missing or invalid wallet authentication
//   403 — caller is not the funder OR message doesn't match canonical permissions
//   404 — agent not found
//   422 — agent cannot be activated (wrong status)
//   500 — internal server error
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/resolution-agent/api/auth";
import { activateResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
} from "@/lib/resolution-agent/api/escrow-reader";
import { extractWalletAuthHeaders } from "@/lib/x402/walletAuth";
import { toErrorResponse } from "@/lib/resolution-agent/api/errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { agentId } = await params;

    // -----------------------------------------------------------------
    // Step 1: Extract and verify wallet auth headers
    // -----------------------------------------------------------------
    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(request.headers);

    if (!walletAddress || !signedMessage || !walletSignature) {
      return NextResponse.json(
        {
          error:
            "Wallet authentication required. Provide x-wallet-address, x-wallet-message, and x-wallet-signature headers.",
          code: "MISSING_WALLET_HEADERS",
        },
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
        {
          error: `Wallet signature verification failed: ${authResult.error}`,
          code: "SIGNATURE_INVALID",
        },
        { status: 401 },
      );
    }

    // -----------------------------------------------------------------
    // Step 2: Verify the signed message contains this agent ID
    //         (prevents signing a message intended for a different agent)
    // -----------------------------------------------------------------
    if (!signedMessage.includes(agentId)) {
      return NextResponse.json(
        {
          error:
            "Activation message must contain the agent ID to prove intent. " +
            `Expected agent ID "${agentId}" in the signed message.`,
          code: "MESSAGE_AGENT_ID_MISMATCH",
        },
        { status: 400 },
      );
    }

    // -----------------------------------------------------------------
    // Step 3: Activate the agent via the service layer
    //         (the service enforces funder-only access, verifies the
    //         signed activation message against the agent's canonical
    //         permissions, validates the current status, and handles
    //         the state transition)
    // -----------------------------------------------------------------
    const escrowReader = new CeloSepoliaEscrowCaseReader();
    const store = createStore();
    const now = Date.now();

    const publicView = await activateResolutionAgent({
      agentId,
      authenticatedCaller: walletAddress,
      now,
      store,
      escrowReader,
      signedMessage,
    });

    // -----------------------------------------------------------------
    // Step 4: Return updated public view
    // -----------------------------------------------------------------
    return NextResponse.json(publicView, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, correlationId);
  }
}
