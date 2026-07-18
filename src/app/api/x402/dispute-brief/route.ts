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
import { createPublicClient, http, decodeEventLog, parseAbi } from "viem";
import { celoSepolia } from "viem/chains";
import {
  canProcessPayments,
  validatePayToAddress,
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_USDC_ADDRESS,
  getDisputeBriefPriceAtomic,
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
  recordSettlementReceipt,
  recordBrief,
  getAllEntries,
  findByTxHash,
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

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recovery helper — generates brief for an already-settled tx without charge
// ---------------------------------------------------------------------------

async function handleRecovery(
  recoveryTxHash: string,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<Response> {
  const txHash = recoveryTxHash as `0x${string}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({
      correlationId,
      error: "Invalid recoveryTxHash format. Must be a 0x-prefixed 64-char hex.",
    }, { status: 400 });
  }

  const disputeReason = typeof body.disputeReason === "string" ? body.disputeReason : "";
  const requestedOutcome = typeof body.requestedOutcome === "string" ? body.requestedOutcome : "";
  const escrowPaymentIdStr = typeof body.paymentId === "string" ? body.paymentId : "1";

  if (!disputeReason || !requestedOutcome) {
    return NextResponse.json({
      correlationId,
      error: "Recovery requires disputeReason and requestedOutcome fields.",
    }, { status: 400 });
  }

  // Verify the settlement transaction on-chain
  const rpcUrl =
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org";

  try {
    const client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl),
    });

    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== "success") {
      return NextResponse.json({
        correlationId,
        error: `Transaction ${txHash} not found or not successful on-chain.`,
      }, { status: 404 });
    }

    // Verify this is a USDC Transfer event from buyer to payTo
    const payTo = X402_PAY_TO_ADDRESS;
    const usdcAddr = X402_USDC_ADDRESS;
    const expectedAmount = getDisputeBriefPriceAtomic();

    const erc20EventABI = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]);

    let verified = false;
    let verifiedFrom = "";
    let verifiedTo = "";
    let verifiedAmount = "0";

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== usdcAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: erc20EventABI,
          data: log.data,
          topics: log.topics,
          eventName: "Transfer",
        });
        const args = decoded.args as { from: string; to: string; value: bigint };
        if (
          args.from.toLowerCase() === "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486" &&
          args.to.toLowerCase() === payTo.toLowerCase() &&
          args.value === expectedAmount
        ) {
          verified = true;
          verifiedFrom = args.from;
          verifiedTo = args.to;
          verifiedAmount = args.value.toString();
          break;
        }
      } catch {
        continue;
      }
    }

    if (!verified) {
      return NextResponse.json({
        correlationId,
        error: `Transaction ${txHash} is confirmed but does NOT contain a matching USDC Transfer from buyer to payTo for the required amount.`,
      }, { status: 422 });
    }

    // Read on-chain payment data
    let escrowPaymentId: bigint;
    try {
      escrowPaymentId = BigInt(escrowPaymentIdStr);
    } catch {
      return NextResponse.json({
        correlationId,
        error: "Invalid escrow paymentId.",
      }, { status: 400 });
    }

    const escrowAddress = getEscrowContractAddress(11142220);
    if (!escrowAddress) {
      return NextResponse.json({
        correlationId,
        error: "Escrow contract address not configured.",
      }, { status: 500 });
    }

    const raw = (await client.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [escrowPaymentId],
    })) as unknown as RawPaymentStruct;

    const paymentData = parsePaymentData(raw);

    // Build the dispute request for brief generation
    const disputeRequest = {
      paymentId: escrowPaymentIdStr,
      disputeReason,
      requestedOutcome,
      agreementTitle: paymentData.agreementLabel || "",
      clientAddress: paymentData.client,
      workerAddress: paymentData.worker,
      protectedAmount: `${paymentData.amount.toString()}`,
      currentPaymentState: paymentData.state,
      agreedDeliverables: paymentData.deliverableSummary || "",
      deadline: "",
      releaseTerms: paymentData.releaseRule || "",
      evidenceReferences: [],
    };

    const brief = generateDisputeBrief(disputeRequest, paymentData);

    return NextResponse.json({
      correlationId,
      recovery: true,
      verifiedTxHash: txHash,
      verifiedAmount,
      verifiedFrom,
      verifiedTo,
      brief,
      settlement: {
        txHash,
        blockNumber: Number(receipt.blockNumber),
        from: verifiedFrom,
        to: verifiedTo,
        amount: verifiedAmount,
        tokenAddress: usdcAddr,
        status: "success",
      },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[x402][${correlationId}] Recovery error: ${message}`);
    return NextResponse.json({
      correlationId,
      error: `Recovery verification failed: ${message}`,
    }, { status: 502 });
  }
}

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

  // --- Recovery mode: no payment header + recoveryTxHash in body ---
  if (!paymentSignatureHeader) {
    // Parse body early to check for recovery request
    let recoveryBody: Record<string, unknown> | null = null;
    try {
      recoveryBody = await request.clone().json();
    } catch {
      // Body not parseable — proceed to 402
    }

    if (recoveryBody && typeof recoveryBody.recoveryTxHash === "string") {
      return handleRecovery(
        recoveryBody.recoveryTxHash,
        recoveryBody,
        correlationId,
      );
    }

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
      `[x402][${correlationId}] Payment ${paymentId} already settled (${
        cachedResult.brief ? "with brief" : "without brief"
      }) — returning cached result.`,
    );
    const response: Record<string, unknown> = {
      correlationId,
      settlement: cachedResult.receipt,
    };
    if (cachedResult.brief) {
      response.brief = cachedResult.brief;
    } else {
      response.brief = null;
      response.recoveryNote =
        "Settlement confirmed but brief generation was deferred. " +
        "The service fee has been paid; the brief will be regenerated on retry.";
    }
    return NextResponse.json(response, {
      status: 200,
      headers: {
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: true,
          transaction: cachedResult.receipt.txHash,
          network: X402_NETWORK,
          payer: cachedResult.receipt.from,
        }),
        "X-Payment-Id": paymentId,
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

  // --- Step 10b: IMMEDIATELY persist the settlement receipt ---
  // Even if brief generation fails later, the settlement is recorded
  // and the buyer's payment is acknowledged. The brief can be recovered
  // or regenerated on a subsequent idempotent retry.
  recordSettlementReceipt(paymentId, settlementReceipt);

  // --- Step 11: Verify settlement receipt integrity ---
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
  // ONLY reached after confirmed on-chain settlement. If generation throws,
  // the settlement receipt is already saved — the brief can be recovered.
  let brief: ReturnType<typeof generateDisputeBrief>;
  try {
    brief = generateDisputeBrief(disputeRequest, paymentData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Brief generation failed after settled payment: ${message}`,
      err instanceof Error ? err.stack : "",
    );
    // Settlement receipt is already saved as paid_pending_brief.
    // Return settlement info — the brief can be regenerated on retry.
    return NextResponse.json(
      {
        correlationId,
        settlement: settlementReceipt,
        brief: null,
        error: `Brief generation deferred: ${message}. The service fee has been paid. Retry with the same payment ID to regenerate.`,
      },
      {
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
      },
    );
  }

  // --- Step 13: Attach brief to settlement and mark fully settled ---
  recordBrief(paymentId, brief);

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
// GET handler — idempotent recovery / inspection
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const txHash = url.searchParams.get("txHash");

  // Direct lookup by payment ID
  if (paymentId) {
    const result = getResult(paymentId);
    if (result) {
      return NextResponse.json({
        paymentId,
        status: result.brief ? "settled" : "paid_pending_brief",
        settlement: result.receipt,
        brief: result.brief ?? null,
        recoveryNote: result.brief
          ? undefined
          : "Settlement confirmed but brief was not generated. Submit a POST with the same payment-id header to regenerate the brief at no additional cost.",
      });
    }
    // Check if failed
    const err = getError(paymentId);
    if (err) {
      return NextResponse.json({
        paymentId,
        status: "failed",
        error: err,
      }, { status: 402 });
    }
    return NextResponse.json({
      error: `Payment identifier '${paymentId}' not found. It may have expired or never existed.`,
    }, { status: 404 });
  }

  // Search by transaction hash (recovery without payment ID)
  if (txHash) {
    const found = findByTxHash(txHash);
    if (found) {
      return NextResponse.json({
        paymentId: found.paymentId,
        status: found.record.status,
        settlement: found.record.receipt,
        brief: found.record.brief ?? null,
        recoveryNote: found.record.brief
          ? undefined
          : "Settlement confirmed but brief was not generated. Submit a POST with the same payment-id header to regenerate the brief at no additional cost.",
      });
    }
    return NextResponse.json({
      error: `No settlement found for transaction hash '${txHash}'. The store is in-memory and may have been lost on server restart.`,
    }, { status: 404 });
  }

  // List all entries (admin/debug)
  const entries: Record<string, { status: string; txHash?: string; error?: string; createdAt: number }> = {};
  for (const [id, record] of getAllEntries()) {
    entries[id] = {
      status: record.status,
      txHash: record.receipt?.txHash,
      error: record.error,
      createdAt: record.createdAt,
    };
  }
  return NextResponse.json({ count: Object.keys(entries).length, entries });
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
