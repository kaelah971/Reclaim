// ---------------------------------------------------------------------------
// POST /api/x402/dispute-brief
//
// x402 v2 payment-gated API endpoint with REAL on-chain settlement.
//
// Flow:
//  1. Client sends request WITHOUT payment → server returns 402 + requirements
//  2. Client pays (Permit2 signature), retries WITH PAYMENT-SIGNATURE header
//  3. Server verifies payment cryptographically via Celo facilitator /verify
//  4. Server executes on-chain USDC transfer via Permit2
//  5. Server waits for confirmed transaction receipt
//  6. ONLY AFTER confirmed settlement: generates dispute brief
//  7. Returns brief with PAYMENT-RESPONSE header containing real txHash
//
// CRITICAL RULES (never violated):
//  - NEVER return settlement success without a real confirmed on-chain tx
//  - NEVER fabricate a transaction hash
//  - NEVER deliver the paid brief before successful settlement
//  - NEVER allow payment to the escrow contract address
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celoSepolia } from "viem/chains";
import {
  canProcessPayments,
  validatePayToAddress,
  X402_NETWORK,
  generatePaymentId,
} from "@/lib/x402/config";
import { verifyPermit2Authorization } from "@/lib/x402/localVerify";
import { parseDisputeBriefRequest } from "@/lib/x402/validation";
import { generateDisputeBrief } from "@/lib/x402/disputeBrief";
import { RawPaymentStruct, parsePaymentData } from "@/lib/contracts/types";
import { getEscrowAddress as getEscrowContractAddress } from "@/lib/contracts/addresses";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import {
  SettlementReceipt,
  X402ErrorResponse,
  PaymentPayloadCustom,
  DisputeBriefResponse,
} from "@/lib/x402/types";
import {
  buildPaymentRequiredHeader,
  verifyPaymentPayload,
  encodePaymentResponseHeader,
} from "@/lib/x402/shared";
import {
  getResult,
  getError,
  recordPending,
  recordFailed,
  recordSettled,
} from "@/lib/x402/paymentStore";
import { settlePayment } from "@/lib/x402/settlement";

// ---------------------------------------------------------------------------
// Helper: build error response with correlation ID
// ---------------------------------------------------------------------------

function errorResponse(
  status: number,
  message: string,
  correlationId: string,
  details?: Record<string, string[]>,
): NextResponse {
  const body: X402ErrorResponse = {
    correlationId,
    status,
    error: message,
    details,
  };
  return NextResponse.json(body, { status });
}

// ---------------------------------------------------------------------------
// Helper: read on-chain payment data via viem public client
// ---------------------------------------------------------------------------

async function readOnChainPayment(
  paymentId: bigint,
  correlationId: string,
): Promise<RawPaymentStruct | null> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org";

  try {
    const client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl),
    });

    const escrowAddress = getEscrowContractAddress(11142220);
    if (!escrowAddress) {
      console.error(
        `[x402][${correlationId}] Escrow contract address not configured for chain 11142220`,
      );
      return null;
    }

    const raw = (await client.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [paymentId],
    })) as unknown as RawPaymentStruct;

    return raw;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown RPC error";
    if (message.includes("PaymentNotFound")) {
      return null;
    }
    console.error(
      `[x402][${correlationId}] Failed to read payment ${paymentId.toString()}: ${message}`,
    );
    throw new Error(`Failed to read on-chain payment: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Helper: decode PAYMENT-SIGNATURE header into custom payload
// ---------------------------------------------------------------------------

function decodePaymentSignature(
  header: string,
  correlationId: string,
): { success: true; payload: PaymentPayloadCustom } | { success: false; error: NextResponse } {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const payload = JSON.parse(decoded) as PaymentPayloadCustom;
    return { success: true, payload };
  } catch {
    return {
      success: false,
      error: NextResponse.json(
        {
          correlationId,
          status: 402,
          error: "Malformed PAYMENT-SIGNATURE header. Must be base64-encoded JSON.",
        },
        { status: 402 },
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    return await handlePaymentRequest(request, correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown internal error";
    console.error(
      `[x402][${correlationId}] Unhandled internal error: ${message}`,
      err instanceof Error ? err.stack : "",
    );
    return NextResponse.json(
      {
        correlationId,
        status: 500,
        error: `Internal server error: ${message}`,
      },
      { status: 500 },
    );
  }
}

async function handlePaymentRequest(
  request: Request,
  correlationId: string,
): Promise<Response> {

  // --- Step 0: Check server configuration ---
  if (!canProcessPayments()) {
    console.error(
      `[x402][${correlationId}] Server not configured: X402_PAY_TO_ADDRESS is unset.`,
    );
    return errorResponse(
      500,
      "x402 payment processing is not configured on this server.",
      correlationId,
    );
  }

  // Ensure payTo is not the escrow contract
  try {
    validatePayToAddress();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return errorResponse(500, message, correlationId);
  }

  // --- Step 1: Check for payment signature header ---
  const paymentSignatureHeader = request.headers.get("payment-signature");

  if (!paymentSignatureHeader) {
    // No payment — return 402 with requirements
    const paymentRequiredValue = buildPaymentRequiredHeader();
    return new NextResponse(
      JSON.stringify({
        correlationId,
        error:
          "Payment required. Include a PAYMENT-SIGNATURE header with your request.",
      }),
      {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": paymentRequiredValue,
        },
      },
    );
  }

  // --- Step 2: Decode the payment payload ---
  const decoded = decodePaymentSignature(paymentSignatureHeader, correlationId);
  if (!decoded.success) return decoded.error;

  const paymentPayload = decoded.payload;

  // --- Step 3: Structural validation of payment payload ---
  const verification = verifyPaymentPayload(paymentPayload);
  if (!verification.valid) {
    console.warn(
      `[x402][${correlationId}] Payment verification failed: ${verification.reason}`,
    );
    return NextResponse.json(
      {
        correlationId,
        status: 402,
        error: `Payment verification failed: ${verification.reason}`,
      },
      { status: 402 },
    );
  }

  // --- Step 4: Idempotency check via payment identifier ---
  // The client can send an X-Payment-Id header for idempotent retries.
  const paymentIdHeader = request.headers.get("x-payment-id");
  const paymentId = paymentIdHeader || generatePaymentId();

  // Check if this payment ID was already settled
  const cachedResult = getResult(paymentId);
  if (cachedResult) {
    console.log(
      `[x402][${correlationId}] Payment ${paymentId} already settled — returning cached brief.`,
    );
    const response: DisputeBriefResponse = {
      correlationId,
      brief: cachedResult.brief,
      settlement: cachedResult.receipt,
    };
    return NextResponse.json(response, {
      status: 200,
      headers: {
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: true,
          transaction: cachedResult.receipt.txHash,
          network: X402_NETWORK,
          payer: cachedResult.receipt.from,
        }),
      },
    });
  }

  // Check if this payment ID previously failed
  const previousError = getError(paymentId);
  if (previousError) {
    return errorResponse(
      402,
      `Payment ${paymentId} previously failed: ${previousError}. Generate a new payment.`,
      correlationId,
    );
  }

  // Mark as pending
  recordPending(paymentId);

  // --- Step 5: Cryptographic verification of the Permit2 authorization ---
  // The public Celo facilitator (api.x402.celo.org) only supports Celo
  // MAINNET (eip155:42220) — it returns `unsupported_scheme` for Celo
  // Sepolia. We therefore verify locally: EIP-712 signature recovery,
  // spender == relayer, deadline, buyer balance, Permit2 allowance, and
  // nonce-replay checks. Read-only — no funds move during verification.
  try {
    console.log(
      `[x402][${correlationId}] Verifying Permit2 authorization locally (network: ${X402_NETWORK})...`,
    );

    const verifyResult = await verifyPermit2Authorization(
      paymentPayload.payment,
    );

    if (!verifyResult.isValid) {
      const reason = verifyResult.invalidReason || "Unknown verification failure";
      console.warn(
        `[x402][${correlationId}] Payment verification failed: ${reason}`,
      );
      recordFailed(paymentId, `Verification failed: ${reason}`);
      return NextResponse.json(
        {
          correlationId,
          status: 402,
          error: `Payment verification failed: ${reason}`,
        },
        { status: 402 },
      );
    }

    console.log(
      `[x402][${correlationId}] Permit2 verification succeeded. Payer: ${verifyResult.payer || "unknown"}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Payment verification error: ${message}`,
    );
    recordFailed(paymentId, `Verification error: ${message}`);
    return errorResponse(
      502,
      `Payment verification service unavailable: ${message}`,
      correlationId,
    );
  }

  // --- Step 6: Parse and validate the request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    recordFailed(paymentId, "Malformed JSON body.");
    return errorResponse(400, "Malformed JSON body.", correlationId);
  }

  const parseResult = parseDisputeBriefRequest(body);
  if (!parseResult.success) {
    recordFailed(paymentId, "Request body validation failed.");
    return errorResponse(
      400,
      "Request body validation failed.",
      correlationId,
      parseResult.errors,
    );
  }

  const disputeRequest = parseResult.data;

  // --- Step 7: Convert paymentId to bigint ---
  let escrowPaymentId: bigint;
  try {
    escrowPaymentId = BigInt(disputeRequest.paymentId);
  } catch {
    recordFailed(paymentId, "Invalid escrow paymentId format.");
    return errorResponse(
      400,
      "Invalid paymentId format.",
      correlationId,
      { paymentId: ["Must be a valid numeric string"] },
    );
  }

  // --- Step 8: Read on-chain payment data ---
  let rawPayment: RawPaymentStruct;
  try {
    const result = await readOnChainPayment(escrowPaymentId, correlationId);
    if (!result) {
      recordFailed(paymentId, `Escrow payment #${escrowPaymentId} not found.`);
      return errorResponse(
        404,
        `Payment #${escrowPaymentId.toString()} not found on-chain.`,
        correlationId,
      );
    }
    rawPayment = result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    recordFailed(paymentId, `Failed to read payment data: ${message}`);
    return errorResponse(
      500,
      `Failed to read payment data: ${message}`,
      correlationId,
    );
  }

  const paymentData = parsePaymentData(rawPayment);

  // --- Step 9: Validate payment is in a disputable state ---
  const disputableStates = [
    "Funded",
    "Accepted",
    "DeliverySubmitted",
    "ReleaseRequested",
    "Disputed",
  ];
  if (!disputableStates.includes(paymentData.state)) {
    recordFailed(
      paymentId,
      `Payment state ${paymentData.state} is not disputable.`,
    );
    return errorResponse(
      422,
      `Payment #${escrowPaymentId.toString()} is in state "${paymentData.state}". ` +
        "A dispute brief can only be prepared for funded or active payments.",
      correlationId,
    );
  }

  // --- Step 10: REAL on-chain settlement ---
  // This is the critical step — funds must move on-chain before the brief
  // is delivered. Any failure here MUST NOT result in brief delivery.
  let settlementReceipt: SettlementReceipt;
  try {
    console.log(
      `[x402][${correlationId}] Executing on-chain settlement for ${paymentPayload.payment.amount} USDC...`,
    );

    settlementReceipt = await settlePayment(paymentPayload.payment);

    console.log(
      `[x402][${correlationId}] On-chain settlement confirmed: ${settlementReceipt.txHash} block ${settlementReceipt.blockNumber}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Settlement failed: ${message}`,
    );
    recordFailed(paymentId, `Settlement failed: ${message}`);
    return errorResponse(
      502,
      `Payment settlement failed: ${message}`,
      correlationId,
    );
  }

  // --- Step 11: Verify settlement receipt integrity ---
  // These checks are redundant with settlePayment() but serve as a
  // defense-in-depth measure before delivering the paid content.
  if (settlementReceipt.status !== "success") {
    recordFailed(paymentId, "Settlement receipt status is not success.");
    return errorResponse(
      502,
      "Settlement transaction did not succeed on-chain.",
      correlationId,
    );
  }

  if (!settlementReceipt.txHash || !settlementReceipt.blockNumber) {
    recordFailed(paymentId, "Settlement receipt missing txHash or blockNumber.");
    return errorResponse(
      502,
      "Settlement receipt is incomplete (missing txHash or blockNumber).",
      correlationId,
    );
  }

  // Verify the recipient is NOT the escrow contract
  const escrowAddr = getEscrowContractAddress(11142220);
  if (!escrowAddr) {
    recordFailed(paymentId, "Escrow contract address not configured — cannot verify recipient safety.");
    return errorResponse(
      500,
      "Escrow contract address is not configured. Settlement safety check failed.",
      correlationId,
    );
  }
  if (
    settlementReceipt.to.toLowerCase() === escrowAddr.toLowerCase()
  ) {
    recordFailed(
      paymentId,
      "Settlement paid the escrow contract — this is forbidden.",
    );
    return errorResponse(
      500,
      "CRITICAL: Settlement paid the escrow contract instead of the service wallet.",
      correlationId,
    );
  }

  // --- Step 12: Generate the dispute brief ---
  // ONLY reached after confirmed on-chain settlement.
  const brief = generateDisputeBrief(disputeRequest, paymentData);

  // --- Step 13: Store settlement result for idempotent retries ---
  recordSettled(paymentId, settlementReceipt, brief);

  // --- Step 14: Return the response ---
  const response: DisputeBriefResponse = {
    correlationId,
    brief,
    settlement: settlementReceipt,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "PAYMENT-RESPONSE": encodePaymentResponseHeader({
        success: true,
        transaction: settlementReceipt.txHash,
        network: X402_NETWORK,
        payer: settlementReceipt.from,
      }),
      "X-Payment-Id": paymentId,
    },
  });
}

// ---------------------------------------------------------------------------
// OPTIONS handler (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, PAYMENT-SIGNATURE, X-Payment-Id",
    },
  });
}
