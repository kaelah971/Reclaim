// ---------------------------------------------------------------------------
// P4.3D: Party-scoped evidence auth — wallet-challenge model (SERVER-ONLY)
//
// Anonymous/public may see payment state + evidence hash ONLY. Plaintext
// delivery evidence is readable ONLY by the on-chain client/worker via a
// wallet challenge:
//
//   POST /api/payments/[paymentId]/evidence/challenge
//     → issues { challengeId, message, expiresAt } for
//       { paymentId, chainId, wallet, purpose: "evidence-read" }
//   POST /api/payments/[paymentId]/evidence/plaintext (GET alias supported)
//     → consumes { challengeId, signature, chainId, wallet } and, only after
//       exact message binding + ECDSA recovery + live on-chain party check +
//       atomic single-use consume, returns plaintext evidence.
//
// Security properties:
//   - Random 256-bit challengeId (raw secret); SHA-256 hash stored, never raw.
//   - Short expiry (5 min), durable single-use row, purpose-bound.
//   - Atomic consume: single UPDATE ... WHERE consumed_at IS NULL
//     AND expires_at > now() RETURNING (mirrors reviewer nonce consume).
//   - Challenge message binds purpose, paymentId, chainId, wallet (lowercased),
//     escrow contract (canonical mapping), expiry, challengeId — exact-ordered,
//     human-readable, following resolution-agent message discipline.
//   - Chain supported via canonical mapping only (Sepolia + Mainnet).
//   - Signer recovered with viem recoverMessageAddress (same as reviewer/auth).
//   - Live on-chain getPayment via canonical escrow; signer == client OR worker.
//   - No server private key. No trust in URL role claims. No replay.
//   - No cross-payment / cross-chain reuse (challenge bound to all three +
//     contract).
//
// Dedicated table payment_evidence_auth_challenges is used for isolation —
// reviewer nonce semantics are NOT overloaded.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "crypto";
import { recoverMessageAddress } from "viem";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getEscrowAddress } from "@/lib/contracts/addresses";
import { getEscrowDeployment } from "@/lib/contracts/escrowIdentity";
import { isSupportedChain } from "@/lib/web3/chains";
import { CeloEscrowCaseReader } from "@/lib/resolution-agent/api/escrow-reader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Domain line for the exact-ordered challenge message. */
export const EVIDENCE_AUTH_DOMAIN = "Reclaim Evidence Access v1" as const;

/** The only purpose this challenge model issues. */
export const EVIDENCE_READ_PURPOSE = "evidence-read" as const;

/** Challenge TTL: 5 minutes (mirrors reviewer nonce expiry). */
export const EVIDENCE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Table holding durable single-use challenges (see migration 00017). */
export const EVIDENCE_CHALLENGE_TABLE = "payment_evidence_auth_challenges" as const;

const PAYMENT_PATTERN = /^[0-9]+$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const CHALLENGE_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to unit-test without mocks)
// ---------------------------------------------------------------------------

/** Generate a random 256-bit challengeId (`0x` + 64 lowercase hex). */
export function generateEvidenceChallengeId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * SHA-256 hash of the raw challengeId string (UTF-8), `0x`-prefixed lowercase.
 * The raw challengeId is NEVER persisted — only this hash.
 */
export function hashEvidenceChallenge(challengeId: string): string {
  const hex = createHash("sha256").update(challengeId, "utf8").digest("hex");
  return `0x${hex.toLowerCase()}`;
}

export interface EvidenceReadMessageParams {
  paymentId: string;
  chainId: string | number;
  escrowContract: string;
  wallet: string;
  challengeId: string;
  /** ISO-8601 expiry string, exactly as issued (toISOString). */
  expiresAt: string;
}

/**
 * Build the exact-ordered human-readable challenge message. Field order is
 * part of the security contract — parsers reject missing/unknown/reordered
 * fields and CR bytes (resolution-agent discipline).
 */
export function buildEvidenceReadMessage(params: EvidenceReadMessageParams): string {
  return [
    EVIDENCE_AUTH_DOMAIN,
    `Purpose: ${EVIDENCE_READ_PURPOSE}`,
    `Payment ID: ${params.paymentId}`,
    `Chain ID: ${String(params.chainId)}`,
    `Escrow Contract: ${params.escrowContract.toLowerCase()}`,
    `Wallet: ${params.wallet.toLowerCase()}`,
    `Challenge ID: ${params.challengeId}`,
    `Expires At: ${params.expiresAt}`,
  ].join("\n");
}

export interface ParsedEvidenceReadMessage {
  purpose: string;
  paymentId: string;
  chainId: string;
  escrowContract: string;
  wallet: string;
  challengeId: string;
  expiresAt: string;
}

/**
 * Strict parser for the challenge message. Rejects CR bytes, wrong domain,
 * missing/unknown/reordered fields, and malformed values. There is no
 * substring matching — every field is parsed exactly once.
 */
export function parseEvidenceReadMessage(message: string): ParsedEvidenceReadMessage {
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("Malformed evidence auth message: message is empty.");
  }
  if (/\r/.test(message)) {
    throw new Error("Malformed evidence auth message: CR bytes are not allowed.");
  }
  const lines = message.split("\n");
  if (lines[0] !== EVIDENCE_AUTH_DOMAIN) {
    throw new Error("Malformed evidence auth message: invalid domain.");
  }
  const expectedKeys = [
    "Purpose",
    "Payment ID",
    "Chain ID",
    "Escrow Contract",
    "Wallet",
    "Challenge ID",
    "Expires At",
  ];
  if (lines.length - 1 !== expectedKeys.length) {
    throw new Error("Malformed evidence auth message: wrong field count.");
  }
  const values: Record<string, string> = {};
  lines.slice(1).forEach((line, index) => {
    if (/[\u0000-\u001F\u007F]/.test(line)) {
      throw new Error("Malformed evidence auth message: control bytes are not allowed.");
    }
    const match = /^([^:]+): ([^\n]*)$/.exec(line);
    if (!match || match[1] !== expectedKeys[index]) {
      throw new Error("Malformed evidence auth message: missing, unknown, or out-of-order fields.");
    }
    if (!match[2] || match[2].length === 0) {
      throw new Error(`Malformed evidence auth message: empty value for ${match[1]}.`);
    }
    values[match[1]] = match[2];
  });
  if (values["Purpose"] !== EVIDENCE_READ_PURPOSE) {
    throw new Error("Malformed evidence auth message: invalid purpose.");
  }
  if (!PAYMENT_PATTERN.test(values["Payment ID"])) {
    throw new Error("Malformed evidence auth message: invalid payment ID.");
  }
  if (!/^[0-9]+$/.test(values["Chain ID"])) {
    throw new Error("Malformed evidence auth message: invalid chain ID.");
  }
  if (!ADDRESS_PATTERN.test(values["Escrow Contract"])) {
    throw new Error("Malformed evidence auth message: invalid escrow contract.");
  }
  if (!ADDRESS_PATTERN.test(values["Wallet"])) {
    throw new Error("Malformed evidence auth message: invalid wallet.");
  }
  if (!CHALLENGE_PATTERN.test(values["Challenge ID"])) {
    throw new Error("Malformed evidence auth message: invalid challenge ID.");
  }
  const expiresMs = Date.parse(values["Expires At"]);
  if (Number.isNaN(expiresMs)) {
    throw new Error("Malformed evidence auth message: invalid expiry.");
  }
  return {
    purpose: values["Purpose"],
    paymentId: values["Payment ID"],
    chainId: values["Chain ID"],
    escrowContract: values["Escrow Contract"].toLowerCase(),
    wallet: values["Wallet"].toLowerCase(),
    challengeId: values["Challenge ID"],
    expiresAt: values["Expires At"],
  };
}

export function isValidEvidencePaymentId(paymentId: string): boolean {
  return PAYMENT_PATTERN.test(paymentId);
}

export function isValidEvidenceWallet(wallet: string): boolean {
  return ADDRESS_PATTERN.test(wallet);
}

export function isValidEvidenceChallengeId(challengeId: string): boolean {
  return CHALLENGE_PATTERN.test(challengeId);
}

// ---------------------------------------------------------------------------
// Server helpers — challenge issuance + verification (Supabase + chain)
// ---------------------------------------------------------------------------

export interface EvidenceChallengeRow {
  id: string;
  escrow_payment_id: string;
  escrow_chain_id: number;
  escrow_contract_address: string;
  wallet_address: string;
  challenge_hash: string;
  purpose: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

/** Resolve + validate the canonical escrow contract for a chain. */
export function resolveEvidenceEscrow(chainId: number): `0x${string}` | null {
  if (!isSupportedChain(chainId)) return null;
  return getEscrowAddress(chainId) ?? null;
}

/**
 * P7.2: resolve + validate an explicit escrow contract for a chain.
 * Absent escrowAddress → canonical default (existing behavior unchanged).
 * Present → MUST be allowlisted for the chain (fail closed, never fall
 * back). Throws a coded UNKNOWN_ESCROW error on unknown contracts.
 */
export function resolveEvidenceEscrowFor(
  chainId: number,
  escrowAddress?: string | null,
): `0x${string}` {
  if (
    escrowAddress === undefined ||
    escrowAddress === null ||
    String(escrowAddress).trim() === ""
  ) {
    const canonical = resolveEvidenceEscrow(chainId);
    if (!canonical) {
      throw Object.assign(new Error("Unsupported chain."), {
        code: "UNSUPPORTED_CHAIN",
      });
    }
    return canonical;
  }
  try {
    return getEscrowDeployment({
      chainId,
      escrowAddress: String(escrowAddress),
    }).address;
  } catch {
    throw Object.assign(
      new Error(
        `Unknown escrow contract ${String(escrowAddress).trim()} on chain ${chainId}.`,
      ),
      { code: "UNKNOWN_ESCROW" },
    );
  }
}

export interface IssueChallengeInput {
  paymentId: string;
  chainId: number;
  wallet: string;
  /** P7.2: optional explicit escrow (allowlisted, fail closed). */
  escrowAddress?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
  now?: number;
}

export interface IssuedChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
  paymentId: string;
  chainId: number;
  escrowContractAddress: string;
  wallet: string;
}

/**
 * Issue a new evidence-read challenge. Validates canonical chain/contract
 * binding, persists ONLY the SHA-256 hash, and returns the raw challengeId
 * + exact message for the wallet to sign.
 */
export async function issueEvidenceChallenge(input: IssueChallengeInput): Promise<IssuedChallenge> {
  const { paymentId, chainId, wallet } = input;
  const supabase = input.supabase ?? getSupabaseClient();
  const now = input.now ?? Date.now();

  // P7.2: absent escrowAddress → canonical default (unchanged); explicit
  // escrow is allowlist-validated (throws coded UNKNOWN_ESCROW/UNSUPPORTED).
  const escrowAddress = resolveEvidenceEscrowFor(chainId, input.escrowAddress);

  const challengeId = generateEvidenceChallengeId();
  const challengeHash = hashEvidenceChallenge(challengeId);
  const expiresAt = new Date(now + EVIDENCE_CHALLENGE_TTL_MS).toISOString();
  const normalizedWallet = wallet.toLowerCase();
  const normalizedContract = escrowAddress.toLowerCase();
  const message = buildEvidenceReadMessage({
    paymentId,
    chainId,
    escrowContract: normalizedContract,
    wallet: normalizedWallet,
    challengeId,
    expiresAt,
  });

  const { error } = await supabase.from(EVIDENCE_CHALLENGE_TABLE).insert({
    escrow_payment_id: paymentId,
    escrow_chain_id: chainId,
    escrow_contract_address: normalizedContract,
    wallet_address: normalizedWallet,
    challenge_hash: challengeHash.toLowerCase(),
    purpose: EVIDENCE_READ_PURPOSE,
    expires_at: expiresAt,
  });

  if (error) {
    throw Object.assign(
      new Error(`Failed to persist evidence challenge: ${error.message}`),
      { code: "PERSISTENCE_FAILED" },
    );
  }

  return {
    challengeId,
    message,
    expiresAt,
    paymentId,
    chainId,
    escrowContractAddress: normalizedContract,
    wallet: normalizedWallet,
  };
}

export interface VerifyChallengeInput {
  paymentId: string;
  chainId: number;
  wallet: string;
  challengeId: string;
  signature: string;
  /** P7.2: optional explicit escrow (allowlisted, fail closed). */
  escrowAddress?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  escrowReader?: any;
  signatureVerifier?: (message: string, signature: string) => Promise<string>;
  now?: number;
}

export type VerifyChallengeResult =
  | { ok: true; row: EvidenceChallengeRow; signer: string; message: string }
  | { ok: false; code: string; error: string; status: number };

function deny(code: string, error: string, status: number): VerifyChallengeResult {
  return { ok: false, code, error, status };
}

/**
 * Verify a consumed challenge WITHOUT consuming it (cryptographic + binding
 * + on-chain party checks). The caller must atomically consume AFTER this
 * succeeds via consumeEvidenceChallenge(). Kept separate so routes can
 * fail closed step-by-step with explicit codes.
 */
export async function verifyEvidenceChallenge(input: VerifyChallengeInput): Promise<VerifyChallengeResult> {
  const {
    paymentId,
    chainId,
    wallet,
    challengeId,
    signature,
  } = input;
  const supabase = input.supabase ?? getSupabaseClient();
  const now = input.now ?? Date.now();

  if (!isValidEvidencePaymentId(paymentId)) {
    return deny("INVALID_PAYMENT_ID", "Invalid payment id.", 400);
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isSupportedChain(chainId)) {
    return deny("UNSUPPORTED_CHAIN", "Unsupported chain.", 400);
  }
  if (!isValidEvidenceWallet(wallet)) {
    return deny("INVALID_WALLET", "Invalid wallet address.", 400);
  }
  if (!isValidEvidenceChallengeId(challengeId)) {
    return deny("INVALID_CHALLENGE", "Invalid challenge id.", 401);
  }
  if (!signature || signature === "0x") {
    return deny("SIGNATURE_INVALID", "Wallet signature is missing or empty.", 401);
  }

  const canonicalContract = resolveEvidenceEscrow(chainId);
  if (!canonicalContract) {
    return deny("UNSUPPORTED_CHAIN", "Unsupported chain.", 400);
  }
  // P7.2: absent escrowAddress → canonical default (existing behavior
  // unchanged); explicit escrow is allowlist-validated, fail closed.
  let expectedContract = canonicalContract;
  if (
    input.escrowAddress !== undefined &&
    input.escrowAddress !== null &&
    String(input.escrowAddress).trim() !== ""
  ) {
    try {
      expectedContract = getEscrowDeployment({
        chainId,
        escrowAddress: String(input.escrowAddress),
      }).address;
    } catch {
      return deny(
        "UNKNOWN_ESCROW",
        "Unknown escrow contract for this chain.",
        400,
      );
    }
  }

  const challengeHash = hashEvidenceChallenge(challengeId).toLowerCase();

  // Load the durable challenge row by hash (raw nonce never stored).
  let row: EvidenceChallengeRow | null = null;
  try {
    const { data, error } = await supabase
      .from(EVIDENCE_CHALLENGE_TABLE)
      .select("*")
      .eq("challenge_hash", challengeHash)
      .maybeSingle();
    if (error) {
      return deny("INTERNAL_ERROR", "Failed to load the evidence challenge.", 500);
    }
    row = (data as EvidenceChallengeRow | null) ?? null;
  } catch {
    return deny("INTERNAL_ERROR", "Failed to load the evidence challenge.", 500);
  }

  if (!row) {
    return deny("CHALLENGE_NOT_FOUND", "Evidence challenge not found.", 401);
  }
  if (row.purpose !== EVIDENCE_READ_PURPOSE) {
    return deny("INVALID_PURPOSE", "Evidence challenge purpose mismatch.", 401);
  }
  // Purpose-bound + payment/chain/wallet binding — no cross-payment reuse.
  if (row.escrow_payment_id !== paymentId) {
    return deny("CHALLENGE_PAYMENT_MISMATCH", "Challenge is not bound to this payment.", 403);
  }
  if (Number(row.escrow_chain_id) !== chainId) {
    return deny("CHALLENGE_CHAIN_MISMATCH", "Challenge is not bound to this chain.", 403);
  }
  if (String(row.wallet_address).toLowerCase() !== wallet.toLowerCase()) {
    return deny("CHALLENGE_WALLET_MISMATCH", "Challenge is not bound to this wallet.", 403);
  }
  // Contract must still resolve to the expected (canonical or explicit
  // allowlisted) escrow — never trust a stale row.
  if (String(row.escrow_contract_address).toLowerCase() !== expectedContract.toLowerCase()) {
    return deny("CHALLENGE_CONTRACT_MISMATCH", "Challenge contract does not match the canonical escrow.", 403);
  }
  if (row.consumed_at !== null) {
    return deny("CHALLENGE_CONSUMED", "Evidence challenge has already been used.", 401);
  }
  const expiresMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresMs) || expiresMs <= now) {
    return deny("CHALLENGE_EXPIRED", "Evidence challenge has expired.", 401);
  }

  // Reconstruct the EXACT server-authoritative message (never trust a
  // client-supplied message string).
  const expectedMessage = buildEvidenceReadMessage({
    paymentId: row.escrow_payment_id,
    chainId: Number(row.escrow_chain_id),
    escrowContract: String(row.escrow_contract_address).toLowerCase(),
    wallet: String(row.wallet_address).toLowerCase(),
    challengeId,
    expiresAt: new Date(row.expires_at).toISOString(),
  });

  // Recover the signer (viem — same primitive as reviewer/auth.ts).
  let recovered: string;
  try {
    if (input.signatureVerifier) {
      recovered = await input.signatureVerifier(expectedMessage, signature);
    } else {
      recovered = await recoverMessageAddress({
        message: expectedMessage,
        signature: signature as `0x${string}`,
      });
    }
  } catch (err) {
    return deny(
      "SIGNATURE_INVALID",
      `Signature verification failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      401,
    );
  }
  if (!isValidEvidenceWallet(recovered)) {
    return deny("SIGNATURE_INVALID", "Signature recovery produced an invalid address.", 401);
  }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    return deny("SIGNER_MISMATCH", "Signer does not match the challenged wallet.", 401);
  }
  if (recovered.toLowerCase() !== String(row.wallet_address).toLowerCase()) {
    return deny("SIGNER_MISMATCH", "Signer does not match the challenged wallet.", 401);
  }

  // Live on-chain party check against the expected escrow for this chain.
  let parties: { client: string; worker: string; exists: boolean };
  try {
    const reader =
      input.escrowReader ??
      (expectedContract.toLowerCase() !== canonicalContract.toLowerCase()
        ? new CeloEscrowCaseReader(
            chainId as 11142220 | 42220,
            undefined,
            expectedContract,
          )
        : new CeloEscrowCaseReader(chainId as 11142220 | 42220));
    const result = await reader.getCaseParties({ escrowPaymentId: paymentId });
    parties = {
      client: String(result.client),
      worker: String(result.worker),
      exists: Boolean(result.exists),
    };
  } catch {
    return deny("CHAIN_READ_FAILED", "Failed to read the on-chain payment.", 500);
  }
  if (!parties.exists) {
    return deny("PAYMENT_NOT_FOUND", "Payment does not exist on-chain.", 404);
  }
  const signerLower = recovered.toLowerCase();
  const isClient = signerLower === String(parties.client).toLowerCase();
  const isWorker = signerLower === String(parties.worker).toLowerCase();
  if (!isClient && !isWorker) {
    return deny("NOT_PARTY", "Wallet is not the on-chain client or worker for this payment.", 403);
  }

  return { ok: true, row, signer: recovered, message: expectedMessage };
}

/**
 * Atomically consume a challenge (single UPDATE ... WHERE consumed_at IS NULL
 * AND expires_at > now()). Returns true only when this caller won the race.
 * Mirrors reviewer consumeReviewerNonce + x402_claim_settlement discipline.
 */
export async function consumeEvidenceChallenge(input: {
  challengeHash: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}): Promise<boolean> {
  const supabase = input.supabase ?? getSupabaseClient();
  const normalized = input.challengeHash.toLowerCase();
  try {
    const { data, error } = await supabase
      .from(EVIDENCE_CHALLENGE_TABLE)
      .update({ consumed_at: new Date().toISOString() })
      .eq("challenge_hash", normalized)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
