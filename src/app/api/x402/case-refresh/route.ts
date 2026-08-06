// ---------------------------------------------------------------------------
// POST /api/x402/case-refresh
//
// x402 v2 payment-gated API endpoint for case refresh analysis.
//
// Flow:
//  1. Client sends request WITHOUT payment → server returns 402 + requirements
//  2. Client pays (Permit2/EIP-3009), retries WITH PAYMENT-SIGNATURE header
//  3. Server verifies payment cryptographically via settlement provider
//  4. Server settles payment on-chain (USDC transfer to service wallet)
//  5. Server generates case refresh (AI with fallback)
//  6. Returns result with PAYMENT-RESPONSE header
//
// CRITICAL RULES:
//  - NEVER return settlement success without a real confirmed on-chain tx
//  - NEVER fabricate a transaction hash
//  - NEVER deliver the analysis before successful settlement
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  canProcessPayments,
  validatePayToAddress,
  getEvidenceCheckPriceAtomic,
  generatePaymentId,
  X402_FACILITATOR_USDC_MAINNET,
  X402_USDC_ADDRESS,
} from "@/lib/x402/config";
import {
  parseCaseRefreshRequest,
} from "@/lib/x402/caseRefreshValidation";
import {
  SettlementReceipt,
  X402ErrorResponse,
  PaymentPayloadCustom,
} from "@/lib/x402/types";
import {
  buildEvidenceCheckHeader,
  verifyPaymentPayload,
  encodePaymentResponseHeader,
} from "@/lib/x402/shared";
import {
  getPaymentStore,
} from "@/lib/x402/paymentStore.supabase";
import {
  getSettlementProvider,
  type FacilitatorSettlementReceipt,
} from "@/lib/x402/settlementProvider";
import type {
  PaymentPayload as X402PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import {
  computeCaseRefreshHash,
  caseRefreshIdentitySchema,
  computeCaseRefreshInputHash,
} from "@/lib/x402/caseRefreshRequestHash";
import { generateCaseRefresh } from "@/lib/x402/caseRefreshGenerate";
import { normalizeForJson } from "@/lib/x402/jsonSafe";

// ---------------------------------------------------------------------------
// Helper: JSON-safe response
// ---------------------------------------------------------------------------

function jsonSafe(data: unknown, init?: ResponseInit | number): NextResponse {
  const status = typeof init === "number" ? init : (init as ResponseInit)?.status ?? 200;
  const opts = typeof init === "number" ? undefined : init;
  return NextResponse.json(normalizeForJson(data), { ...opts, status } as ResponseInit);
}

// ---------------------------------------------------------------------------
// Helper: build error response
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
  return jsonSafe(body, status);
}

// ---------------------------------------------------------------------------
// Helper: decode PAYMENT-SIGNATURE header
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
      error: jsonSafe(
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
// POST handler — entry point
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    return await handlePaymentRequest(request, correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown internal error";
    console.error(
      `[case-refresh][${correlationId}] Unhandled internal error: ${message}`,
      err instanceof Error ? err.stack : "",
    );
    return jsonSafe(
      {
        correlationId,
        status: 500,
        error: `Internal server error: ${message}`,
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Core payment handler
// ---------------------------------------------------------------------------

async function handlePaymentRequest(
  request: Request,
  correlationId: string,
): Promise<Response> {
  const store = getPaymentStore();

  // ---- Step 0: Config validation ----
  if (!canProcessPayments()) {
    return errorResponse(
      500,
      "x402 payment processing is not configured on this server.",
      correlationId,
    );
  }

  try {
    validatePayToAddress();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return errorResponse(500, message, correlationId);
  }

  // ---- Step 0b: Settlement provider ----
  const settlementProvider = getSettlementProvider();
  const isTrack2Mode = settlementProvider.isTrack2Qualifying;

  // ---- Step 1: Check for PAYMENT-SIGNATURE header ----
  const paymentSignatureHeader = request.headers.get("payment-signature");

  if (!paymentSignatureHeader) {
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      // Body not parseable — proceed to 402
    }

    // ---- Preflight: check for existing result by canonical hash ----
    const preflightResult = await checkPreflightDuplicate(
      body,
      settlementProvider,
      isTrack2Mode,
      correlationId,
      store,
    );
    if (preflightResult) return preflightResult;

    // ---- No payment, no existing result → return 402 ----
    const paymentRequiredValue = buildEvidenceCheckHeader();
    return new NextResponse(
      JSON.stringify({
        correlationId,
        error:
          "Payment required. Include a PAYMENT-SIGNATURE header with your request.",
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
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

  // ---- Step 2: Decode payment payload ----
  const decoded = decodePaymentSignature(paymentSignatureHeader, correlationId);
  if (!decoded.success) return decoded.error;

  const paymentPayload = decoded.payload;

  // ---- Step 3: Structural validation ----
  if (!isTrack2Mode) {
    const verification = verifyPaymentPayload(paymentPayload);
    if (!verification.valid) {
      return jsonSafe(
        {
          correlationId,
          status: 402,
          error: `Payment verification failed: ${verification.reason}`,
        },
        { status: 402 },
      );
    }
  } else {
    if (paymentPayload.scheme !== "exact") {
      return jsonSafe(
        { correlationId, status: 402, error: "Unsupported payment scheme for facilitator mode." },
        { status: 402 },
      );
    }
    if (paymentPayload.network !== settlementProvider.network) {
      return jsonSafe(
        { correlationId, status: 402, error: `Network ${paymentPayload.network} not supported.` },
        { status: 402 },
      );
    }
  }

  // ---- Step 4: Idempotency via X-Payment-Id ----
  const paymentIdHeader = request.headers.get("x-payment-id");
  const paymentId = paymentIdHeader || generatePaymentId();

  const cachedResult = await store.getResult(paymentId);
  if (cachedResult) {
    const response: Record<string, unknown> = {
      correlationId,
      settlement: cachedResult.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
    };
    if (cachedResult.brief) {
      response.result = cachedResult.brief;
    } else {
      response.result = null;
      response.recoveryNote =
        "Settlement confirmed but result was deferred. Retry to regenerate.";
    }
    return jsonSafe(normalizeForJson(response), {
      status: 200,
      headers: {
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: true,
          transaction: cachedResult.receipt.txHash,
          network: settlementProvider.network as `${string}:${string}`,
          payer: cachedResult.receipt.from,
        }),
        "X-Payment-Id": paymentId,
      },
    });
  }

  // Check previous failure
  const previousError = await store.getError(paymentId);
  if (previousError) {
    return errorResponse(
      402,
      `Payment ${paymentId} previously failed: ${previousError}. Generate a new payment.`,
      correlationId,
    );
  }

  await store.recordPending(paymentId);

  // ---- Resolve payment data ----
  const isFacilitator = settlementProvider.identifier === "celo-facilitator";
  const x402PaymentData = paymentPayload.payment as unknown as Record<string, unknown>;
  const isEIP3009 =
    x402PaymentData != null &&
    typeof x402PaymentData === "object" &&
    "authorization" in x402PaymentData;
  const eipAuth = isEIP3009
    ? (x402PaymentData.authorization as Record<string, unknown>)
    : null;
  const resolvedToken = isEIP3009
    ? X402_FACILITATOR_USDC_MAINNET
    : (x402PaymentData.token as string);
  const resolvedAmount = isEIP3009
    ? String(eipAuth?.value ?? getEvidenceCheckPriceAtomic().toString())
    : (x402PaymentData.amount as string);

  // ---- Parse request body ----
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    await store.recordFailed(paymentId, "Malformed JSON body.");
    return errorResponse(400, "Malformed JSON body.", correlationId);
  }

  const bodyParseResult = parseCaseRefreshRequest(body);
  if (!bodyParseResult.success) {
    await store.recordFailed(paymentId, "Request body validation failed.");
    return errorResponse(400, "Request body validation failed.", correlationId, bodyParseResult.errors);
  }

  const caseRefreshRequest = bodyParseResult.data;

  // ---- Compute input hash ----
  const inputHash = computeCaseRefreshInputHash(caseRefreshRequest);

  // ---- Resolve payer address ----
  const receiptPayer = isEIP3009
    ? (eipAuth?.from as string)
    : (x402PaymentData.from as string);

  // ---- Compute canonical request hash ----
  const canonicalIdentity = {
    service: "case-refresh" as const,
    escrowPaymentId: caseRefreshRequest.escrowPaymentId,
    payer: receiptPayer,
    paymentNetwork: settlementProvider.network,
    asset: resolvedToken,
    payTo: settlementProvider.payToAddress,
    amount: resolvedAmount,
    scheme: "exact",
    caseRefreshInputHash: inputHash,
  };

  const identityValidation = caseRefreshIdentitySchema.safeParse(canonicalIdentity);
  if (!identityValidation.success) {
    await store.recordFailed(
      paymentId,
      `Request identity validation: ${identityValidation.error.message}`,
    );
    return errorResponse(
      422,
      `Invalid request: ${identityValidation.error.message}`,
      correlationId,
    );
  }

  const computedRequestHash = computeCaseRefreshHash(identityValidation.data);
  await store.setRequestHash(paymentId, computedRequestHash);

  // ---- Duplicate-settlement gate ----
  const existingByHash = await store.findByRequestHash(computedRequestHash);
  if (existingByHash) {
    if (
      existingByHash.status === "settled" ||
      existingByHash.status === "paid_pending_brief"
    ) {
      return jsonSafe(
        normalizeForJson({
          correlationId,
          paymentId: existingByHash.paymentId,
          status: existingByHash.status,
          recoveredFromHash: true,
          settlement: existingByHash.receipt,
          result: existingByHash.brief ?? null,
          settlementMode: settlementProvider.identifier,
          isTrack2Qualifying: isTrack2Mode,
        }),
        {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({
              success: true,
              transaction: existingByHash.receipt?.txHash ?? "",
              network: settlementProvider.network as `${string}:${string}`,
              payer: existingByHash.receipt?.from ?? "",
            }),
            "X-Payment-Id": existingByHash.paymentId,
          },
        },
      );
    }
  }

  // ---- Step 5: Cryptographic verification ----
  try {
    const verificationRequirements: PaymentRequirements = {
      scheme: "exact",
      network: settlementProvider.network as `${string}:${string}`,
      asset: resolvedToken,
      amount: resolvedAmount,
      payTo: settlementProvider.payToAddress,
      maxTimeoutSeconds: 300,
      extra: isFacilitator ? { name: "USDC", version: "2" } : {},
    };

    const x402Payload: X402PaymentPayload = {
      x402Version: 2,
      accepted: verificationRequirements,
      payload: paymentPayload.payment as unknown as Record<string, unknown>,
    };

    const verifyResult = await settlementProvider.verifyPayment(
      x402Payload,
      verificationRequirements,
    );

    if (!verifyResult.valid) {
      const reason = verifyResult.reason || "Unknown verification failure";
      await store.recordFailed(paymentId, `Verification failed: ${reason}`);
      return jsonSafe(
        { correlationId, status: 402, error: `Payment verification failed: ${reason}` },
        { status: 402 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await store.recordFailed(paymentId, `Verification error: ${message}`);
    return errorResponse(502, `Payment verification service unavailable: ${message}`, correlationId);
  }

  // ---- Step 6: On-chain settlement ----
  let settlementReceipt: SettlementReceipt;
  let facilitatorReceipt: FacilitatorSettlementReceipt | undefined;

  try {
    const settlementRequirements: PaymentRequirements = {
      scheme: "exact",
      network: settlementProvider.network as `${string}:${string}`,
      asset: resolvedToken,
      amount: resolvedAmount,
      payTo: settlementProvider.payToAddress,
      maxTimeoutSeconds: 300,
      extra: isFacilitator ? { name: "USDC", version: "2" } : {},
    };

    const x402SettlePayload: X402PaymentPayload = {
      x402Version: 2,
      accepted: settlementRequirements,
      payload: paymentPayload.payment as unknown as Record<string, unknown>,
    };

    const settleResult = await settlementProvider.settlePayment(
      x402SettlePayload,
      settlementRequirements,
    );

    if (!settleResult.success) {
      const reason = settleResult.reason || "Settlement failed with no reason given";
      throw new Error(reason);
    }

    if (settleResult.receipt) {
      facilitatorReceipt = settleResult.receipt;
    }

    const receiptFrom = isEIP3009
      ? (eipAuth?.from as string)
      : (x402PaymentData.from as string);

    settlementReceipt = {
      txHash: settleResult.txHash || "",
      blockNumber: BigInt(settleResult.blockNumber || 0),
      blockHash: "",
      status: "success" as const,
      from: receiptFrom,
      to: settlementProvider.payToAddress,
      amount: resolvedAmount,
      tokenAddress: resolvedToken,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await store.recordFailed(paymentId, `Settlement failed: ${message}`);
    return errorResponse(502, `Payment settlement failed: ${message}`, correlationId);
  }

  // ---- Persist settlement receipt ----
  await store.recordSettlementReceipt(paymentId, settlementReceipt);

  if (settlementReceipt.status !== "success") {
    await store.recordFailed(paymentId, "Settlement receipt status is not success.");
    return errorResponse(502, "Settlement transaction did not succeed on-chain.", correlationId);
  }

  if (!settlementReceipt.txHash) {
    await store.recordFailed(paymentId, "Settlement receipt missing transaction hash.");
    return errorResponse(502, "Settlement receipt is incomplete.", correlationId);
  }

  // ---- Generate case refresh ----
  let refreshResult;
  try {
    refreshResult = await generateCaseRefresh(caseRefreshRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        result: null,
        generationMode: "generation_failed",
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: `Generation deferred: ${message}. Retry with the same payment ID.`,
      },
      {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": encodePaymentResponseHeader({
            success: true,
            transaction: settlementReceipt.txHash,
            network: settlementProvider.network as `${string}:${string}`,
            payer: settlementReceipt.from,
          }),
          "X-Payment-Id": paymentId,
        },
      },
    );
  }

  if (!refreshResult) {
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        result: null,
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: "Generation did not produce a result. Retry with the same payment ID.",
      },
      {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": encodePaymentResponseHeader({
            success: true,
            transaction: settlementReceipt.txHash,
            network: settlementProvider.network as `${string}:${string}`,
            payer: settlementReceipt.from,
          }),
          "X-Payment-Id": paymentId,
        },
      },
    );
  }

  const result = refreshResult.result;

  // ---- Record result ----
  await store.recordBrief(
    paymentId,
    result as unknown as Parameters<typeof store.recordBrief>[1],
  );

  // ---- Return response ----
  return jsonSafe(
    {
      correlationId,
      result,
      settlement: settlementReceipt,
      generationMode: result.generationMode,
      usedFallback: refreshResult.usedFallback,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
      ...(facilitatorReceipt ? { facilitatorReceipt } : {}),
    },
    {
      status: 200,
      headers: {
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: true,
          transaction: settlementReceipt.txHash,
          network: settlementProvider.network as `${string}:${string}`,
          payer: settlementReceipt.from,
        }),
        "X-Payment-Id": paymentId,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Preflight: check for existing result by canonical request hash
// ---------------------------------------------------------------------------

async function checkPreflightDuplicate(
  body: unknown,
  settlementProvider: ReturnType<typeof getSettlementProvider>,
  isTrack2Mode: boolean,
  correlationId: string,
  store: ReturnType<typeof getPaymentStore>,
): Promise<Response | null> {
  if (!body || typeof body !== "object") return null;

  const bodyObj = body as Record<string, unknown>;
  const bodyParseResult = parseCaseRefreshRequest(bodyObj);
  if (!bodyParseResult.success) return null;

  const caseRefreshRequest = bodyParseResult.data;
  const inputHash = computeCaseRefreshInputHash(caseRefreshRequest);

  const precheckPayer =
    typeof bodyObj.walletAddress === "string" && bodyObj.walletAddress
      ? bodyObj.walletAddress
      : "";
  if (!precheckPayer || !/^0x[0-9a-fA-F]{40}$/.test(precheckPayer)) return null;

  const preflightIdentity = {
    service: "case-refresh" as const,
    escrowPaymentId: caseRefreshRequest.escrowPaymentId,
    payer: precheckPayer,
    paymentNetwork: settlementProvider.network,
    asset: isTrack2Mode
      ? X402_FACILITATOR_USDC_MAINNET
      : X402_USDC_ADDRESS,
    payTo: settlementProvider.payToAddress,
    amount: getEvidenceCheckPriceAtomic().toString(),
    scheme: "exact",
    caseRefreshInputHash: inputHash,
  };

  const preflightValidation = caseRefreshIdentitySchema.safeParse(preflightIdentity);
  if (!preflightValidation.success) return null;

  const preflightHash = computeCaseRefreshHash(preflightValidation.data);
  const existingByHash = await store.findByRequestHash(preflightHash);

  if (!existingByHash) return null;

  if (existingByHash.status === "settled" && existingByHash.brief) {
    return jsonSafe({
      correlationId,
      status: "settled",
      requiresPayment: false,
      paymentId: existingByHash.paymentId,
      result: existingByHash.brief,
      settlement: existingByHash.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
    });
  }

  if (existingByHash.status === "paid_pending_brief") {
    return jsonSafe({
      correlationId,
      status: "paid_pending_brief",
      requiresPayment: false,
      canRecoverResult: true,
      paymentId: existingByHash.paymentId,
      settlement: existingByHash.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
    });
  }

  return null;
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
