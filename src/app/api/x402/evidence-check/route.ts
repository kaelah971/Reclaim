// ---------------------------------------------------------------------------
// POST /api/x402/evidence-check
//
// x402 v2 payment-gated API endpoint for evidence quality assessment.
//
// Flow:
//  1. Client sends request WITHOUT payment → server returns 402 + requirements
//  2. Client pays (Permit2/EIP-3009), retries WITH PAYMENT-SIGNATURE header
//  3. Server verifies payment cryptographically via settlement provider
//  4. Server settles payment on-chain (USDC transfer to service wallet)
//  5. Server generates evidence quality assessment (AI with fallback)
//  6. Returns assessment with PAYMENT-RESPONSE header
//
// Key differences from dispute-brief:
//  - No on-chain escrow reading needed (evidence is client-submitted)
//  - No payment state validation (assessment works for any payment phase)
//  - Uses evidenceCheckIdentitySchema (evidenceInputHash replaces disputeReason/outcome)
//  - Generates evidence quality assessment instead of dispute brief
//
// CRITICAL RULES:
//  - NEVER return settlement success without a real confirmed on-chain tx
//  - NEVER fabricate a transaction hash
//  - NEVER deliver the assessment before successful settlement
//  - NEVER allow payment to the escrow contract address
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";
import {
  canProcessPayments,
  validatePayToAddress,
  getEvidenceCheckPriceAtomic,
  generatePaymentId,
  X402_FACILITATOR_USDC_MAINNET,
  X402_USDC_ADDRESS,
} from "@/lib/x402/config";
import {
  parseEvidenceCheckRequest,
  type EvidenceCheckRequestInput,
} from "@/lib/x402/evidenceCheckValidation";
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
  computeEvidenceCheckHash,
  evidenceCheckIdentitySchema,
} from "@/lib/x402/requestHash";
import { generateEvidenceQuality } from "@/lib/x402/ai/evidenceQualityGenerate";
import type { EvidenceQualityAssessment } from "@/lib/x402/ai/evidenceQualityGenerate";
import { normalizeForJson } from "@/lib/x402/jsonSafe";

// ---------------------------------------------------------------------------
// Helper: JSON-safe response — normalizes all BigInt before serialization
// ---------------------------------------------------------------------------

function jsonSafe(data: unknown, init?: ResponseInit | number): NextResponse {
  const status = typeof init === "number" ? init : (init as ResponseInit)?.status ?? 200;
  const opts = typeof init === "number" ? undefined : init;
  return NextResponse.json(normalizeForJson(data), { ...opts, status } as ResponseInit);
}

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
  return jsonSafe(body, status);
}

// ---------------------------------------------------------------------------
// Helper: compute deterministic evidence input hash from sanitized fields
// ---------------------------------------------------------------------------

function computeEvidenceInputHash(input: EvidenceCheckRequestInput): string {
  // Build a deterministic pipe-delimited string from evidence-specific fields.
  // Field order is fixed to ensure hash stability.
  const fields = [
    input.evidenceTitle,
    input.evidenceDescription || "",
    input.evidenceType || "",
    input.relatedClaim || "",
    input.evidenceDate || "",
    input.externalRef || "",
    input.pastedText || "",
    input.fileHash || "",
  ];
  return keccak256(stringToHex(fields.join("|")));
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
      `[ev-check][${correlationId}] Unhandled internal error: ${message}`,
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
// Core payment handler — verify → settle → generate → respond
// ---------------------------------------------------------------------------

async function handlePaymentRequest(
  request: Request,
  correlationId: string,
): Promise<Response> {
  const store = getPaymentStore();

  // ---- Step 0: Config validation ----
  if (!canProcessPayments()) {
    console.error(
      `[ev-check][${correlationId}] Server not configured: X402_PAY_TO_ADDRESS is unset.`,
    );
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
    // Parse body early for preflight / recovery checks
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      // Body not parseable — proceed to 402
    }

    // ---- Recovery mode: paid_pending_result ----
    if (
      body &&
      typeof body === "object" &&
      "recoveryTxHash" in (body as Record<string, unknown>) &&
      typeof (body as Record<string, unknown>).recoveryTxHash === "string"
    ) {
      return handleRecovery(
        body as Record<string, unknown>,
        correlationId,
      );
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
      console.warn(
        `[ev-check][${correlationId}] Payment verification failed: ${verification.reason}`,
      );
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
        { correlationId, status: 402, error: "Unsupported payment scheme for facilitator mode. Expected: exact." },
        { status: 402 },
      );
    }
    if (paymentPayload.network !== settlementProvider.network) {
      return jsonSafe(
        { correlationId, status: 402, error: `Network ${paymentPayload.network} not supported. Expected: ${settlementProvider.network}.` },
        { status: 402 },
      );
    }
  }

  // ---- Step 4: Idempotency via X-Payment-Id ----
  const paymentIdHeader = request.headers.get("x-payment-id");
  const paymentId = paymentIdHeader || generatePaymentId();

  // Check cached result
  const cachedResult = await store.getResult(paymentId);
  if (cachedResult) {
    console.log(
      `[ev-check][${correlationId}] Payment ${paymentId} already settled — returning cached.`,
    );
    const response: Record<string, unknown> = {
      correlationId,
      settlement: cachedResult.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
    };
    if (cachedResult.brief) {
      response.assessment = cachedResult.brief;
    } else {
      response.assessment = null;
      response.recoveryNote =
        "Settlement confirmed but assessment was deferred. " +
        "The service fee has been paid; the assessment will be regenerated on retry.";
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

  // Mark as pending
  await store.recordPending(paymentId);

  // ---- Resolve payment data for EIP-3009 vs Permit2 ----
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

  const bodyParseResult = parseEvidenceCheckRequest(body);
  if (!bodyParseResult.success) {
    await store.recordFailed(paymentId, "Request body validation failed.");
    return errorResponse(400, "Request body validation failed.", correlationId, bodyParseResult.errors);
  }

  const evidenceRequest = bodyParseResult.data;

  // ---- Compute evidence input hash ----
  const evidenceInputHash = computeEvidenceInputHash(evidenceRequest);

  // ---- Resolve payer address ----
  const receiptPayer = isEIP3009
    ? (eipAuth?.from as string)
    : (x402PaymentData.from as string);

  // ---- Compute canonical request hash ----
  const canonicalIdentity = {
    service: "evidence-quality-check" as const,
    escrowPaymentId: evidenceRequest.escrowPaymentId,
    payer: receiptPayer,
    paymentNetwork: settlementProvider.network,
    asset: resolvedToken,
    payTo: settlementProvider.payToAddress,
    amount: resolvedAmount,
    scheme: "exact",
    evidenceInputHash,
  };

  const identityValidation = evidenceCheckIdentitySchema.safeParse(canonicalIdentity);
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

  const computedRequestHash = computeEvidenceCheckHash(identityValidation.data);
  await store.setRequestHash(paymentId, computedRequestHash);

  // ---- Duplicate-settlement gate ----
  const existingByHash = await store.findByRequestHash(computedRequestHash);
  if (existingByHash) {
    if (
      existingByHash.status === "settled" ||
      existingByHash.status === "paid_pending_brief"
    ) {
      console.log(
        `[ev-check][${correlationId}] Request hash already paid as ${existingByHash.paymentId} — returning cached.`,
      );
      const recoveryNote = existingByHash.brief
        ? undefined
        : "Settlement confirmed but assessment was deferred. The service fee has been paid.";

      return jsonSafe(
        normalizeForJson({
          correlationId,
          paymentId: existingByHash.paymentId,
          status: existingByHash.status,
          recoveredFromHash: true,
          settlement: existingByHash.receipt,
          assessment: existingByHash.brief ?? null,
          recoveryNote,
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
    console.log(
      `[ev-check][${correlationId}] Verifying payment via ${settlementProvider.identifier}...`,
    );

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
      console.warn(`[ev-check][${correlationId}] Payment verification failed: ${reason}`);
      await store.recordFailed(paymentId, `Verification failed: ${reason}`);
      return jsonSafe(
        { correlationId, status: 402, error: `Payment verification failed: ${reason}` },
        { status: 402 },
      );
    }

    console.log(
      `[ev-check][${correlationId}] Verification succeeded. Payer: ${verifyResult.payer || "unknown"}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ev-check][${correlationId}] Payment verification error: ${message}`);
    await store.recordFailed(paymentId, `Verification error: ${message}`);
    return errorResponse(502, `Payment verification service unavailable: ${message}`, correlationId);
  }

  // ---- Step 10: On-chain settlement ----
  let settlementReceipt: SettlementReceipt;
  let facilitatorReceipt: FacilitatorSettlementReceipt | undefined;

  try {
    console.log(
      `[ev-check][${correlationId}] Executing on-chain settlement via ${settlementProvider.identifier}...`,
    );

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

    console.log(
      `[ev-check][${correlationId}] Settlement confirmed: ${settlementReceipt.txHash}` +
        (settlementReceipt.blockNumber > BigInt(0)
          ? ` block ${settlementReceipt.blockNumber}`
          : " block pending"),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ev-check][${correlationId}] Settlement failed: ${message}`);
    await store.recordFailed(paymentId, `Settlement failed: ${message}`);
    return errorResponse(502, `Payment settlement failed: ${message}`, correlationId);
  }

  // ---- Step 10b: Persist settlement receipt ----
  await store.recordSettlementReceipt(paymentId, settlementReceipt);

  // ---- Step 11: Verify settlement receipt integrity ----
  if (settlementReceipt.status !== "success") {
    await store.recordFailed(paymentId, "Settlement receipt status is not success.");
    return errorResponse(502, "Settlement transaction did not succeed on-chain.", correlationId);
  }

  if (!settlementReceipt.txHash) {
    await store.recordFailed(paymentId, "Settlement receipt missing transaction hash.");
    return errorResponse(502, "Settlement receipt is incomplete (missing transaction hash).", correlationId);
  }

  // ---- Step 12: Generate evidence quality assessment ----
  let qualityResult: { assessment: EvidenceQualityAssessment; usedFallback: boolean } | undefined;

  try {
    qualityResult = await generateEvidenceQuality(
      evidenceRequest,
      evidenceInputHash,
      correlationId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[ev-check][${correlationId}] Assessment generation failed after settled payment: ${message}`,
    );
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        assessment: null,
        generationMode: "generation_failed",
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: `Assessment generation deferred: ${message}. The service fee has been paid. Retry with the same payment ID.`,
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

  if (!qualityResult) {
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        assessment: null,
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: "Assessment generation did not produce a result. Retry with the same payment ID.",
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

  const assessment = qualityResult.assessment;
  console.log(
    `[ev-check][${correlationId}] Assessment generated: mode=${assessment.generationMode}, ` +
      `provider=${assessment.provider ?? "n/a"}, usedFallback=${qualityResult.usedFallback}`,
  );

  // ---- Step 13: Record assessment (using recordBrief as the storage hook) ----
  await store.recordBrief(
    paymentId,
    assessment as unknown as Parameters<typeof store.recordBrief>[1],
  );

  // ---- Step 14: Return response ----
  return jsonSafe(
    {
      correlationId,
      assessment,
      settlement: settlementReceipt,
      generationMode: assessment.generationMode,
      provider: assessment.provider,
      model: assessment.model,
      usedFallback: qualityResult.usedFallback,
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
  const bodyParseResult = parseEvidenceCheckRequest(bodyObj);
  if (!bodyParseResult.success) return null;

  const evidenceRequest = bodyParseResult.data;
  const evidenceInputHash = computeEvidenceInputHash(evidenceRequest);

  // Use walletAddress from body as payer for preflight hash matching
  const precheckPayer =
    typeof bodyObj.walletAddress === "string" && bodyObj.walletAddress
      ? bodyObj.walletAddress
      : "";
  if (!precheckPayer || !/^0x[0-9a-fA-F]{40}$/.test(precheckPayer)) return null;

  const preflightIdentity = {
    service: "evidence-quality-check" as const,
    escrowPaymentId: evidenceRequest.escrowPaymentId,
    payer: precheckPayer,
    paymentNetwork: settlementProvider.network,
    asset: isTrack2Mode
      ? X402_FACILITATOR_USDC_MAINNET
      : X402_USDC_ADDRESS,
    payTo: settlementProvider.payToAddress,
    amount: getEvidenceCheckPriceAtomic().toString(),
    scheme: "exact",
    evidenceInputHash,
  };

  const preflightValidation = evidenceCheckIdentitySchema.safeParse(preflightIdentity);
  if (!preflightValidation.success) return null;

  const preflightHash = computeEvidenceCheckHash(preflightValidation.data);
  const existingByHash = await store.findByRequestHash(preflightHash);

  if (!existingByHash) return null;

  if (existingByHash.status === "settled" && existingByHash.brief) {
    return jsonSafe({
      correlationId,
      status: "settled",
      requiresPayment: false,
      paymentId: existingByHash.paymentId,
      assessment: existingByHash.brief,
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
      canRecoverAssessment: true,
      paymentId: existingByHash.paymentId,
      settlement: existingByHash.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Recovery handler — regenerate assessment for a paid_pending_result tx
// ---------------------------------------------------------------------------

async function handleRecovery(
  body: Record<string, unknown>,
  correlationId: string,
): Promise<Response> {
  const store = getPaymentStore();
  const recoveryTxHash = body.recoveryTxHash as string;

  // ---- Validate txHash format ----
  if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryTxHash)) {
    return jsonSafe(
      {
        correlationId,
        error: "Invalid recoveryTxHash format. Must be a 0x-prefixed 64-char hex.",
      },
      { status: 400 },
    );
  }

  // ---- Parse evidence request body ----
  const bodyParseResult = parseEvidenceCheckRequest(body);
  if (!bodyParseResult.success) {
    return jsonSafe(
      {
        correlationId,
        error: "Recovery requires valid evidence check request fields.",
        details: bodyParseResult.errors,
      },
      { status: 400 },
    );
  }

  const evidenceRequest = bodyParseResult.data;

  // ---- Look up existing settlement by txHash ----
  const found = await store.findByTxHash(recoveryTxHash);

  if (!found) {
    return jsonSafe(
      {
        correlationId,
        error: `No settlement record found for transaction hash '${recoveryTxHash}'.`,
      },
      { status: 404 },
    );
  }

  if (found.record.status !== "paid_pending_brief") {
    if (found.record.status === "settled" && found.record.brief) {
      return jsonSafe({
        correlationId,
        recovery: true,
        status: "already_settled",
        paymentId: found.paymentId,
        assessment: found.record.brief,
        settlement: found.record.receipt,
      });
    }
    return jsonSafe(
      {
        correlationId,
        error: `Transaction ${recoveryTxHash} is in state '${found.record.status}'. Recovery requires 'paid_pending_brief' state.`,
      },
      { status: 409 },
    );
  }

  // ---- Verify request hash binding ----
  const storedHash = await store.getRequestHash(found.paymentId);
  if (storedHash) {
    const evidenceInputHash = computeEvidenceInputHash(evidenceRequest);
    const receipt = found.record.receipt!;
    const recoveryIdentity = {
      service: "evidence-quality-check" as const,
      escrowPaymentId: evidenceRequest.escrowPaymentId,
      payer: receipt.from,
      paymentNetwork: "eip155:42220", // Facilitator chain
      asset: X402_FACILITATOR_USDC_MAINNET,
      payTo: receipt.to,
      amount: receipt.amount,
      scheme: "exact",
      evidenceInputHash,
    };

    const identityValidation = evidenceCheckIdentitySchema.safeParse(recoveryIdentity);
    if (identityValidation.success) {
      const computedHash = computeEvidenceCheckHash(identityValidation.data);
      if (computedHash !== storedHash) {
        return jsonSafe(
          {
            correlationId,
            error:
              "Request hash mismatch. The submitted evidence details differ from the original settlement request. The assessment cannot be regenerated with different evidence.",
          },
          { status: 409 },
        );
      }
    }
  }

  // ---- Generate the assessment ----
  const evidenceInputHash = computeEvidenceInputHash(evidenceRequest);
  let qualityResult: { assessment: EvidenceQualityAssessment; usedFallback: boolean };

  try {
    qualityResult = await generateEvidenceQuality(
      evidenceRequest,
      evidenceInputHash,
      correlationId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonSafe(
      {
        correlationId,
        error: `Assessment generation failed during recovery: ${message}. Retry the request.`,
      },
      { status: 500 },
    );
  }

  // ---- Record the assessment ----
  await store.recordBrief(
    found.paymentId,
    qualityResult.assessment as unknown as Parameters<typeof store.recordBrief>[1],
  );

  return jsonSafe({
    correlationId,
    recovery: true,
    mode: "paid_pending_brief",
    paymentId: found.paymentId,
    generationMode: qualityResult.assessment.generationMode,
    usedFallback: qualityResult.usedFallback,
    assessment: qualityResult.assessment,
    settlement: found.record.receipt,
  });
}

// ---------------------------------------------------------------------------
// GET handler — idempotent recovery / inspection
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const store = getPaymentStore();
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const txHash = url.searchParams.get("txHash");

  // Direct lookup by payment ID (UUID — implicitly authenticated)
  if (paymentId) {
    const result = await store.getResult(paymentId);
    if (result) {
      return jsonSafe({
        paymentId,
        status: result.brief ? "settled" : "paid_pending_brief",
        settlement: result.receipt,
        assessment: result.brief ?? null,
        recoveryNote: result.brief
          ? undefined
          : "Settlement confirmed but assessment was not generated. Submit a POST with the same payment-id header to regenerate.",
      });
    }
    const err = await store.getError(paymentId);
    if (err) {
      return jsonSafe({ paymentId, status: "failed", error: err }, { status: 402 });
    }
    return jsonSafe(
      { error: `Payment identifier '${paymentId}' not found.` },
      { status: 404 },
    );
  }

  // Search by transaction hash — public settlement info only
  if (txHash) {
    const found = await store.findByTxHash(txHash);
    if (found) {
      return jsonSafe({
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
        hasAssessment: !!found.record.brief,
        note:
          "Use paymentId query param or POST with the same x-payment-id header to retrieve the full assessment.",
      });
    }
    return jsonSafe(
      { txHash, error: `No settlement record found for transaction hash '${txHash}'.` },
      { status: 404 },
    );
  }

  // List all entries (admin/debug)
  const entries: Record<string, { status: string; txHash?: string; error?: string; createdAt: number }> = {};
  for (const [id, record] of await store.getAllEntries()) {
    entries[id] = {
      status: record.status,
      txHash: record.receipt?.txHash,
      error: record.error,
      createdAt: record.createdAt,
    };
  }
  return jsonSafe({ count: Object.keys(entries).length, entries });
}

// ---------------------------------------------------------------------------
// OPTIONS handler (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, PAYMENT-SIGNATURE, X-Payment-Id",
    },
  });
}
