// ---------------------------------------------------------------------------
// POST /api/payments/[paymentId]/evidence/challenge
//
// Issues a wallet challenge for party-scoped plaintext evidence reads:
//   body { chainId?, escrowChainId?, chain_id?, wallet, purpose? }
//   Optional escrow scope (P7.2): ?escrow= query or escrow/escrowAddress
//   body — MUST be allowlisted for the chain (fail closed UNKNOWN_ESCROW).
//   → 200 { challengeId, message, expiresAt, paymentId, chainId,
//           escrowContractAddress, wallet }
//
// The raw challengeId is a 256-bit secret; ONLY its SHA-256 hash is stored.
// The exact-ordered message binds purpose, paymentId, chainId, wallet,
// canonical escrow contract, expiry, and challengeId. No chain txs, no keys.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { getEscrowAddress } from "@/lib/contracts/addresses";
import { pickEscrowParam } from "@/lib/contracts/escrowIdentity";
import { isSupportedChain, CELO_CHAIN_ID } from "@/lib/web3/chains";
import {
  EVIDENCE_READ_PURPOSE,
  isValidEvidencePaymentId,
  isValidEvidenceWallet,
  issueEvidenceChallenge,
} from "@/lib/evidence/partyAuth";

function readQueryChain(request: NextRequest): unknown {
  try {
    const url = new URL(request.url);
    return (
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId") ??
      null
    );
  } catch {
    return null;
  }
}

/** P7.2: optional explicit escrow (?escrow= / ?escrowAddress= query only). */
function readQueryEscrow(request: NextRequest): unknown {
  try {
    const url = new URL(request.url);
    return (
      url.searchParams.get("escrow") ??
      url.searchParams.get("escrowAddress") ??
      url.searchParams.get("escrowContractAddress") ??
      null
    );
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
    if (!paymentId || !isValidEvidencePaymentId(paymentId)) {
      return NextResponse.json(
        { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
        { status: 400 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") body = raw as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    // Purpose is bound; only "evidence-read" is issued here.
    const purposeRaw = body.purpose;
    if (
      purposeRaw !== undefined &&
      purposeRaw !== null &&
      String(purposeRaw) !== EVIDENCE_READ_PURPOSE
    ) {
      return NextResponse.json(
        { error: "Invalid purpose.", code: "INVALID_PURPOSE" },
        { status: 400 },
      );
    }

    const walletRaw = body.wallet ?? body.walletAddress ?? body.signerAddress;
    const wallet = typeof walletRaw === "string" ? walletRaw.trim() : "";
    if (!wallet || !isValidEvidenceWallet(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address.", code: "INVALID_WALLET" },
        { status: 400 },
      );
    }

    // Chain scope: explicit query/body or Sepolia default (preserves behavior).
    // Both explicit but disagreeing → CONFLICTING_CHAIN (mirror metadata route).
    const queryRaw = readQueryChain(request);
    const bodyRaw =
      body.chainId ?? body.escrowChainId ?? body.chain_id ?? body.escrow_chain_id ?? null;
    const normalizedQuery =
      queryRaw === null || String(queryRaw).trim() === "" ? null : String(queryRaw).trim();
    const normalizedBody =
      bodyRaw === null ||
      bodyRaw === undefined ||
      (typeof bodyRaw === "string" && bodyRaw.trim() === "")
        ? null
        : bodyRaw;
    if (normalizedQuery !== null && normalizedBody !== null) {
      const q = Number(normalizedQuery);
      const b =
        typeof normalizedBody === "number"
          ? normalizedBody
          : Number(String(normalizedBody).trim());
      if (Number.isSafeInteger(q) && Number.isSafeInteger(b) && q !== b) {
        return NextResponse.json(
          { error: "Conflicting chain scope in query and body.", code: "CONFLICTING_CHAIN" },
          { status: 400 },
        );
      }
    }
    const rawChain = normalizedQuery ?? normalizedBody;
    let chainId: number = CELO_CHAIN_ID;
    if (rawChain !== null && rawChain !== undefined && String(rawChain).trim() !== "") {
      const parsed = typeof rawChain === "number" ? rawChain : Number(String(rawChain).trim());
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || !isSupportedChain(parsed)) {
        return NextResponse.json(
          { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
          { status: 400 },
        );
      }
      chainId = parsed;
    }
    if (!isSupportedChain(chainId) || !getEscrowAddress(chainId)) {
      return NextResponse.json(
        { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
        { status: 400 },
      );
    }

    // P7.2: optional explicit escrow (?escrow= query or escrow/escrowAddress
    // body) — allowlist-validated inside issueEvidenceChallenge (fail closed
    // with UNKNOWN_ESCROW). Absent → canonical default (unchanged).
    const escrowAddress = pickEscrowParam(
      readQueryEscrow(request),
      body.escrow ?? body.escrowAddress ?? body.escrowContractAddress ?? body.escrow_contract_address ?? null,
    );

    const issued = await issueEvidenceChallenge({
      paymentId,
      chainId,
      wallet,
      escrowAddress: escrowAddress ?? undefined,
    });

    return NextResponse.json(
      {
        challengeId: issued.challengeId,
        message: issued.message,
        expiresAt: issued.expiresAt,
        paymentId: issued.paymentId,
        chainId: issued.chainId,
        escrowContractAddress: issued.escrowContractAddress,
        wallet: issued.wallet,
        purpose: EVIDENCE_READ_PURPOSE,
      },
      { status: 200 },
    );
  } catch (err) {
    const code =
      err instanceof Error && "code" in err
        ? String((err as Record<string, unknown>).code)
        : "INTERNAL_ERROR";
    if (code === "UNSUPPORTED_CHAIN" || code === "UNKNOWN_ESCROW") {
      return NextResponse.json(
        {
          error:
            code === "UNKNOWN_ESCROW"
              ? "Unknown escrow contract for this chain."
              : "Unsupported chain.",
          code,
        },
        { status: 400 },
      );
    }
    console.error("[evidence-challenge]", err);
    return NextResponse.json(
      { error: "Failed to issue the evidence challenge.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
