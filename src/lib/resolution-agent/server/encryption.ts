// ---------------------------------------------------------------------------
// Resolution Agent — AES-256-GCM wallet encryption
// SERVER-ONLY — imports node:crypto, never use in browser bundles
// ---------------------------------------------------------------------------

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { privateKeyToAccount, type Account } from "viem/accounts";
import {
  ENCRYPTED_WALLET_SECRET_VERSION,
  ENCRYPTED_WALLET_SECRET_ALGORITHM,
  type EncryptedWalletSecret,
  type AgentCaseIdentity,
} from "../types";
import {
  WalletEncryptionError,
  WalletDecryptionError,
  InvalidEncryptedWalletSecretError,
} from "../errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AES-GCM IV length in bytes (96 bits). */
const IV_BYTES = 12;

/** AES-GCM authentication tag length in bytes (128 bits). */
const AUTH_TAG_BYTES = 16;

/** Hex regex for a full EVM private key (0x + 64 hex chars). */
const EVM_PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** Strict base64 validation regex (unlike Buffer.from, this rejects invalid chars). */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// ---------------------------------------------------------------------------
// Associated Data (AAD)
// ---------------------------------------------------------------------------

/**
 * Builds deterministic associated data for AES-GCM from the case identity and
 * agent identifier.  Uses a length-prefixed encoding to avoid field-separator
 * ambiguity.  The fields are serialised in a stable order:
 *
 *   version (1 byte) | agentId | chainId | contractAddress | paymentId
 *
 * Each variable-length field is prefixed with its UTF-8 byte length as a
 * 4-byte big-endian unsigned integer.
 */
export function createAssociatedData(params: {
  agentId: string;
  caseIdentity: AgentCaseIdentity;
}): Buffer {
  const { agentId, caseIdentity } = params;

  const fields: Buffer[] = [];

  // Version byte (uint8)
  fields.push(Buffer.from([ENCRYPTED_WALLET_SECRET_VERSION]));

  // Helper: push a length-prefixed UTF-8 field
  const pushField = (value: string): void => {
    const buf = Buffer.from(value, "utf8");
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(buf.length, 0);
    fields.push(lenBuf, buf);
  };

  pushField(agentId);
  pushField(caseIdentity.escrowChainId);
  // Contract address is lowercased for consistency
  pushField(caseIdentity.escrowContractAddress.toLowerCase());
  pushField(caseIdentity.escrowPaymentId);

  return Buffer.concat(fields);
}

// ---------------------------------------------------------------------------
// Private Key Validation
// ---------------------------------------------------------------------------

/**
 * Validates that `value` is a well-formed 0x-prefixed 32-byte EVM private key
 * hex string.  Throws {@link WalletEncryptionError} with a generic message
 * on failure — the key value is never included in the error.
 */
function validatePrivateKeyHex(value: string): void {
  if (typeof value !== "string" || !EVM_PRIVATE_KEY_RE.test(value)) {
    throw new WalletEncryptionError(
      "Invalid private key format; expected a 0x-prefixed 64-character hex string.",
    );
  }
}

/**
 * Converts a 0x-prefixed hex private key to a 32-byte Buffer.
 * Call {@link validatePrivateKeyHex} first.
 */
function privateKeyHexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.slice(2), "hex");
}

/**
 * Converts a 32-byte Buffer back to a 0x-prefixed hex private key string.
 */
function bufferToPrivateKeyHex(buf: Buffer): string {
  return `0x${buf.toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts an EVM private key using AES-256-GCM with case-bound associated
 * data.  The resulting envelope can be safely stored and later decrypted only
 * with the same encryption key, case identity, and agent identifier.
 *
 * @throws {WalletEncryptionError} if the private key is malformed or
 *         encryption fails.
 */
export function encryptCaseWalletPrivateKey(params: {
  privateKey: string;
  caseIdentity: AgentCaseIdentity;
  agentId: string;
  encryptionKey: Buffer;
}): EncryptedWalletSecret {
  const { privateKey, caseIdentity, agentId, encryptionKey } = params;

  // 1. Validate private key format
  validatePrivateKeyHex(privateKey);

  // 2. Convert to raw bytes
  let keyBytes: Buffer;
  try {
    keyBytes = privateKeyHexToBuffer(privateKey);
  } catch {
    throw new WalletEncryptionError(
      "Failed to decode private key bytes.",
    );
  }

  // 3. Build AAD
  let aad: Buffer;
  try {
    aad = createAssociatedData({ agentId, caseIdentity });
  } catch {
    throw new WalletEncryptionError(
      "Failed to construct associated data.",
    );
  }

  // 4. Generate fresh random IV
  let iv: Buffer;
  try {
    iv = randomBytes(IV_BYTES);
  } catch {
    throw new WalletEncryptionError(
      "Failed to generate encryption IV.",
    );
  }

  // 5. Encrypt
  let ciphertext: Buffer;
  let authTag: Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(aad, { plaintextLength: keyBytes.length });
    ciphertext = cipher.update(keyBytes);
    cipher.final();
    authTag = cipher.getAuthTag();
  } catch {
    throw new WalletEncryptionError(
      "Encryption operation failed.",
    );
  }

  // 6. Build envelope
  return {
    version: ENCRYPTED_WALLET_SECRET_VERSION,
    algorithm: ENCRYPTED_WALLET_SECRET_ALGORITHM,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authenticationTag: authTag.toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypts an {@link EncryptedWalletSecret} envelope and returns the original
 * 0x-prefixed EVM private key hex string.  The operation is authenticated —
 * any tampering with the ciphertext, IV, authentication tag, or mismatch in
 * case identity / agent ID will cause the decryption to fail.
 *
 * @throws {InvalidEncryptedWalletSecretError} if the envelope is structurally
 *         invalid (wrong version, algorithm, or malformed fields).
 * @throws {WalletDecryptionError} if decryption fails (wrong key, tampered
 *         data, or mismatched associated data).
 */
export function decryptCaseWalletPrivateKey(params: {
  encryptedSecret: EncryptedWalletSecret;
  caseIdentity: AgentCaseIdentity;
  agentId: string;
  encryptionKey: Buffer;
}): string {
  const { encryptedSecret, caseIdentity, agentId, encryptionKey } = params;

  // 1. Validate envelope metadata
  if (encryptedSecret.version !== ENCRYPTED_WALLET_SECRET_VERSION) {
    throw new InvalidEncryptedWalletSecretError(
      `Unsupported envelope version: ${encryptedSecret.version}.`,
    );
  }
  if (encryptedSecret.algorithm !== ENCRYPTED_WALLET_SECRET_ALGORITHM) {
    throw new InvalidEncryptedWalletSecretError(
      `Unsupported encryption algorithm: ${encryptedSecret.algorithm}.`,
    );
  }

  // 2. Validate and decode IV
  if (typeof encryptedSecret.iv !== "string" || !BASE64_RE.test(encryptedSecret.iv)) {
    throw new InvalidEncryptedWalletSecretError(
      "IV is not valid base64.",
    );
  }
  let iv: Buffer;
  try {
    iv = Buffer.from(encryptedSecret.iv, "base64");
  } catch {
    throw new InvalidEncryptedWalletSecretError(
      "IV is not valid base64.",
    );
  }
  if (iv.length !== IV_BYTES) {
    throw new InvalidEncryptedWalletSecretError(
      `IV has incorrect length (${iv.length} byte(s), expected ${IV_BYTES}).`,
    );
  }

  // 3. Validate and decode authentication tag
  if (typeof encryptedSecret.authenticationTag !== "string" || !BASE64_RE.test(encryptedSecret.authenticationTag)) {
    throw new InvalidEncryptedWalletSecretError(
      "Authentication tag is not valid base64.",
    );
  }
  let authTag: Buffer;
  try {
    authTag = Buffer.from(encryptedSecret.authenticationTag, "base64");
  } catch {
    throw new InvalidEncryptedWalletSecretError(
      "Authentication tag is not valid base64.",
    );
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new InvalidEncryptedWalletSecretError(
      `Authentication tag has incorrect length (${authTag.length} byte(s), expected ${AUTH_TAG_BYTES}).`,
    );
  }

  // 4. Validate and decode ciphertext
  if (typeof encryptedSecret.ciphertext !== "string" || !BASE64_RE.test(encryptedSecret.ciphertext)) {
    throw new InvalidEncryptedWalletSecretError(
      "Ciphertext is not valid base64.",
    );
  }
  let ciphertext: Buffer;
  try {
    ciphertext = Buffer.from(encryptedSecret.ciphertext, "base64");
  } catch {
    throw new InvalidEncryptedWalletSecretError(
      "Ciphertext is not valid base64.",
    );
  }
  if (ciphertext.length === 0) {
    throw new InvalidEncryptedWalletSecretError(
      "Ciphertext is empty.",
    );
  }

  // 5. Reconstruct AAD (must match exactly what was used during encryption)
  let aad: Buffer;
  try {
    aad = createAssociatedData({ agentId, caseIdentity });
  } catch {
    throw new WalletDecryptionError(
      "Failed to reconstruct associated data.",
    );
  }

  // 6. Decrypt
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aad, { plaintextLength: ciphertext.length });
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new WalletDecryptionError(
      "Decryption failed — the data may have been tampered with, or the " +
        "encryption key / associated data do not match.",
    );
  }

  // 7. Return as 0x-prefixed hex string
  return bufferToPrivateKeyHex(plaintext);
}

// ---------------------------------------------------------------------------
// withDecryptedCaseWalletAccount
// ---------------------------------------------------------------------------

/**
 * Decrypts the case wallet private key, derives a viem `Account`, and invokes
 * `callback` with the account.  The plaintext private key is never returned
 * to the caller — it is destroyed when the callback resolves (or rejects).
 *
 * Use this wrapper whenever you need to sign a message or typed data on
 * behalf of the case wallet so that the secret never leaves the scope of
 * the callback.
 *
 * @throws {InvalidEncryptedWalletSecretError} if the envelope is structurally
 *         invalid.
 * @throws {WalletDecryptionError} if decryption fails.
 */
export async function withDecryptedCaseWalletAccount<T>(params: {
  encryptedSecret: EncryptedWalletSecret;
  caseIdentity: AgentCaseIdentity;
  agentId: string;
  encryptionKey: Buffer;
}, callback: (account: Account) => Promise<T>): Promise<T> {
  const privateKey = decryptCaseWalletPrivateKey(params);
  let account: Account;
  try {
    account = privateKeyToAccount(privateKey as `0x${string}`);
  } catch {
    throw new WalletDecryptionError(
      "Failed to derive account from decrypted private key.",
    );
  }
  // Invoke callback — the privateKey string will be garbage-collected after
  // this function returns (no lingering references).
  return callback(account);
}
