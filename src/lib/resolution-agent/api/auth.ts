// ---------------------------------------------------------------------------
// Resolution Agent API — P2C structured wallet authorization
//
// SERVER-ONLY for verification. The message builders are intentionally
// dependency-light because the browser signs the exact same bytes.
//
// The authorization format is deliberately boring: a domain line followed by
// an exact, ordered set of `Key: value` fields. There is no substring matching
// anywhere in the authorization decision. A request is authorized only after
// the parser, signature, context binding, time window, and durable nonce
// ledger all succeed.
// ---------------------------------------------------------------------------

import { keccak256, toBytes } from "viem";
import { verifyWalletSignature } from "@/lib/x402/walletAuth";
import { CANONICAL_ESCROW_CONTRACT_ADDRESS } from "./escrow-reader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTHORIZATION_DOMAIN = "Reclaim Resolution Agent Authorization v2" as const;
const MESSAGE_VERSION = "v1" as const;
const AUTH_EXPIRY_WINDOW_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const EMPTY_BODY_BYTES = "";

/** Hash used by every bodyless route. */
export const EMPTY_BODY_HASH = keccak256(toBytes(EMPTY_BODY_BYTES));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CHAIN_PATTERN = /^eip155:[0-9]+$/;
// Escrow contract identity is uint256; accepting labels here would permit a
// signed message to describe something the on-chain reader cannot authorize.
const PAYMENT_PATTERN = /^[0-9]+$/;
const NONCE_PATTERN = /^[0-9A-Za-z_-]{12,128}$/;
const INTEGER_PATTERN = /^[0-9]+$/;

const ACTION_FIELDS = {
  create_resolution_agent: [
    "Approved Budget (atomic USDC)",
    "Funder Address",
    "Policy Version",
  ],
  activate_resolution_agent: [
    "Goal",
    "Approved Budget (atomic USDC)",
    "Refund Address",
    "Allowed Tools",
    "Policy Version",
    "Agent Expiry",
    "Funder Address",
  ],
  pause_resolution_agent: [],
  resume_resolution_agent: [],
  close_resolution_agent: ["Refund Destination"],
  amend_budget_resolution_agent: [
    "Old Approved Budget (atomic USDC)",
    "New Approved Budget (atomic USDC)",
    "Funder Address",
  ],
  run_resolution_agent: [],
  renew_resolution_agent_policy: [
    "Old Expires At (epoch ms)",
    "New Expires At (epoch ms)",
    "Funder Address",
  ],
  get_resolution_agent: [],
  get_resolution_agent_details: [],
  funding_status_resolution_agent: [],
} as const;

export type AuthorizationAction = keyof typeof ACTION_FIELDS;

export interface StructuredAuthorization {
  version: typeof MESSAGE_VERSION;
  action: AuthorizationAction;
  agentId: string;
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  bodyHash: string;
  signerAddress: string;
  issuedAt: number;
  authorizationExpiresAt: number;
  nonce: string;
  fields: Readonly<Record<string, string>>;
}

export interface AuthorizationExpectation {
  action: AuthorizationAction;
  agentId: string;
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  bodyHash: string;
  /** When omitted, the recovered signer is still required to equal the field. */
  signerAddress?: string;
  fields?: Readonly<Record<string, string>>;
}

export interface AuthorizationNonceStore {
  /** Atomically inserts a nonce hash. False means it was already consumed. */
  consumeAuthorizationNonce(input: {
    nonceHash: string;
    nonce: string;
    action: AuthorizationAction;
    signerAddress: string;
    agentId: string;
    issuedAt: number;
    expiresAt: number;
  }): Promise<boolean>;
}

export type AuthorizationResult =
  | {
      verified: true;
      authorization: StructuredAuthorization;
    }
  | {
      verified: false;
      error: string;
      code:
        | "MALFORMED_MESSAGE"
        | "AUTH_EXPIRED"
        | "AUTH_NOT_YET_VALID"
        | "SIGNATURE_INVALID"
        | "MESSAGE_ACTION_MISMATCH"
        | "MESSAGE_AGENT_ID_MISMATCH"
        | "MESSAGE_CHAIN_MISMATCH"
        | "MESSAGE_CONTRACT_MISMATCH"
        | "MESSAGE_PAYMENT_MISMATCH"
        | "MESSAGE_BODY_HASH_MISMATCH"
        | "MESSAGE_SIGNER_MISMATCH"
        | "MESSAGE_FIELD_MISMATCH"
        | "AUTH_REPLAY"
        | "AUTH_PERSISTENCE_FAILED";
    };

// ---------------------------------------------------------------------------
// Canonical JSON and message helpers
// ---------------------------------------------------------------------------

/**
 * Deterministically serializes JSON-compatible values. Object keys are sorted
 * recursively; array order is preserved. Bigints are represented as strings
 * so callers can use the helper for request data without lossy conversion.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite numbers are not valid JSON.");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported value in canonical JSON payload.");
}

export function hashCanonicalJson(value: unknown): string {
  return keccak256(toBytes(canonicalizeJson(value)));
}

/** Bodyless routes reject an unexpected payload instead of signing an empty one. */
export async function requestHasUnexpectedBody(request: Request): Promise<boolean> {
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") return false;
  const raw = await request.text();
  return raw.trim().length > 0;
}

function bodyHashOrDefault(bodyHash: string | undefined, fallback: string): string {
  return bodyHash ?? fallback;
}

function randomNonce(): string {
  return globalThis.crypto.randomUUID();
}

function messageTimes(params: {
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): { issuedAt: number; authorizationExpiresAt: number; nonce: string } {
  const issuedAt = params.issuedAt ?? Date.now();
  return {
    issuedAt,
    authorizationExpiresAt:
      params.authorizationExpiresAt ?? issuedAt + AUTH_EXPIRY_WINDOW_MS,
    nonce: params.nonce ?? randomNonce(),
  };
}

function signerOrEmpty(value: string | undefined): string {
  return value ?? "";
}

function makeMessage(params: {
  action: AuthorizationAction;
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  bodyHash: string;
  signerAddress?: string;
  fields?: Readonly<Record<string, string>>;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  const times = messageTimes(params);
  const fields = params.fields ?? {};
  const orderedFields = ACTION_FIELDS[params.action];

  return [
    AUTHORIZATION_DOMAIN,
    `Version: ${MESSAGE_VERSION}`,
    `Action: ${params.action}`,
    `Agent ID: ${params.agentId}`,
    `Escrow Chain ID: ${params.escrowChainId}`,
    `Escrow Contract: ${CANONICAL_ESCROW_CONTRACT_ADDRESS}`,
    `Escrow Payment ID: ${params.escrowPaymentId}`,
    `Body Hash: ${params.bodyHash}`,
    `Signer Address: ${signerOrEmpty(params.signerAddress)}`,
    `Issued At: ${times.issuedAt}`,
    `Authorization Expires: ${times.authorizationExpiresAt}`,
    `Nonce: ${times.nonce}`,
    ...orderedFields.map((key) => `${key}: ${fields[key] ?? ""}`),
  ].join("\n");
}

function lowerAddress(value: string): string {
  return value.toLowerCase();
}

function createBodyHash(params: {
  escrowPaymentId: string;
  budgetAtomic: bigint;
}): string {
  return hashCanonicalJson({
    escrowPaymentId: params.escrowPaymentId,
    budgetAtomic: params.budgetAtomic.toString(),
  });
}

// ---------------------------------------------------------------------------
// Public signed-message builders
// ---------------------------------------------------------------------------

export function buildCreateAgentMessage(params: {
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  budgetAtomic: bigint;
  funderAddress: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "create_resolution_agent",
    agentId: "none",
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, createBodyHash(params)),
    signerAddress: params.signerAddress ?? params.funderAddress,
    fields: {
      "Approved Budget (atomic USDC)": params.budgetAtomic.toString(),
      "Funder Address": params.funderAddress,
      "Policy Version": "v1",
    },
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildActivationMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowContractAddress: string;
  escrowPaymentId: string;
  goal: string;
  approvedBudgetAtomic: bigint;
  refundAddress: string;
  policyVersion: string;
  allowedToolIds: readonly string[];
  agentExpiresAt: number;
  authorizationExpiresAt?: number;
  funderAddress: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "activate_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, EMPTY_BODY_HASH),
    signerAddress: params.signerAddress ?? params.funderAddress,
    fields: {
      Goal: params.goal,
      "Approved Budget (atomic USDC)": params.approvedBudgetAtomic.toString(),
      "Refund Address": params.refundAddress,
      "Allowed Tools": params.allowedToolIds.join(","),
      "Policy Version": params.policyVersion,
      "Agent Expiry": String(params.agentExpiresAt),
      "Funder Address": params.funderAddress,
    },
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildPauseMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "pause_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, EMPTY_BODY_HASH),
    signerAddress: params.signerAddress,
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildResumeMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "resume_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, EMPTY_BODY_HASH),
    signerAddress: params.signerAddress,
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildCloseMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  funderAddress: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "close_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, EMPTY_BODY_HASH),
    signerAddress: params.signerAddress ?? params.funderAddress,
    fields: { "Refund Destination": params.funderAddress },
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildAmendBudgetMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  oldBudgetAtomic: bigint;
  newBudgetAtomic: bigint;
  funderAddress: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "amend_budget_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(
      params.bodyHash,
      hashCanonicalJson({ budgetAtomic: params.newBudgetAtomic.toString() }),
    ),
    signerAddress: params.signerAddress ?? params.funderAddress,
    fields: {
      "Old Approved Budget (atomic USDC)": params.oldBudgetAtomic.toString(),
      "New Approved Budget (atomic USDC)": params.newBudgetAtomic.toString(),
      "Funder Address": params.funderAddress,
    },
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildRunAgentMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "run_resolution_agent",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(params.bodyHash, EMPTY_BODY_HASH),
    signerAddress: params.signerAddress,
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildRenewPolicyMessage(params: {
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  oldExpiresAtMs: number;
  newExpiresAtMs: number;
  funderAddress: string;
  signerAddress?: string;
  bodyHash?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: "renew_resolution_agent_policy",
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: bodyHashOrDefault(
      params.bodyHash,
      hashCanonicalJson({ expiresAt: String(params.newExpiresAtMs) }),
    ),
    signerAddress: params.signerAddress ?? params.funderAddress,
    fields: {
      "Old Expires At (epoch ms)": String(params.oldExpiresAtMs),
      "New Expires At (epoch ms)": String(params.newExpiresAtMs),
      "Funder Address": params.funderAddress,
    },
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

function buildReadMessage(params: {
  action: "get_resolution_agent" | "get_resolution_agent_details" | "funding_status_resolution_agent";
  agentId: string;
  escrowChainId: string;
  escrowPaymentId: string;
  signerAddress?: string;
  issuedAt?: number;
  authorizationExpiresAt?: number;
  nonce?: string;
}): string {
  return makeMessage({
    action: params.action,
    agentId: params.agentId,
    escrowChainId: params.escrowChainId,
    escrowPaymentId: params.escrowPaymentId,
    bodyHash: EMPTY_BODY_HASH,
    signerAddress: params.signerAddress,
    issuedAt: params.issuedAt,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
  });
}

export function buildAgentViewMessage(params: Omit<Parameters<typeof buildReadMessage>[0], "action">): string {
  return buildReadMessage({ ...params, action: "get_resolution_agent" });
}

export function buildAgentDetailsMessage(params: Omit<Parameters<typeof buildReadMessage>[0], "action">): string {
  return buildReadMessage({ ...params, action: "get_resolution_agent_details" });
}

export function buildFundingStatusMessage(params: Omit<Parameters<typeof buildReadMessage>[0], "action">): string {
  return buildReadMessage({ ...params, action: "funding_status_resolution_agent" });
}

// ---------------------------------------------------------------------------
// Strict parser and authorization
// ---------------------------------------------------------------------------

class AuthorizationParseError extends Error {
  constructor(
    message: string,
    readonly code: "MALFORMED_MESSAGE" | "AUTH_EXPIRED" | "AUTH_NOT_YET_VALID" =
      "MALFORMED_MESSAGE",
  ) {
    super(message);
  }
}

function malformed(
  message: string,
  code: "MALFORMED_MESSAGE" | "AUTH_EXPIRED" | "AUTH_NOT_YET_VALID" =
    "MALFORMED_MESSAGE",
): never {
  throw new AuthorizationParseError(
    `Malformed structured wallet authorization: ${message}`,
    code,
  );
}

function parseIntegerField(fields: Record<string, string>, name: string): number {
  const value = fields[name];
  if (!value || !INTEGER_PATTERN.test(value)) malformed(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) malformed(`${name} is outside the safe integer range`);
  return parsed;
}

/** Parses every field exactly once and rejects unknown, missing, or reordered fields. */
export function parseStructuredAuthorizationMessage(
  message: string,
  now = Date.now(),
): StructuredAuthorization {
  if (typeof message !== "string" || message.length === 0) malformed("message is empty");
  if (/\r/.test(message)) malformed("CR bytes are not allowed");

  const lines = message.split("\n");
  if (lines[0] !== AUTHORIZATION_DOMAIN) malformed("invalid authorization domain");

  const fieldNames = [
    "Version",
    "Action",
    "Agent ID",
    "Escrow Chain ID",
    "Escrow Contract",
    "Escrow Payment ID",
    "Body Hash",
    "Signer Address",
    "Issued At",
    "Authorization Expires",
    "Nonce",
  ];

  const raw = new Map<string, string>();
  const parsedKeys: string[] = [];
  for (const line of lines.slice(1)) {
    if (/[\u0000-\u001F\u007F]/.test(line)) {
      malformed("control bytes are not allowed");
    }
    const match = /^([^:]+): ([^\n]*)$/.exec(line);
    if (!match || match[1].length === 0 || match[2].length === 0) {
      malformed("every field must use `Key: value` syntax");
    }
    const key = match[1];
    if (raw.has(key)) malformed(`duplicate field ${key}`);
    raw.set(key, match[2]);
    parsedKeys.push(key);
  }

  const actionValue = raw.get("Action");
  if (
    !actionValue ||
    !Object.prototype.hasOwnProperty.call(ACTION_FIELDS, actionValue)
  ) {
    malformed("unsupported action");
  }
  const action = actionValue as AuthorizationAction;
  const expectedKeys = [...fieldNames, ...ACTION_FIELDS[action]];
  if (
    parsedKeys.length !== expectedKeys.length ||
    parsedKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    malformed("missing, unknown, or out-of-order fields");
  }

  const fields = Object.fromEntries(raw.entries());
  if (fields.Version !== MESSAGE_VERSION) malformed("unsupported message version");
  if (!fields["Agent ID"] || !/^[\x21-\x7E]+$/.test(fields["Agent ID"])) {
    malformed("invalid agent ID");
  }
  if (!CHAIN_PATTERN.test(fields["Escrow Chain ID"])) malformed("invalid escrow chain");
  if (!ADDRESS_PATTERN.test(fields["Escrow Contract"])) malformed("invalid escrow contract");
  if (!PAYMENT_PATTERN.test(fields["Escrow Payment ID"])) malformed("invalid payment ID");
  if (!HASH_PATTERN.test(fields["Body Hash"])) malformed("invalid body hash");
  if (!ADDRESS_PATTERN.test(fields["Signer Address"])) malformed("invalid signer address");
  if (!NONCE_PATTERN.test(fields.Nonce)) malformed("invalid nonce");

  const issuedAt = parseIntegerField(fields, "Issued At");
  const authorizationExpiresAt = parseIntegerField(fields, "Authorization Expires");
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) {
    malformed("authorization is not yet valid", "AUTH_NOT_YET_VALID");
  }
  if (authorizationExpiresAt <= now) {
    malformed("authorization has expired", "AUTH_EXPIRED");
  }
  if (authorizationExpiresAt <= issuedAt) malformed("authorization expiry precedes issue time");
  if (authorizationExpiresAt - issuedAt > AUTH_EXPIRY_WINDOW_MS + MAX_CLOCK_SKEW_MS) {
    malformed("authorization window is too long");
  }

  return {
    version: MESSAGE_VERSION,
    action,
    agentId: fields["Agent ID"],
    escrowChainId: fields["Escrow Chain ID"],
    escrowContractAddress: fields["Escrow Contract"],
    escrowPaymentId: fields["Escrow Payment ID"],
    bodyHash: fields["Body Hash"].toLowerCase(),
    signerAddress: lowerAddress(fields["Signer Address"]),
    issuedAt,
    authorizationExpiresAt,
    nonce: fields.Nonce,
    fields,
  };
}

function failure(
  code: Exclude<AuthorizationResult, { verified: true }>["code"],
  error: string,
): AuthorizationResult {
  return { verified: false, code, error };
}

export function assertAuthorizationMatches(
  authorization: StructuredAuthorization,
  expected: AuthorizationExpectation,
): AuthorizationResult {
  if (authorization.action !== expected.action) {
    return failure("MESSAGE_ACTION_MISMATCH", "Signed action does not match this route.");
  }
  if (authorization.agentId !== expected.agentId) {
    return failure("MESSAGE_AGENT_ID_MISMATCH", "Signed agent ID does not match the route.");
  }
  if (authorization.escrowChainId !== expected.escrowChainId) {
    return failure("MESSAGE_CHAIN_MISMATCH", "Signed escrow chain does not match the stored agent.");
  }
  if (
    lowerAddress(authorization.escrowContractAddress) !==
    lowerAddress(expected.escrowContractAddress)
  ) {
    return failure("MESSAGE_CONTRACT_MISMATCH", "Signed escrow contract does not match the stored agent.");
  }
  if (authorization.escrowPaymentId !== expected.escrowPaymentId) {
    return failure("MESSAGE_PAYMENT_MISMATCH", "Signed payment ID does not match the stored agent.");
  }
  if (authorization.bodyHash.toLowerCase() !== expected.bodyHash.toLowerCase()) {
    return failure("MESSAGE_BODY_HASH_MISMATCH", "Signed request body hash does not match the request.");
  }
  if (
    expected.signerAddress &&
    lowerAddress(authorization.signerAddress) !== lowerAddress(expected.signerAddress)
  ) {
    return failure("MESSAGE_SIGNER_MISMATCH", "Signed signer does not match the required wallet owner.");
  }
  for (const [key, value] of Object.entries(expected.fields ?? {})) {
    const actual = authorization.fields[key];
    const isAddressField =
      key === "Funder Address" ||
      key === "Refund Address" ||
      key === "Refund Destination";
    if (
      !actual ||
      (isAddressField
        ? lowerAddress(actual) !== lowerAddress(value)
        : actual !== value)
    ) {
      return failure("MESSAGE_FIELD_MISMATCH", `Signed field ${key} does not match the stored value.`);
    }
  }
  return { verified: true, authorization };
}

/**
 * Verifies structure, time validity, the ECDSA signature, and the claimed
 * signer field. This function intentionally does not consume a nonce so it
 * remains useful for pure cryptographic tests and internal inspection.
 */
export async function verifyAuth(params: {
  claimedAddress: string;
  message: string;
  signature: string;
  now?: number;
}): Promise<AuthorizationResult> {
  let authorization: StructuredAuthorization;
  try {
    authorization = parseStructuredAuthorizationMessage(params.message, params.now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Malformed authorization message.";
    if (error instanceof AuthorizationParseError) return failure(error.code, message);
    return failure("MALFORMED_MESSAGE", message);
  }

  if (authorization.signerAddress !== lowerAddress(params.claimedAddress)) {
    return failure("SIGNATURE_INVALID", "Signed signer does not equal the claimed wallet address.");
  }

  const signatureResult = await verifyWalletSignature(
    params.claimedAddress,
    params.message,
    params.signature,
  );
  if (!signatureResult.verified) {
    return failure("SIGNATURE_INVALID", signatureResult.error ?? "Wallet signature verification failed.");
  }

  return { verified: true, authorization };
}

/** Full route-bound authorization, including exact context and durable nonce consumption. */
export async function authorizeWalletRequest(params: {
  claimedAddress: string;
  message: string;
  signature: string;
  expected: AuthorizationExpectation;
  nonceStore:
    | AuthorizationNonceStore
    | {
        consumeAuthorizationNonce?: AuthorizationNonceStore["consumeAuthorizationNonce"];
      };
  now?: number;
}): Promise<AuthorizationResult> {
  const cryptographic = await verifyAuth(params);
  if (!cryptographic.verified) return cryptographic;

  const context = assertAuthorizationMatches(cryptographic.authorization, params.expected);
  if (!context.verified) return context;

  const nonceHash = keccak256(toBytes(cryptographic.authorization.nonce));
  try {
    const consumeAuthorizationNonce = params.nonceStore.consumeAuthorizationNonce;
    if (!consumeAuthorizationNonce) {
      return failure(
        "AUTH_PERSISTENCE_FAILED",
        "Wallet authorization replay protection is unavailable.",
      );
    }
    const consumed = await consumeAuthorizationNonce({
      nonceHash,
      nonce: cryptographic.authorization.nonce,
      action: cryptographic.authorization.action,
      signerAddress: cryptographic.authorization.signerAddress,
      agentId: cryptographic.authorization.agentId,
      issuedAt: cryptographic.authorization.issuedAt,
      expiresAt: cryptographic.authorization.authorizationExpiresAt,
    });
    if (!consumed) return failure("AUTH_REPLAY", "This wallet authorization nonce has already been used.");
  } catch {
    return failure("AUTH_PERSISTENCE_FAILED", "Wallet authorization replay protection is unavailable.");
  }

  return cryptographic;
}

/** Exact parser used by the service's activation boundary. */
export function assertActivationAuthorization(
  signedMessage: string,
  expected: AuthorizationExpectation,
): void {
  let parsed: StructuredAuthorization;
  try {
    parsed = parseStructuredAuthorizationMessage(signedMessage);
  } catch (error) {
    throw new Error(
      `Activation authorization is malformed: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }
  const result = assertAuthorizationMatches(parsed, expected);
  if (!result.verified) throw new Error(result.error);
}

// Keep this exported constant used by callers that need to explicitly detect
// an omitted signer while preserving the original optional builder APIs.
export { ZERO_ADDRESS };
