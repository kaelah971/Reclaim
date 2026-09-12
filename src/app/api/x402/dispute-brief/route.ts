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
import { celo, celoSepolia } from "viem/chains";
import {
  canProcessPayments,
  validatePayToAddress,
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_USDC_ADDRESS,
  getDisputeBriefPriceAtomic,
  fromAtomicUnits,
  generatePaymentId,
  getX402ServicePaymentTerms,
} from "@/lib/x402/config";
import { parseDisputeBriefRequest } from "@/lib/x402/validation";
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
  getPaymentPayloadPayer,
  encodePaymentResponseHeader,
} from "@/lib/x402/shared";
import {
  getPaymentStore,
} from "@/lib/x402/paymentStore.supabase";
import {
  assertNumericEscrowPaymentId,
  assertSettlementReceiptPersistable,
  PaymentStoreConflictError,
} from "@/lib/x402/paymentStore";
import { findTransferEvents } from "@/lib/x402/settlement";
import {
  getSettlementProvider,
  type FacilitatorSettlementReceipt,
} from "@/lib/x402/settlementProvider";
import type {
  PaymentPayload as X402PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { computeCanonicalRequestHash, canonicalRequestIdentitySchema, SERVICE_IDENTIFIER } from "@/lib/x402/requestHash";
import {
  decodeWalletAuthMessage,
  extractWalletAuth,
  verifyWalletSignature,
} from "@/lib/x402/walletAuth";
import { generateAICaseBrief, type AIGenerationResult } from "@/lib/x402/ai/generate";
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
  paymentTerms: ReturnType<typeof getX402ServicePaymentTerms>,
): Promise<Response> {
  const store = getPaymentStore();
  const txHash = recoveryTxHash as `0x${string}`;

  // --- Step R1: Validate txHash format ---
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return jsonSafe({
      correlationId,
      error: "Invalid recoveryTxHash format. Must be a 0x-prefixed 64-char hex.",
    }, { status: 400 });
  }

  // --- Step R2: Validate required fields ---
  const disputeReason = typeof body.disputeReason === "string" ? body.disputeReason : "";
  const requestedOutcome = typeof body.requestedOutcome === "string" ? body.requestedOutcome : "";
  const escrowPaymentIdStr = typeof body.paymentId === "string" ? body.paymentId : "";

  if (!disputeReason || !requestedOutcome || !escrowPaymentIdStr) {
    return jsonSafe({
      correlationId,
      error: "Recovery requires disputeReason, requestedOutcome, and paymentId fields.",
    }, { status: 400 });
  }

  try {
    assertNumericEscrowPaymentId("reclaim-dispute-brief-v1", escrowPaymentIdStr);
  } catch {
    return jsonSafe({
      correlationId,
      error: "Invalid escrow paymentId.",
    }, { status: 400 });
  }

  // --- Step R3: Wallet authentication ---
  const { walletAddress, signedMessage, walletSignature } = extractWalletAuth(
    body as Record<string, unknown>,
  );

  if (!walletAddress || !signedMessage || !walletSignature) {
    return jsonSafe({
      correlationId,
      error: "Recovery requires walletAddress, signedMessage, and walletSignature for payer authentication.",
    }, { status: 401 });
  }

  const authResult = await verifyWalletSignature(walletAddress, signedMessage, walletSignature);
  if (!authResult.verified) {
    return jsonSafe({
      correlationId,
      error: `Wallet authentication failed: ${authResult.error}`,
    }, { status: 401 });
  }

  // Resolve persisted x402 chain metadata before touching the RPC. Historical
  // recovery has no row and remains explicitly local Sepolia.
  const existingRecord = await store.findByTxHash(txHash);
  const recoveryChainId = existingRecord?.record.metadata?.chainId ?? 11142220;
  const recoveryChain = recoveryChainId === 42220 ? celo : celoSepolia;

  // --- Step R4: Verify txHash on-chain (strict) ---
  const rpcUrl = recoveryChainId === 42220
    ? process.env.X402_MAINNET_RPC_URL || "https://forno.celo.org"
    : process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";
  const escrowRpcUrl =
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org";

  let receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>["getTransactionReceipt"]>>;

  try {
    const client = createPublicClient({
      chain: recoveryChain,
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
    return jsonSafe({
      correlationId,
      error: `Failed to verify transaction on-chain: ${message}`,
    }, { status: 502 });
  }

  if (!receipt || receipt.status !== "success") {
    return jsonSafe({
      correlationId,
      error: `Transaction ${txHash} not found or not successful on-chain.`,
    }, { status: 404 });
  }

  // Reuse persisted payment terms for modern recovery records. Historical
  // records without metadata are explicitly interpreted as local Sepolia
  // payments and must not inherit facilitator mainnet configuration.
  const recoveryTerms = existingRecord?.record.metadata ?? (existingRecord
    ? paymentTerms
    : {
        service: SERVICE_IDENTIFIER,
        payerAddress: walletAddress,
        payToAddress: X402_PAY_TO_ADDRESS || KNOWN_SETTLEMENT_PAY_TO,
        network: X402_NETWORK,
        chainId: 11142220,
        tokenAddress: X402_USDC_ADDRESS,
        tokenSymbol: "USDC" as const,
        tokenDecimals: 6,
        amountAtomic: getDisputeBriefPriceAtomic().toString(),
        amountDisplay: fromAtomicUnits(getDisputeBriefPriceAtomic(), 6),
      });

  // --- Step R5: Verify exact USDC Transfer event ---
  const payTo = recoveryTerms.payToAddress;
  const usdcAddr = recoveryTerms.tokenAddress;
  const expectedAmount = BigInt(recoveryTerms.amountAtomic);

  const matchingTransfers = findTransferEvents(
    receipt.logs,
    usdcAddr as `0x${string}`,
    walletAddress as `0x${string}`,
    payTo as `0x${string}`,
    expectedAmount,
  );

  if (matchingTransfers.length === 0) {
    return jsonSafe({
      correlationId,
      error: `Transaction ${txHash} does NOT contain a USDC Transfer from ${walletAddress} to ${payTo} for ${expectedAmount} atomic units.`,
    }, { status: 422 });
  }

  if (matchingTransfers.length > 1) {
    return jsonSafe({
      correlationId,
      error: `Transaction ${txHash} contains ${matchingTransfers.length} matching USDC Transfer events. Expected exactly one.`,
    }, { status: 422 });
  }

  const transfer = matchingTransfers[0];
  const verifiedFrom = transfer.from;
  const verifiedTo = transfer.to;
  const verifiedAmount = transfer.value.toString();

  // --- Step R6: Replay protection ---
  if (await store.isTxHashConsumed(txHash)) {
    const consumed = await store.findConsumedTx(txHash);
    return jsonSafe({
      correlationId,
      error: `Transaction ${txHash} has already been consumed for recovery (payment ${consumed?.paymentId}, at ${consumed?.consumedAt}). This transaction cannot be reused.`,
    }, { status: 409 });
  }

  // --- Step R7: Determine paid_pending_brief or legacy ---

  let escrowPaymentId: bigint;
  try {
    escrowPaymentId = BigInt(escrowPaymentIdStr);
  } catch {
    return jsonSafe({
      correlationId,
      error: "Invalid escrow paymentId.",
    }, { status: 400 });
  }

  if (existingRecord && existingRecord.record.status === "paid_pending_brief") {
    // =================================================================
    // PAID_PENDING_BRIEF RECOVERY — strict request-hash binding
    // =================================================================

    const existingPaymentId = existingRecord.paymentId;
    const storedEscrowPaymentId = existingRecord.record.metadata?.escrowPaymentId;

    // New x402 records use a pay_* identifier while legacy records used the
    // numeric escrow ID as their payment identifier. Accept both shapes, but
    // always bind recovery to the persisted escrow metadata when available.
    if (
      (storedEscrowPaymentId && storedEscrowPaymentId !== escrowPaymentIdStr) ||
      (!storedEscrowPaymentId && existingPaymentId !== escrowPaymentIdStr)
    ) {
      return jsonSafe({
        correlationId,
        error: `Payment ID mismatch: transaction ${txHash} is bound to payment '${existingPaymentId}', not '${escrowPaymentIdStr}'.`,
      }, { status: 409 });
    }

    const storedHash = await store.getRequestHash(existingPaymentId);
    if (storedHash) {
      const computedHash = computeCanonicalRequestHash({
        service: SERVICE_IDENTIFIER,
        escrowPaymentId: escrowPaymentIdStr,
        payer: verifiedFrom,
        paymentNetwork: recoveryTerms.network,
        asset: recoveryTerms.tokenAddress,
        payTo: recoveryTerms.payToAddress,
        amount: recoveryTerms.amountAtomic,
        scheme: "exact",
        disputeReason,
        requestedOutcome,
      });

      if (computedHash !== storedHash) {
        return jsonSafe({
          correlationId,
          error: "Request hash mismatch. The submitted dispute details differ from the original settlement request. The brief cannot be regenerated with different details.",
        }, { status: 409 });
      }
    }

    // Consume txHash so it cannot be reused
    await store.consumeTxHash(txHash, existingPaymentId, {
      recoveredPayer: verifiedFrom,
      recoveredRequestHash: storedHash,
    });

    // Read on-chain payment data
    const escrowAddress = getEscrowContractAddress(11142220);
    if (!escrowAddress) {
      return jsonSafe({
        correlationId,
        error: "Escrow contract address not configured.",
      }, { status: 500 });
    }

    try {
      const client = createPublicClient({
        chain: celoSepolia,
        transport: http(escrowRpcUrl),
      });
      await client.readContract({
        address: escrowAddress,
        abi: protectedPaymentEscrowABI,
        functionName: "getPayment",
        args: [escrowPaymentId],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown RPC error";
      return jsonSafe({
        correlationId,
        error: `Failed to read payment data: ${message}`,
      }, { status: 502 });
    }

    // raw payment validated to exist — data is read by generateAICaseBrief internally

    const genResult = await generateAICaseBrief(
      {
        paymentId: escrowPaymentIdStr,
        disputeReason,
        requestedOutcome,
      },
      correlationId,
      true,
    );
    const brief = genResult.brief;
    await store.recordBrief(existingPaymentId, brief as unknown as Parameters<typeof store.recordBrief>[1]);

    return jsonSafe({
      correlationId,
      recovery: true,
      mode: "paid_pending_brief",
      generationMode: genResult.metadata.generationMode,
      usedFallback: genResult.usedFallback,
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
    return jsonSafe({
      correlationId,
      error: "Historical recovery is only available for Payment #1. The original request hash was lost for this transaction.",
    }, { status: 422 });
  }

  if (verifiedFrom.toLowerCase() !== KNOWN_SETTLEMENT_BUYER.toLowerCase()) {
    return jsonSafe({
      correlationId,
      error: `Historical recovery: transaction payer ${verifiedFrom} does not match the expected buyer ${KNOWN_SETTLEMENT_BUYER}.`,
    }, { status: 403 });
  }

  // Legacy recovery predates x402 UUIDs and therefore has no durable payment
  // row to satisfy the consumed-transaction foreign key. Create a deterministic
  // synthetic x402 record with complete metadata before consuming the txHash.
  const legacyRecoveryPaymentId = `pay_legacy_${txHash.toLowerCase()}`;
  await store.recordPending(legacyRecoveryPaymentId, {
    service: SERVICE_IDENTIFIER,
    payerAddress: verifiedFrom,
    payToAddress: verifiedTo,
    network: X402_NETWORK,
    chainId: 11142220,
    tokenAddress: usdcAddr,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    amountAtomic: verifiedAmount,
    amountDisplay: fromAtomicUnits(BigInt(verifiedAmount), 6),
    escrowPaymentId: "1",
  });
  await store.consumeTxHash(txHash, legacyRecoveryPaymentId, {
    legacyRecovery: true,
    recoveredPayer: verifiedFrom,
  });

  // Read on-chain payment data
  const escrowAddress = getEscrowContractAddress(11142220);
  if (!escrowAddress) {
    return jsonSafe({
      correlationId,
      error: "Escrow contract address not configured.",
    }, { status: 500 });
  }

  try {
    const client = createPublicClient({
      chain: celoSepolia,
      transport: http(escrowRpcUrl),
    });
    await client.readContract({
      address: escrowAddress,
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      args: [escrowPaymentId],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown RPC error";
    return jsonSafe({
      correlationId,
      error: `Failed to read payment data: ${message}`,
    }, { status: 502 });
  }

  // raw payment validated to exist — data is read by generateAICaseBrief internally

  const genResult = await generateAICaseBrief(
    {
      paymentId: escrowPaymentIdStr,
      disputeReason,
      requestedOutcome,
    },
    correlationId,
    true,
  );
  const brief = genResult.brief;
  await store.recordSettlementReceipt(legacyRecoveryPaymentId, {
    txHash,
    blockNumber: BigInt(receipt.blockNumber),
    blockHash: receipt.blockHash,
    status: "success",
    from: verifiedFrom,
    to: verifiedTo,
    amount: verifiedAmount,
    tokenAddress: usdcAddr,
  });
  await store.recordBrief(legacyRecoveryPaymentId, brief as unknown as Parameters<typeof store.recordBrief>[1]);

  return jsonSafe({
    correlationId,
    recovery: true,
    mode: "legacy",
    generationMode: genResult.metadata.generationMode,
    usedFallback: genResult.usedFallback,
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

async function handlePaymentRequest(
  request: Request,
  correlationId: string,
): Promise<Response> {
  const store = getPaymentStore();

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

  // --- Step 0b: Initialise the active settlement provider ---
  const settlementProvider = getSettlementProvider();
  const isTrack2Mode = settlementProvider.isTrack2Qualifying;
  const paymentTerms = getX402ServicePaymentTerms("reclaim-dispute-brief-v1");

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
        paymentTerms,
      );
    }

    // --- Pre-payment recovery check ---
    // Use the SAME canonical request identity as settlement. Include the payer
    // wallet address from the request body (connected wallet, no signature needed).
    // This ensures the preflight hash matches the settlement hash exactly.
    if (recoveryBody && typeof recoveryBody.disputeReason === "string" && typeof recoveryBody.requestedOutcome === "string") {
      const precheckPayer = (typeof recoveryBody.walletAddress === "string" && recoveryBody.walletAddress)
        ? recoveryBody.walletAddress
        : "";
      const precheckPaymentId = typeof recoveryBody.paymentId === "string" ? recoveryBody.paymentId : "1";

      if (precheckPayer && /^0x[0-9a-fA-F]{40}$/.test(precheckPayer)) {
        const preflightIdentity = {
          service: SERVICE_IDENTIFIER,
          escrowChainId: isTrack2Mode ? "11142220" : undefined,
          escrowContractAddress: isTrack2Mode ? (getEscrowContractAddress(11142220) ?? undefined) : undefined,
          escrowPaymentId: precheckPaymentId,
          payer: precheckPayer,
          paymentNetwork: settlementProvider.network,
           asset: paymentTerms.tokenAddress,
           payTo: paymentTerms.payToAddress,
           amount: paymentTerms.amountAtomic,
          scheme: "exact",
          disputeReason: recoveryBody.disputeReason,
          requestedOutcome: recoveryBody.requestedOutcome,
        };

        const preflightValidation = canonicalRequestIdentitySchema.safeParse(preflightIdentity);
        if (preflightValidation.success) {
          const preflightHash = computeCanonicalRequestHash(preflightValidation.data);
          const existingByHash = await store.findByRequestHash(preflightHash);
          if (existingByHash) {
            if (existingByHash.status === "settled" && existingByHash.brief) {
              return jsonSafe({
                correlationId,
                status: "settled",
                requiresPayment: false,
                paymentId: existingByHash.paymentId,
                brief: existingByHash.brief,
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
                canRecoverBrief: true,
                paymentId: existingByHash.paymentId,
                settlement: existingByHash.receipt,
                settlementMode: settlementProvider.identifier,
                isTrack2Qualifying: isTrack2Mode,
              });
            }
          }
        }
      }
    }

    // No payment — return 402 with requirements
    const paymentRequiredValue = buildPaymentRequiredHeader();
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

  // --- Step 2: Decode the payment payload ---
  const decoded = decodePaymentSignature(paymentSignatureHeader, correlationId);
  if (!decoded.success) return decoded.error;

  const paymentPayload = decoded.payload;

  // --- Step 3: Validate all client payment fields against server-owned terms ---
  // This is intentionally strict: the client cannot select an amount, token,
  // network, recipient, or scheme.
  const structuralVerification = verifyPaymentPayload(paymentPayload, paymentTerms);
  if (!structuralVerification.valid) {
    console.warn(
      `[x402][${correlationId}] Payment verification failed: ${structuralVerification.reason}`,
    );
    return jsonSafe(
      {
        correlationId,
        status: 402,
        error: `Payment verification failed: ${structuralVerification.reason}`,
      },
      { status: 402 },
    );
  }

  // --- Step 4: Idempotency check via payment identifier ---
  // The client can send an X-Payment-Id header for idempotent retries.
  const paymentIdHeader = request.headers.get("x-payment-id");
  const paymentId = paymentIdHeader || generatePaymentId();

  // --- Resolve payment data for both EIP-3009 (facilitator) and Permit2 (local) ---
  const isFacilitator = settlementProvider.identifier === "celo-facilitator";
  const x402PaymentData = paymentPayload.payment as unknown as Record<string, unknown>;
  const isEIP3009 = x402PaymentData != null && typeof x402PaymentData === "object" && "authorization" in x402PaymentData;
  const eipAuth = isEIP3009 ? (x402PaymentData.authorization as Record<string, unknown>) : null;
  const resolvedToken = paymentTerms.tokenAddress;
  const resolvedAmount = paymentTerms.amountAtomic;

  // --- Parse request body EARLY — needed for hash check before /verify ---
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return errorResponse(400, "Malformed JSON body.", correlationId);
  }

  const bodyParseResult = parseDisputeBriefRequest(body);
  if (!bodyParseResult.success) {
    return errorResponse(400, "Request body validation failed.", correlationId, bodyParseResult.errors);
  }

  const disputeRequest = bodyParseResult.data;

  // Escrow identity is separate from the x402 payment identifier. It is
  // persisted only after strict numeric validation.
  try {
    assertNumericEscrowPaymentId(SERVICE_IDENTIFIER, disputeRequest.paymentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid escrow payment ID.";
    return errorResponse(400, message, correlationId, {
      paymentId: ["Must be a numeric escrow payment ID; x402 payment IDs are not escrow IDs."],
    });
  }
  const escrowPaymentId = BigInt(disputeRequest.paymentId);

  // --- Compute canonical request hash BEFORE /verify ---
  // This enables duplicate-charge prevention: if the exact same request was
  // already paid, return the existing result without calling /verify or /settle.
  const escrowChainIdStr = "11142220";
  const escrowContractAddr = getEscrowContractAddress(11142220);
  const receiptPayer = getPaymentPayloadPayer(paymentPayload) || "";

  const canonicalIdentity = {
    service: SERVICE_IDENTIFIER,
    escrowChainId: isTrack2Mode ? escrowChainIdStr : undefined,
    escrowContractAddress: isTrack2Mode ? escrowContractAddr : undefined,
    escrowPaymentId: disputeRequest.paymentId,
    payer: receiptPayer,
    paymentNetwork: settlementProvider.network,
    asset: resolvedToken,
    payTo: settlementProvider.payToAddress,
    amount: resolvedAmount,
    scheme: "exact",
    disputeReason: disputeRequest.disputeReason,
    requestedOutcome: disputeRequest.requestedOutcome,
  };

  const identityValidation = canonicalRequestIdentitySchema.safeParse(canonicalIdentity);
  if (!identityValidation.success) {
    return errorResponse(422, `Invalid request: ${identityValidation.error.message}`, correlationId);
  }

  const computedRequestHash = computeCanonicalRequestHash(identityValidation.data);

  // A cached result is safe to replay only when this request has the same
  // canonical identity as the original payment.
  const storedRequestHash = await store.getRequestHash(paymentId);
  if (storedRequestHash && storedRequestHash !== computedRequestHash) {
    return errorResponse(409, "Payment ID is already bound to a different request.", correlationId);
  }
  const cachedResult = await store.getResult(paymentId);
  if (cachedResult) {
    const response: Record<string, unknown> = {
      correlationId,
      settlement: cachedResult.receipt,
      settlementMode: settlementProvider.identifier,
      isTrack2Qualifying: isTrack2Mode,
      brief: cachedResult.brief ?? null,
    };
    if (!cachedResult.brief) {
      response.recoveryNote =
        "Settlement confirmed but brief generation was deferred. " +
        "The service fee has been paid; the brief will be regenerated on retry.";
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

  const previousError = await store.getError(paymentId);
  if (previousError) {
    return errorResponse(
      402,
      `Payment ${paymentId} previously failed: ${previousError}. Generate a new payment.`,
      correlationId,
    );
  }

  let pendingCreation;
  try {
    pendingCreation = await store.recordPending(paymentId, {
      service: SERVICE_IDENTIFIER,
      payerAddress: receiptPayer,
      payToAddress: paymentTerms.payToAddress,
      network: paymentTerms.network,
      chainId: paymentTerms.chainId,
      tokenAddress: paymentTerms.tokenAddress,
      tokenSymbol: "USDC",
      tokenDecimals: paymentTerms.tokenDecimals,
      amountAtomic: paymentTerms.amountAtomic,
      amountDisplay: paymentTerms.amountDisplay,
      escrowPaymentId: disputeRequest.paymentId,
      requestHash: computedRequestHash,
      disputeReason: disputeRequest.disputeReason,
      requestedOutcome: disputeRequest.requestedOutcome,
      authorizationNonce: String((isEIP3009 ? eipAuth?.nonce : x402PaymentData.nonce) ?? ""),
      authorizationDeadline: String((isEIP3009 ? eipAuth?.validBefore : x402PaymentData.deadline) ?? ""),
    });
  } catch (err) {
    if (!(err instanceof PaymentStoreConflictError)) throw err;
    const existing = await store.findByRequestHash(computedRequestHash);
    if (existing?.receipt) {
      return jsonSafe({
        correlationId,
        paymentId: existing.paymentId,
        status: existing.status,
        recoveredFromHash: true,
        settlement: existing.receipt,
        brief: existing.brief ?? null,
      }, { status: 200, headers: { "X-Payment-Id": existing.paymentId } });
    }
    return errorResponse(409, existing
      ? "An identical x402 request is already being settled."
      : err.message, correlationId);
  }

  // The unique payment/request-hash constraint chooses one owner. A loser
  // returns the existing result or an in-progress response and never calls a
  // settlement provider.
  if (!pendingCreation.created && pendingCreation.paymentId !== paymentId) {
    const existing = pendingCreation.record;
    if (existing.receipt) {
      return jsonSafe({
        correlationId,
        paymentId: pendingCreation.paymentId,
        status: existing.status,
        recoveredFromHash: true,
        settlement: existing.receipt,
        brief: existing.brief ?? null,
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
      }, { status: 200, headers: { "X-Payment-Id": pendingCreation.paymentId } });
    }
    return errorResponse(409, "An identical x402 request is already being settled.", correlationId);
  }

  if (pendingCreation.record.state === "settlement_submitted") {
    return errorResponse(409, "This x402 payment is already being settled. Retry after settlement confirmation.", correlationId);
  }

  // --- Step 5: Cryptographic verification via the active provider ---
  // The provider handles verification according to its mode:
  //  - local: EIP-712 signature recovery, balance/allowance/nonce checks
  //  - celo-facilitator: delegates to api.x402.celo.org /verify
  try {
    console.log(
      `[x402][${correlationId}] Verifying payment via ${settlementProvider.identifier} (network: ${settlementProvider.network})...`,
    );

    // Build PaymentRequirements from server-owned terms, never client amount.
    const verificationRequirements: PaymentRequirements = {
      scheme: "exact",
      network: paymentTerms.network as `${string}:${string}`,
      asset: paymentTerms.tokenAddress,
      amount: paymentTerms.amountAtomic,
      payTo: paymentTerms.payToAddress,
      maxTimeoutSeconds: 300,
      extra: isFacilitator ? { name: "USDC", version: "2" } : {},
    };

    // Build the @x402/core PaymentPayload envelope wrapping the raw payment details.
    const x402PaymentPayload: X402PaymentPayload = {
      x402Version: 2,
      accepted: verificationRequirements,
      payload: paymentPayload.payment as unknown as Record<string, unknown>,
    };

    const verifyResult = await settlementProvider.verifyPayment(
      x402PaymentPayload,
      verificationRequirements,
      paymentTerms,
    );

    if (!verifyResult.valid) {
      const reason = verifyResult.reason || "Unknown verification failure";
      console.warn(
        `[x402][${correlationId}] Payment verification failed: ${reason}`,
      );
      await store.recordFailed(paymentId, `Verification failed: ${reason}`);
      return jsonSafe(
        {
          correlationId,
          status: 402,
          error: `Payment verification failed: ${reason}`,
        },
        { status: 402 },
      );
    }

    if (verifyResult.payer && (
      !/^0x[0-9a-fA-F]{40}$/.test(verifyResult.payer) ||
      verifyResult.payer.toLowerCase() !== receiptPayer.toLowerCase()
    )) {
      throw new Error("Payment verifier returned a payer different from the signed payment payload.");
    }

    console.log(
      `[x402][${correlationId}] Verification succeeded. Payer: ${verifyResult.payer || "unknown"}`,
    );
    await store.recordAuthorizationVerified(paymentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Payment verification error: ${message}`,
    );
    await store.recordFailed(paymentId, `Verification error: ${message}`);
    return errorResponse(
      502,
      `Payment verification service unavailable: ${message}`,
      correlationId,
    );
  }

  // --- Step 7: Atomically claim the sole provider settlement attempt ---
  const settlementClaim = await store.claimSettlement(paymentId, computedRequestHash);
  if (!settlementClaim.claimed) {
    if (settlementClaim.receipt) {
      return jsonSafe({
        correlationId,
        paymentId,
        status: settlementClaim.brief ? "settled" : "paid_pending_brief",
        settlement: settlementClaim.receipt,
        brief: settlementClaim.brief ?? null,
        recovered: true,
      });
    }
    return errorResponse(409, "This x402 payment is already being settled. Retry after settlement confirmation.", correlationId);
  }

  // --- Step 8: Read on-chain payment data ---
  let rawPayment: RawPaymentStruct;
  try {
    const result = await readOnChainPayment(escrowPaymentId, correlationId);
    if (!result) {
       await store.recordSettlementFailed(paymentId, `Escrow payment #${escrowPaymentId} not found.`);
      return errorResponse(
        404,
        `Payment #${escrowPaymentId.toString()} not found on-chain.`,
        correlationId,
      );
    }
    rawPayment = result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await store.recordSettlementFailed(paymentId, `Failed to read payment data: ${message}`);
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
    await store.recordSettlementFailed(
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

  // --- Step 10: REAL on-chain settlement via the active provider ---
  // This is the critical step — funds must move on-chain before the brief
  // is delivered. Any failure here MUST NOT result in brief delivery.
  let settlementReceipt: SettlementReceipt;
  let facilitatorReceipt: FacilitatorSettlementReceipt | undefined;
  try {
    console.log(
      `[x402][${correlationId}] Executing on-chain settlement via ${settlementProvider.identifier} for ${paymentTerms.amountAtomic} atomic USDC...`,
    );

    const beforeSettlementValidation = verifyPaymentPayload(paymentPayload, paymentTerms);
    if (!beforeSettlementValidation.valid) {
      throw new Error(`Payment changed before settlement: ${beforeSettlementValidation.reason}`);
    }

    // Rebuild the same server-owned requirement immediately before settlement.
    const settlementRequirements: PaymentRequirements = {
      scheme: "exact",
      network: paymentTerms.network as `${string}:${string}`,
      asset: paymentTerms.tokenAddress,
      amount: paymentTerms.amountAtomic,
      payTo: paymentTerms.payToAddress,
      maxTimeoutSeconds: 300,
      extra: isFacilitator ? { name: "USDC", version: "2" } : {},
    };

    // Build the @x402/core PaymentPayload envelope.
    const x402SettlementPayload: X402PaymentPayload = {
      x402Version: 2,
      accepted: settlementRequirements,
      payload: paymentPayload.payment as unknown as Record<string, unknown>,
    };

    const settleResult = await settlementProvider.settlePayment(
      x402SettlementPayload,
      settlementRequirements,
      paymentTerms,
    );

    if (!settleResult.success) {
      const reason = settleResult.reason || "Settlement failed with no reason given";
      throw new Error(reason);
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(settleResult.txHash || "")) {
      throw new Error("Settlement provider returned an incomplete transaction receipt.");
    }
    if (settleResult.receipt && (
      !settleResult.receipt.settlementSuccess ||
      settleResult.receipt.network !== paymentTerms.network ||
      settleResult.receipt.token.toLowerCase() !== paymentTerms.tokenAddress.toLowerCase() ||
      settleResult.receipt.payTo.toLowerCase() !== paymentTerms.payToAddress.toLowerCase() ||
      settleResult.receipt.amount !== paymentTerms.amountAtomic ||
      (settleResult.receipt.payer && settleResult.receipt.payer.toLowerCase() !== receiptPayer.toLowerCase())
    )) {
      throw new Error("Settlement provider receipt does not match the server-configured USDC terms.");
    }

    // Capture the facilitator receipt for audit trail (only in facilitator mode).
    if (settleResult.receipt) {
      facilitatorReceipt = settleResult.receipt;
    }

    // Construct the SettlementReceipt from the provider result + payment details.
    // Use EIP-3009 authorization fields or Permit2 fields depending on payload shape.
    const receiptFrom = getPaymentPayloadPayer(paymentPayload) || "";
    settlementReceipt = {
      txHash: settleResult.txHash || "",
      blockNumber: BigInt(settleResult.blockNumber || 0),
      blockHash: "",
      status: "success" as const,
      from: receiptFrom,
      to: paymentTerms.payToAddress,
      amount: paymentTerms.amountAtomic,
      tokenAddress: paymentTerms.tokenAddress,
    };

    console.log(
      `[x402][${correlationId}] On-chain settlement confirmed: ${settlementReceipt.txHash}` +
      (settlementReceipt.blockNumber > BigInt(0) ? ` block ${settlementReceipt.blockNumber}` : " block pending"),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Settlement failed: ${message}`,
    );
    await store.recordSettlementFailed(paymentId, `Settlement failed: ${message}`);
    return errorResponse(
      502,
      `Payment settlement failed: ${message}`,
      correlationId,
    );
  }

  // --- Step 10b: Validate before persisting the settlement receipt ---
  // An incomplete/reverted/provider-mismatched receipt must never become a
  // paid record. This ordering is also important for durable idempotency.
  const escrowAddr = getEscrowContractAddress(11142220);
  if (!escrowAddr) {
    await store.recordSettlementFailed(paymentId, "Escrow contract address is not configured; settlement receipt safety check failed.");
    return errorResponse(
      500,
      "Escrow contract address is not configured. Settlement safety check failed.",
      correlationId,
    );
  }
  try {
    assertSettlementReceiptPersistable(settlementReceipt);
    if (
      settlementReceipt.to.toLowerCase() !== paymentTerms.payToAddress.toLowerCase() ||
      settlementReceipt.tokenAddress.toLowerCase() !== paymentTerms.tokenAddress.toLowerCase() ||
      settlementReceipt.amount !== paymentTerms.amountAtomic
    ) {
      throw new Error("Settlement receipt does not match the server-configured USDC terms.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid settlement receipt";
    await store.recordSettlementFailed(paymentId, `Settlement receipt rejected: ${message}`);
    return errorResponse(502, `Settlement receipt rejected: ${message}`, correlationId);
  }

  if (
    settlementReceipt.to.toLowerCase() === escrowAddr.toLowerCase()
  ) {
    return errorResponse(
      500,
      "CRITICAL: Settlement paid the escrow contract instead of the service wallet.",
      correlationId,
    );
  }

  // Persist only after all receipt checks pass. Mutation errors are allowed to
  // fail the request; they must never be logged and ignored.
  await store.recordSettlementReceipt(paymentId, settlementReceipt);

  // --- Step 12: Generate the dispute brief (AI with deterministic fallback) ---
  // ONLY reached after confirmed on-chain settlement. If generation throws,
  // the settlement receipt is already saved — the brief can be recovered.
  let genResult: AIGenerationResult | undefined;
  try {
    genResult = await generateAICaseBrief(
      {
        paymentId: disputeRequest.paymentId,
        disputeReason: disputeRequest.disputeReason,
        requestedOutcome: disputeRequest.requestedOutcome,
        evidenceReferences: disputeRequest.evidenceReferences,
        timelineEntries: disputeRequest.relevantTimelineEntries,
      },
      correlationId,
      true,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[x402][${correlationId}] Brief generation failed after settled payment: ${message}`,
      err instanceof Error ? err.stack : "",
    );
    // Return paid_pending_brief — brief can be regenerated on retry
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        brief: null,
        generationMode: "generation_failed",
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: `Brief generation deferred: ${message}. The service fee has been paid. Retry with the same payment ID to regenerate.`,
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

  if (!genResult) {
    return jsonSafe(
      {
        correlationId,
        settlement: settlementReceipt,
        brief: null,
        settlementMode: settlementProvider.identifier,
        isTrack2Qualifying: isTrack2Mode,
        error: "Brief generation did not produce a result. Retry with the same payment ID.",
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

  const aiBrief = genResult.brief;
  console.log(
    `[x402][${correlationId}] Brief generated: mode=${genResult.metadata.generationMode}, ` +
    `provider=${genResult.metadata.provider}, usedFallback=${genResult.usedFallback}`,
  );

  // --- Step 13: Attach brief to settlement and mark fully settled ---
  // The brief is stored as the AICaseBrief format alongside generation metadata.
  await store.recordBrief(paymentId, aiBrief as unknown as Parameters<typeof store.recordBrief>[1]);

  // --- Step 14: Return the response ---
  const response: DisputeBriefResponse = {
    correlationId,
    brief: aiBrief as unknown as DisputeBriefResponse["brief"],
    settlement: settlementReceipt,
  };

  return jsonSafe(
    {
      ...response,
      generationMode: genResult.metadata.generationMode,
      provider: genResult.metadata.provider,
      model: genResult.metadata.model,
      usedFallback: genResult.usedFallback,
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
  const walletSignature = request.headers.get("x-wallet-signature") || "";
  let signedMessage: string;
  try {
    signedMessage = decodeWalletAuthMessage(
      request.headers.get("x-wallet-message") || "",
    );
  } catch {
    // Malformed encoded message — fail closed.
    return false;
  }

  if (!walletAddress || !signedMessage || !walletSignature) return false;
  if (walletAddress.toLowerCase() !== requiredPayer.toLowerCase()) return false;

  const authResult = await verifyWalletSignature(walletAddress, signedMessage, walletSignature);
  return authResult.verified;
}

export async function GET(request: Request): Promise<Response> {
  const store = getPaymentStore();
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const txHash = url.searchParams.get("txHash");

  // Direct lookup by payment ID (UUID — not public, implicitly authenticated)
  if (paymentId) {
    const result = await store.getResult(paymentId);
    if (result) {
      return jsonSafe({
        paymentId,
        status: result.brief ? "settled" : "paid_pending_brief",
        settlement: result.receipt,
        brief: result.brief ?? null,
        recoveryNote: result.brief
          ? undefined
          : "Settlement confirmed but brief was not generated. Submit a POST with the same payment-id header to regenerate the brief at no additional cost.",
      });
    }
    const err = await store.getError(paymentId);
    if (err) {
      return jsonSafe({
        paymentId,
        status: "failed",
        error: err,
      }, { status: 402 });
    }
    return jsonSafe({
      error: `Payment identifier '${paymentId}' not found. It may have expired or never existed.`,
    }, { status: 404 });
  }

  // Search by transaction hash — security-restricted
  if (txHash) {
    const found = await store.findByTxHash(txHash);
    const consumed = await store.findConsumedTx(txHash);

    if (found) {
      const payer = found.record.receipt?.from;
      const isAuthenticated = payer
        ? await authenticateWalletFromHeaders(request, payer)
        : false;

      if (isAuthenticated) {
        return jsonSafe({
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
        consumedTx: consumed
          ? { consumedAt: consumed.consumedAt, legacyRecovery: consumed.legacyRecovery }
          : null,
        authRequired: "Authenticate with X-Wallet-Address, X-Wallet-Message, and X-Wallet-Signature headers to retrieve the full brief.",
      });
    }

    // Not in store — return what public info we have
    return jsonSafe({
      txHash,
      error: `No settlement record found for transaction hash '${txHash}'. The store is in-memory and may have been lost on server restart.`,
      consumedTx: consumed
        ? { consumedAt: consumed.consumedAt, legacyRecovery: consumed.legacyRecovery }
        : null,
    }, { status: 404 });
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, PAYMENT-SIGNATURE, X-Payment-Id",
    },
  });
}
