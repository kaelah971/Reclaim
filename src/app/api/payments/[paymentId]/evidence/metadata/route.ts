// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/evidence/metadata
//
// Persist cryptographically verified evidence metadata after a successful
// on-chain evidence submission.  The server independently verifies the
// manifest hash against the current on-chain evidenceReference (read via
// the canonical full escrow ABI).
//
// Chain-verified: only a caller who knows the exact manifest that was
// hashed and submitted on-chain can persist matching metadata.
//
// Body (JSON):
//   { title, description, type, relatedClaim, date, externalRef, pastedText, fileHash }
//   Optional chain scope: ?chainId= query param or body chainId/escrowChainId.
//   Defaults to Celo Sepolia (11142220); 42220 verifies against the Mainnet
//   escrow. Unsupported chains are rejected with UNSUPPORTED_CHAIN.
//
// Responses:
//   201 — metadata persisted
//   200 — idempotent (same evidence ref already stored)
//   400 — hash mismatch or invalid body
//   409 — reviewer review has begun; evidence is immutable
//   500 — internal error / chain read failure
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  persistVerifiedEvidenceMetadata,
  type EvidenceMetadataChainReader,
} from "@/lib/evidence/persistEvidenceMetadata";
import type { EvidenceFormData } from "@/lib/evidence/manifest";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import { getEscrowAddress } from "@/lib/contracts/addresses";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  celoMainnetChain,
  celoSepoliaChain,
  getCeloChain,
  isSupportedChain,
} from "@/lib/web3/chains";

/** Legacy Sepolia RPC preserved exactly for the default path. */
const LEGACY_SEPOLIA_RPC = "https://rpc.ankr.com/celo_sepolia";
const MAINNET_RPC_DEFAULT = "https://forno.celo.org";

function getRpcForChain(chainId: number): string {
  if (chainId === CELO_MAINNET_CHAIN_ID) {
    return process.env.NEXT_PUBLIC_CELO_MAINNET_RPC_URL || MAINNET_RPC_DEFAULT;
  }
  // Sepolia default path preserves the exact legacy endpoint when no env
  // override is set; env overrides remain supported for operators.
  return (
    process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    LEGACY_SEPOLIA_RPC
  );
}

/**
 * Resolve an explicit chainId from query (?chainId=) or body
 * (chainId / escrowChainId / chain_id). Defaults to Celo Sepolia to preserve
 * behavior. Validates against the canonical supported-chain mapping — the URL
 * chain alone is never trusted; the escrow address must resolve canonically.
 *
 * P4.3b hardening: when BOTH the query string and the body carry an explicit
 * chain and they disagree, the request is rejected with CONFLICTING_CHAIN
 * instead of silently preferring one binding — metadata must never be tied
 * to an ambiguous canonical payment+chain.
 */
function resolveEvidenceChain(
  request: NextRequest,
  body: unknown,
): { chainId: number; escrowAddress: `0x${string}` } | { error: Response } {
  let queryRaw: unknown = null;
  try {
    const url = new URL(request.url);
    queryRaw =
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId") ??
      null;
  } catch {
    queryRaw = null;
  }
  let bodyRaw: unknown = null;
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    bodyRaw = b.chainId ?? b.escrowChainId ?? b.chain_id ?? b.escrow_chain_id ?? null;
  }
  // Fail closed on ambiguous bindings: both sources explicit but different.
  const normalizedQuery =
    queryRaw === null || String(queryRaw).trim() === "" ? null : String(queryRaw).trim();
  const normalizedBody =
    bodyRaw === null ||
    bodyRaw === undefined ||
    (typeof bodyRaw === "string" && bodyRaw.trim() === "")
      ? null
      : bodyRaw;
  if (normalizedQuery !== null && normalizedBody !== null) {
    const queryNum = Number(normalizedQuery);
    const bodyNum =
      typeof normalizedBody === "number"
        ? normalizedBody
        : Number(String(normalizedBody).trim());
    if (
      Number.isSafeInteger(queryNum) &&
      Number.isSafeInteger(bodyNum) &&
      queryNum !== bodyNum
    ) {
      return {
        error: NextResponse.json(
          { error: "Conflicting chain scope in query and body.", code: "CONFLICTING_CHAIN" },
          { status: 400 },
        ),
      };
    }
  }
  const raw: unknown = normalizedQuery ?? normalizedBody;  let chainId: number = CELO_CHAIN_ID; // Sepolia default preserves existing behavior.
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return {
        error: NextResponse.json(
          { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
          { status: 400 },
        ),
      };
    }
    chainId = parsed;
  }
  if (!isSupportedChain(chainId)) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  const escrowAddress = getEscrowAddress(chainId);
  if (!escrowAddress) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  // Validate the chain resolves in the canonical mapping (never trust URL alone).
  const chainDefinition = getCeloChain(chainId);
  if (!chainDefinition) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  return { chainId, escrowAddress };
}

function createChainReader(chainId: number): EvidenceMetadataChainReader {
  const chainDefinition =
    getCeloChain(chainId) ??
    (chainId === CELO_MAINNET_CHAIN_ID ? celoMainnetChain : celoSepoliaChain);
  return createPublicClient({
    chain: chainDefinition,
    transport: http(getRpcForChain(chainId), { timeout: 10000 }),
  }) as unknown as EvidenceMetadataChainReader;
}

/**
 * Resolve an explicit chainId from the query string ONLY (?chainId= /
 * ?chain_id= / ?escrowChainId=). Defaults to Celo Sepolia to preserve
 * behavior. Used by the GET oracle so a metadata POST body can never
 * smuggle a conflicting chain scope into a read.
 */
function resolveEvidenceChainQueryOnly(
  request: NextRequest,
): { chainId: number; escrowAddress: `0x${string}` } | { error: Response } {
  let queryRaw: unknown = null;
  try {
    const url = new URL(request.url);
    queryRaw =
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId") ??
      null;
  } catch {
    queryRaw = null;
  }
  const normalized =
    queryRaw === null || String(queryRaw).trim() === "" ? null : String(queryRaw).trim();
  let chainId: number = CELO_CHAIN_ID; // Sepolia default preserves existing behavior.
  if (normalized !== null) {
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return {
        error: NextResponse.json(
          { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
          { status: 400 },
        ),
      };
    }
    chainId = parsed;
  }
  if (!isSupportedChain(chainId)) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  const escrowAddress = getEscrowAddress(chainId);
  if (!escrowAddress) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  const chainDefinition = getCeloChain(chainId);
  if (!chainDefinition) {
    return {
      error: NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      ),
    };
  }
  return { chainId, escrowAddress };
}

function isValidEvidenceFormData(body: unknown): body is EvidenceFormData {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.title === "string" &&
    typeof b.description === "string" &&
    typeof b.type === "string" &&
    typeof b.date === "string"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { paymentId } = await params;

    // P4.3b hardening: reject non-numeric payment ids with 400 instead of
    // surfacing a 500 from the on-chain BigInt conversion.
    if (!paymentId || !/^\d+$/.test(paymentId)) {
      return NextResponse.json(
        { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    // Parse body
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Malformed JSON body.", code: "INVALID_JSON" }, { status: 400 });
    }

    if (!isValidEvidenceFormData(body)) {
      return NextResponse.json({ error: "Invalid evidence form data.", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const chainResolution = resolveEvidenceChain(request, body);
    if ("error" in chainResolution) return chainResolution.error;
    const { chainId, escrowAddress } = chainResolution;
    const chainReader = createChainReader(chainId);

    const result = await persistVerifiedEvidenceMetadata({
      chainReader,
      store: getSupabaseClient(),
      escrowAddress,
      escrowChainId: String(chainId),
      paymentId,
      data: body,
    });

    switch (result.status) {
      case "already_existed":
        return NextResponse.json({
          id: result.rowId,
          evidenceReference: result.evidenceReference,
          alreadyExisted: true,
        }, { status: 200 });

      case "persisted":
        return NextResponse.json({
          id: result.rowId,
          paymentId,
          evidenceReference: result.evidenceReference,
          persisted: true,
        }, { status: 201 });

      case "review_locked":
        return NextResponse.json({
          error: result.detail ?? "Reviewer review has begun; evidence metadata is immutable.",
          code: "EVIDENCE_REVIEW_LOCKED",
        }, { status: 409 });

      case "hash_mismatch":
        return NextResponse.json({
          error: "Evidence manifest hash does not match the current on-chain evidence reference.",
          code: "HASH_MISMATCH",
          details: { computed: result.detail, onChain: result.evidenceReference },
        }, { status: 400 });

      case "insert_failed":
        return NextResponse.json({
          error: result.detail ?? "Failed to persist verified evidence metadata.",
          code: "PERSISTENCE_FAILED",
        }, { status: 500 });

      default:
        return NextResponse.json({
          error: result.detail ?? "Failed to read the current on-chain evidence reference.",
          code: "CHAIN_READ_FAILED",
        }, { status: 500 });
    }

  } catch (err) {
    console.error(`[evidence-metadata][${correlationId}]`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/payments/[paymentId]/evidence/metadata?chainId=
//
// Hash-only durability oracle (P6.4E): reports whether verified evidence
// metadata is persisted for the CURRENT on-chain evidenceReference.
//
// Returns 200 `{ found, evidenceReference }` where `found` is true only
// when a row exists in evidence_metadata for (paymentId, chainId, escrow
// address lowercase, on-chain reference) AND is_current.
//
// Returns NO plaintext (hash + boolean only — nothing beyond public chain
// state), so no party auth is required. The POST hash-equality rule is
// unchanged: only a caller who knows the exact submitted manifest can
// persist it.
//
// Responses:
//   200 — { found, evidenceReference }
//   400 — INVALID_PAYMENT_ID / UNSUPPORTED_CHAIN
//   500 — CHAIN_READ_FAILED
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const { paymentId } = await params;

    if (!paymentId || !/^\d+$/.test(paymentId)) {
      return NextResponse.json(
        { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    const chainResolution = resolveEvidenceChainQueryOnly(request);
    if ("error" in chainResolution) return chainResolution.error;
    const { chainId, escrowAddress } = chainResolution;
    const chainReader = createChainReader(chainId);

    let onChainReference: `0x${string}`;
    try {
      const payment = await chainReader.readContract({
        address: escrowAddress,
        abi: protectedPaymentEscrowABI,
        functionName: "getPayment",
        args: [BigInt(paymentId)],
      });
      onChainReference = payment.evidenceReference;
    } catch {
      return NextResponse.json(
        {
          error: "Failed to read the current on-chain evidence reference.",
          code: "CHAIN_READ_FAILED",
        },
        { status: 500 },
      );
    }

    const normalizedReference = onChainReference.toLowerCase();

    const { data, error } = await getSupabaseClient()
      .from("evidence_metadata")
      .select("id")
      .eq("escrow_payment_id", paymentId)
      .eq("escrow_chain_id", String(chainId))
      .eq("escrow_contract_address", escrowAddress.toLowerCase())
      .eq("evidence_reference", normalizedReference)
      .eq("is_current", true)
      .maybeSingle();

    return NextResponse.json(
      {
        found: !error && !!data,
        evidenceReference: normalizedReference,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(`[evidence-metadata-oracle][${correlationId}]`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    }, { status: 500 });
  }
}
