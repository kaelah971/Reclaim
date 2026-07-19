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
  isTxHashConsumed,
  consumeTxHash,
  findConsumedTx,
  setRequestHash,
  getRequestHash,
} from "@/lib/x402/paymentStore";
import { settlePayment } from "@/lib/x402/settlement";
import { findTransferEvents } from "@/lib/x402/settlement";
import { computeRequestHash, SERVICE_IDENTIFIER } from "@/lib/x402/requestHash";
import {
  verifyWalletSignature,
} from "@/lib/x402/walletAuth";

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

// ---------------------------------------------------------------------------
// Known settlement addresses for recovery binding
// ---------------------------------------------------------------------------

const KNOWN_SETTLEMENT_BUYER = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const KNOWN_SETTLEMENT_PAY_TO = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";
const PERMIT2_UNIVERSAL = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

async function handleRecovery(
  recoveryTxHash: string,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<Response> {
  const txHash = recoveryTxHash as `0x${string}`;

  // --- Step R1: Validate txHash format ---
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({
      correlationId,
      error: "Invalid recoveryTxHash format. Must be a 0x-prefixed 64-char hex.",
    }, { status: 400 });
  }

  // --- Step R2: Validate required fields ---
  const disputeReason = typeof body.disputeReason === "string" ? body.disputeReason : "";
  const requestedOutcome = typeof body.requestedOutcome === "string" ? body.requestedOutcome : "";
  const escrowPaymentIdStr = typeof body.paymentId === "string" ? body.paymentId : "";

  if (!disputeReason || !requestedOutcome || !escrowPaymentIdStr) {
    return NextResponse.json({
      correlationId,
      error: "Recovery requires disputeReason, requestedOutcome, and paymentId fields.",
    }, { status: 400 });
  }

  // --- Step R3: Wallet authentication ---
  const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress : "";
  const signedMessage = typeof body.signedMessage === "string" ? body.signedMessage : "";
  const walletSignature = typeof body.walletSignature === "string" ? body.walletSignature : "";

  if (!walletAddress || !signedMessage || !walletSignature) {
    return NextResponse.json({
      correlationId,
      error: "Recovery requires walletAddress, signedMessage, and walletSignature for payer authentication.",
    }, { status: 401 });
  }

  const authResult = await verifyWalletSignature(walletAddress, signedMessage, walletSignature);
  if (!authResult.verified) {
    return NextResponse.json({
      correlationId,
      error: `Wallet authentication failed: ${authResult.error}`,
    }, { status: 401 });
  }

  // --- Step R4: Verify txHash on-chain (strict) ---
  const rpcUrl =
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org";

  let receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>["getTransactionReceipt"]>>;

  try {
    const client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl),
    });

    receipt = await client.getTransactionReceipt({ hash: txHash });

    const txDetail = await client.getTransaction({ hash: txHash });
    if (txDetail) {
      const isPermit2 = txDetail.to?.toLowerCase() === PERMIT2_UNIVERSAL.toLowerCase();
      console.log(
        `[x402][${correlationId}] Recovery tx chainId=${txDetail.chainId ?? "?"}, ` +
        `to=${txDetail.to ?? "?"}, isPermit2=${isPermit2}`,
      );
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[x402][${correlationId}] Recovery RPC error: ${message}`);
    return NextResponse.json({
      correlationId,
      error: `Failed to verify transaction on-chain: ${message}`,
    }, { status: 502 });
  }

  if (!receipt || receipt.status !== "success") {
    return NextResponse.json({
      correlationId,
      error: `Transaction ${txHash} not found or not successful on-chain.`,
    }, { status: 404 });
  }

  // --- Step R5: Verify exact USDC Transfer event ---
  const payTo = X402_PAY_TO_ADDRESS || KNOWN_SETTLEMENT_PAY_TO;
  const usdcAddr = X402_USDC_ADDRESS;
  const expectedAmount = getDisputeBriefPriceAtomic();

  const matchingTransfers = findTransferEvents(
    receipt.logs,
    usdcAddr as `0x${string}`,
    walletAddress as `0x${string}`,
    payTo as `0x${string}`,
    expectedAmount,
  );

  if (matchingTransfers.length === 0) {
    return NextResponse.json({
      correlationId,
      error: `Transaction ${txHash} does NOT contain a USDC Transfer from ${walletAddress} to ${payTo} for ${expectedAmount} atomic units.`,
    }, { status: 422 });
  }

  if (matchingTransfers.length > 1) {
    return NextResponse.json({
      correlationId,
      error: `Transaction ${txHash} contains ${matchingTransfers.length} matching USDC Transfer events. Expected exactly one.`,
    }, { status: 422 });
  }

  const transfer = matchingTransfers[0];
  const verifiedFrom = transfer.from;
  const verifiedTo = transfer.to;
  const verifiedAmount = transfer.value.toString();

  // --- Step R6: Replay protection ---
  if (isTxHashConsumed(txHash)) {
    const consumed = findConsumedTx(txHash);
    return NextResponse.json({
      correlationId,
      error: `Transaction ${txHash} has already been consumed for recovery (payment ${consumed?.paymentId}, at ${consumed?.consumedAt}). This transaction cannot be reused.`,
    }, { status: 409 });
  }

  // --- Step R7: Determine paid_pending_brief or legacy ---
  const existingRecord = findByTxHash(txHash);

  let escrowPaymentId: bigint;
  try {
    escrowPaymentId = BigInt(escrowPaymentIdStr);
  } catch {
    return NextResponse.json({
      correlationId,
      error: "Invalid escrow paymentId.",
    }, { status: 400 });
  }

  if (existingRecord && existingRecord.record.status === "paid_pending_brief") {
    // =================================================================
    // PAID_PENDING_BRIEF RECOVERY — strict request-hash binding
    // =================================================================

    const existingPaymentId = existingRecord.paymentId;

    if (existingPaymentId !== escrowPaymentIdStr) {
      return NextResponse.json({
        correlationId,
        error: `Payment ID mismatch: transaction ${txHash} is bound to payment '${existingPaymentId}', not '${escrowPaymentIdStr}'.`,
      }, { status: 409 });
    }

    const storedHash = getRequestHash(escrowPaymentIdStr);
    if (storedHash) {
      const computedHash = computeRequestHash({
        paymentId: escrowPaymentIdStr,
        disputeReason,
        requestedOutcome,
        buyerAddress: verifiedFrom,
        network: X402_NETWORK,
        serviceIdentifier: SERVICE_IDENTIFIER,
        price: expectedAmount.toString(),
        payToAddress: verifiedTo,
      });

      if (computedHash !== storedHash) {
        return NextResponse.json({
          correlationId,
          error: "Request hash mismatch. The submitted dispute details differ from the original settlement request. The brief cannot be regenerated with different details.",
        }, { status: 409 });
      }
    }

    // Consume txHash so it cannot be reused
    consumeTxHash(txHash, escrowPaymentIdStr, {
      recoveredPayer: verifiedFrom,
      recoveredRequestHash: storedHash,
    });

    // Read on-chain payment data
    const escrowAddress = getEscrowContractAddress(11142220);
    if (!escrowAddress) {
      return NextResponse.json({
        correlationId,
        error: "Escrow contract address not configured.",
      }, { status: 500 });
    }

    let raw: RawPaymentStruct;
    try {
      const client = createPublicClient({
        chain: celoSepolia,
        transport: http(rpcUrl),
      });
      raw = (await client.readContract({
        address: escrowAddress,
        abi: protectedPaymentEscrowABI,
        functionName: "getPayment",
        args: [escrowPaymentId],
      })) as unknown as RawPaymentStruct;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown RPC error";
      return NextResponse.json({
        correlationId,
        error: `Failed to read payment data: ${message}`,
      }, { status: 502 });
    }

    const paymentData = parsePaymentData(raw);
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
    recordBrief(escrowPaymentIdStr, brief);

    return NextResponse.json({
      correlationId,
      recovery: true,
      mode: "paid_pending_brief",
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
  }

  // ===================================================================
  // LEGACY RECOVERY — one-time only, Payment #1, consumed forever
  // ===================================================================

  if (escrowPaymentIdStr !== "1") {
    return NextResponse.json({
      correlationId,
      error: "Historical recovery is only available for Payment #1. The original request hash was lost for this transaction.",
    }, { status: 422 });
  }

  if (verifiedFrom.toLowerCase() !== KNOWN_SETTLEMENT_BUYER.toLowerCase()) {
    return NextResponse.json({
      correlationId,
      error: `Historical recovery: transaction payer ${verifiedFrom} does not match the expected buyer ${KNOWN_SETTLEMENT_BUYER}.`,
    }, { status: 403 });
  }

  // Mark txHash as consumed — legacy, one-time only
  consumeTxHash(txHash, "1", {
    legacyRecovery: true,
    recoveredPayer: verifiedFrom,
  });

  // Read on-chain payment data
  const escrowAddress = getEscrowContractAddress(11142220);
  if (!escrowAddress) {
    return NextResponse.json({
      correlationId,
      error: "Escrow contract address not configured.",
    }, { status: 500 });
  }

  let raw: RawPaymentStruct;
  try {
    const client = createPublicClient({
      chain: celoSepolia,
      transport: http(rpcUrl),
    });
    raw = (await client.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [escrowPaymentId],
    })) as unknown as RawPaymentStruct;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown RPC error";
    return NextResponse.json({
      correlationId,
      error: `Failed to read payment data: ${message}`,
    }, { status: 502 });
  }

  const paymentData = parsePaymentData(raw);

  const disputeRequest = {
    paymentId: "1",
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
    mode: "legacy",
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

  // --- Step 6b: Compute and persist the canonical request hash ---
  // This binds the dispute details to the buyer before settlement, so
  // recovery can verify that the same details are used as originally paid.
  const computedRequestHash = computeRequestHash({
    paymentId: disputeRequest.paymentId,
    disputeReason: disputeRequest.disputeReason,
    requestedOutcome: disputeRequest.requestedOutcome,
    buyerAddress: paymentPayload.payment.from,
    network: X402_NETWORK,
    serviceIdentifier: SERVICE_IDENTIFIER,
    price: paymentPayload.payment.amount,
    payToAddress: X402_PAY_TO_ADDRESS,
  });
  setRequestHash(paymentId, computedRequestHash);

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

// ---------------------------------------------------------------------------
// GET handler — idempotent recovery / inspection
//
// txHash query (no wallet auth) → public settlement status only (NO brief)
// txHash query + valid wallet auth → full brief (authenticated payer)
// paymentId query → full result (paymentId is a secret UUID)
// ---------------------------------------------------------------------------

async function authenticateWalletFromHeaders(
  request: Request,
  requiredPayer: string,
): Promise<boolean> {
  const walletAddress = request.headers.get("x-wallet-address") || "";
  const signedMessage = request.headers.get("x-wallet-message") || "";
  const walletSignature = request.headers.get("x-wallet-signature") || "";

  if (!walletAddress || !signedMessage || !walletSignature) return false;
  if (walletAddress.toLowerCase() !== requiredPayer.toLowerCase()) return false;

  const authResult = await verifyWalletSignature(walletAddress, signedMessage, walletSignature);
  return authResult.verified;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const txHash = url.searchParams.get("txHash");

  // Direct lookup by payment ID (UUID — not public, implicitly authenticated)
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

  // Search by transaction hash — security-restricted
  if (txHash) {
    const found = findByTxHash(txHash);
    const consumed = findConsumedTx(txHash);

    if (found) {
      const payer = found.record.receipt?.from;
      const isAuthenticated = payer
        ? await authenticateWalletFromHeaders(request, payer)
        : false;

      if (isAuthenticated) {
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

      // Unauthenticated — return public info only
      return NextResponse.json({
        txHash,
        publicSettlement: {
          status: found.record.status,
          txHash: found.record.receipt?.txHash,
          blockNumber: found.record.receipt?.blockNumber
            ? Number(found.record.receipt.blockNumber)
            : null,
          from: found.record.receipt?.from,
          to: found.record.receipt?.to,
          amount: found.record.receipt?.amount,
          tokenAddress: found.record.receipt?.tokenAddress,
          settledAt: found.record.createdAt,
        },
        consumedTx: consumed
          ? { consumedAt: consumed.consumedAt, legacyRecovery: consumed.legacyRecovery }
          : null,
        authRequired: "Authenticate with X-Wallet-Address, X-Wallet-Message, and X-Wallet-Signature headers to retrieve the full brief.",
      });
    }

    // Not in store — return what public info we have
    return NextResponse.json({
      txHash,
      error: `No settlement record found for transaction hash '${txHash}'. The store is in-memory and may have been lost on server restart.`,
      consumedTx: consumed
        ? { consumedAt: consumed.consumedAt, legacyRecovery: consumed.legacyRecovery }
        : null,
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
