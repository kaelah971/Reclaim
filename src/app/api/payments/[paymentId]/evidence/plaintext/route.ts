// ---------------------------------------------------------------------------
// /api/payments/[paymentId]/evidence/plaintext
//
// Party-scoped plaintext evidence read (P4.3D). Anonymous/public must NEVER
// reach this data via receipt/review-packet — those routes are hash-only.
//
//   POST (preferred — signature in body, never logged in URLs):
//     body { challengeId, signature, chainId, wallet }
//   GET (alias — same contract via query params):
//     ?challengeId= &signature= &chainId= &wallet=
//
// Flow: load durable challenge by SHA-256 hash → purpose/payment/chain/wallet
// + canonical-contract binding → expiry + single-use checks → reconstruct the
// EXACT server-authoritative message → recover signer with viem → signer ==
// challenged wallet → live on-chain getPayment from the canonical escrow for
// that chain → signer == client OR worker → atomic single-use consume → only
// then return plaintext evidence. Every failure returns an explicit 401/403
// code — never an empty success.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { SupabaseEvidenceReader } from "@/lib/evidence/reader";
import {
  consumeEvidenceChallenge,
  hashEvidenceChallenge,
  isValidEvidencePaymentId,
  verifyEvidenceChallenge,
} from "@/lib/evidence/partyAuth";

interface PlaintextRequest {
  challengeId: string;
  signature: string;
  chainId: unknown;
  wallet: string;
}

function readGetParams(request: NextRequest): PlaintextRequest {
  let challengeId = "";
  let signature = "";
  let chainId: unknown = null;
  let wallet = "";
  try {
    const url = new URL(request.url);
    challengeId = url.searchParams.get("challengeId") ?? url.searchParams.get("challenge_id") ?? "";
    signature = url.searchParams.get("signature") ?? url.searchParams.get("walletSignature") ?? "";
    const rawChain =
      url.searchParams.get("chainId") ??
      url.searchParams.get("chain_id") ??
      url.searchParams.get("escrowChainId") ??
      null;
    chainId = rawChain;
    wallet =
      url.searchParams.get("wallet") ??
      url.searchParams.get("walletAddress") ??
      url.searchParams.get("signerAddress") ??
      "";
  } catch {
    // fall through with empty values → validated below
  }
  return { challengeId, signature, chainId, wallet };
}

function parseChainId(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function handlePlaintext(
  paymentId: string,
  input: PlaintextRequest,
): Promise<Response> {
  if (!paymentId || !isValidEvidencePaymentId(paymentId)) {
    return NextResponse.json(
      { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
      { status: 400 },
    );
  }
  const challengeId = (input.challengeId ?? "").trim();
  const signature = (input.signature ?? "").trim();
  const wallet = (input.wallet ?? "").trim();
  const chainId = parseChainId(input.chainId);

  // Anonymous (no challenge/signature) is denied explicitly — never empty.
  if (!challengeId || !signature) {
    return NextResponse.json(
      { error: "Evidence challenge and signature are required.", code: "CHALLENGE_REQUIRED" },
      { status: 401 },
    );
  }
  if (!wallet) {
    return NextResponse.json(
      { error: "Wallet address is required.", code: "INVALID_WALLET" },
      { status: 400 },
    );
  }
  if (chainId === null) {
    return NextResponse.json(
      { error: "Chain id is required.", code: "MISSING_CHAIN" },
      { status: 400 },
    );
  }

  const verification = await verifyEvidenceChallenge({
    paymentId,
    chainId,
    wallet,
    challengeId,
    signature,
  });

  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, code: verification.code },
      { status: verification.status },
    );
  }

  // Atomic single-use consume — the winner of this UPDATE is the only caller
  // that may see plaintext. A replay (concurrent or sequential) gets 401.
  const consumed = await consumeEvidenceChallenge({
    challengeHash: hashEvidenceChallenge(challengeId),
  });
  if (!consumed) {
    return NextResponse.json(
      { error: "Evidence challenge has already been used.", code: "CHALLENGE_CONSUMED" },
      { status: 401 },
    );
  }

  // Only now — after binding, signature, live party check, and consume —
  // return the plaintext delivery evidence for P4.4 reuse.
  const reader = new SupabaseEvidenceReader();
  const facts = await reader.getEvidenceMetadata(paymentId, String(chainId));

  return NextResponse.json(
    {
      found: true,
      paymentId,
      chainId,
      wallet: wallet.toLowerCase(),
      evidence: {
        title: facts.title,
        claim: facts.relatedClaim,
        description: facts.description,
        pastedText: facts.pastedText,
        date: facts.evidenceDate,
        externalRef: facts.externalRef,
        evidenceType: facts.evidenceType,
        fileHash: facts.fileHash,
        fileCount: facts.fileCount,
        evidenceReference: facts.evidenceReference,
        submittedAt: facts.latestUpdateTimestamp
          ? new Date(facts.latestUpdateTimestamp).toISOString()
          : null,
        submitter: facts.submitterAddress,
        availability: facts.substantiveEvidence ? "package_available" : null,
      },
    },
    { status: 200 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
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
    return await handlePlaintext(paymentId, {
      challengeId: typeof body.challengeId === "string" ? body.challengeId : "",
      signature:
        typeof body.signature === "string"
          ? body.signature
          : typeof body.walletSignature === "string"
            ? body.walletSignature
            : "",
      chainId:
        body.chainId ?? body.escrowChainId ?? body.chain_id ?? body.escrow_chain_id ?? null,
      wallet:
        typeof body.wallet === "string"
          ? body.wallet
          : typeof body.walletAddress === "string"
            ? body.walletAddress
            : typeof body.signerAddress === "string"
              ? body.signerAddress
              : "",
    });
  } catch (err) {
    console.error("[evidence-plaintext]", err);
    return NextResponse.json(
      { error: "Failed to read the evidence.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  try {
    const { paymentId } = await params;
    return await handlePlaintext(paymentId, readGetParams(request));
  } catch (err) {
    console.error("[evidence-plaintext]", err);
    return NextResponse.json(
      { error: "Failed to read the evidence.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
