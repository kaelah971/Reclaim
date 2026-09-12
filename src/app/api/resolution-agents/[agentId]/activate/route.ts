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
import {
  authorizeWalletRequest,
  EMPTY_BODY_HASH,
  requestHasUnexpectedBody,
} from "@/lib/resolution-agent/api/auth";
import { activateResolutionAgent, createStore } from "@/lib/resolution-agent/api/service";
import {
  CeloSepoliaEscrowCaseReader,
  CANONICAL_ESCROW_CHAIN_ID,
  CANONICAL_ESCROW_CONTRACT_ADDRESS,
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

    if (await requestHasUnexpectedBody(request)) {
      return NextResponse.json(
        { error: "This route does not accept a request body.", code: "BODY_NOT_ALLOWED" },
        { status: 400 },
      );
    }

    const store = createStore();
    const agent = await store.getAgentById(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: "Resolution agent not found.", code: "AGENT_NOT_FOUND" },
        { status: 404 },
      );
    }

    const authResult = await authorizeWalletRequest({
      claimedAddress: walletAddress,
      message: signedMessage,
      signature: walletSignature,
      expected: {
        action: "activate_resolution_agent",
        agentId: agent.id,
        escrowChainId: `eip155:${CANONICAL_ESCROW_CHAIN_ID}`,
        escrowContractAddress: CANONICAL_ESCROW_CONTRACT_ADDRESS,
        escrowPaymentId: agent.identity.escrowPaymentId,
        bodyHash: EMPTY_BODY_HASH,
        signerAddress: agent.policy.funderAddress,
        fields: {
          Goal: agent.goal,
          "Approved Budget (atomic USDC)": agent.policy.approvedBudgetAtomic.toString(),
          "Refund Address": agent.policy.funderAddress,
          "Allowed Tools": agent.policy.allowedTools.join(","),
          "Policy Version": "v1",
          "Agent Expiry": String(agent.policy.expiresAt),
          "Funder Address": agent.policy.funderAddress,
        },
      },
      nonceStore: store,
    });

    if (!authResult.verified) {
      return NextResponse.json(
        {
          error: `Wallet authorization failed: ${authResult.error}`,
          code: authResult.code,
        },
        {
          status:
            authResult.code.startsWith("MESSAGE_") &&
            authResult.code !== "MESSAGE_SIGNER_MISMATCH"
              ? 400
              : authResult.code === "MESSAGE_SIGNER_MISMATCH"
                ? 403
                : 401,
        },
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
