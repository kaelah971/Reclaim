// ---------------------------------------------------------------------------
// Resolution Agent — server-only wallet encryption configuration
// SERVER-ONLY — imports node:crypto, never use in browser bundles
// ---------------------------------------------------------------------------

import { WalletEncryptionConfigurationError } from "../errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Environment variable name that holds the base64-encoded AES-256 key. */
export const WALLET_ENCRYPTION_KEY_ENV =
  "RESOLUTION_AGENT_WALLET_ENCRYPTION_KEY";

/** Expected key size in bytes (256 bits for AES-256-GCM). */
export const WALLET_ENCRYPTION_KEY_BYTES = 32;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates that the supplied string is valid unpadded base64.
 * Does NOT reveal the raw value in error messages.
 */
function isValidBase64(value: string): boolean {
  // Base64 alphabet: A-Z, a-z, 0-9, +, /, = (padding)
  // We accept both padded and unpadded.
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses and validates the wallet encryption key from its environment-variable
 * string representation.  The key MUST be a base64-encoded 32-byte value.
 *
 * This function performs *lazy* evaluation — it does not read process.env at
 * module-import time.  Callers must pass the env-var value explicitly.
 *
 * @throws {WalletEncryptionConfigurationError} if the value is missing,
 *         malformed base64, or not exactly 32 bytes after decoding.
 */
export function parseWalletEncryptionKey(
  rawValue: string | undefined,
): Buffer {
  // 1. Must exist and be non-empty
  if (rawValue === undefined || rawValue === null || rawValue.length === 0) {
    throw new WalletEncryptionConfigurationError(
      `Environment variable "${WALLET_ENCRYPTION_KEY_ENV}" is missing or empty. ` +
        "Set it to a base64-encoded 32-byte key.",
    );
  }

  // 2. Must be a string
  if (typeof rawValue !== "string") {
    throw new WalletEncryptionConfigurationError(
      `Environment variable "${WALLET_ENCRYPTION_KEY_ENV}" must be a string.`,
    );
  }

  const trimmed = rawValue.trim();

  // 3. Must be valid base64
  if (!isValidBase64(trimmed)) {
    throw new WalletEncryptionConfigurationError(
      `Environment variable "${WALLET_ENCRYPTION_KEY_ENV}" is not valid base64.`,
    );
  }

  // 4. Decode
  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(trimmed, "base64");
  } catch {
    throw new WalletEncryptionConfigurationError(
      `Environment variable "${WALLET_ENCRYPTION_KEY_ENV}" could not be decoded from base64.`,
    );
  }

  // 5. Must be exactly WALLET_ENCRYPTION_KEY_BYTES (32)
  if (keyBuffer.length !== WALLET_ENCRYPTION_KEY_BYTES) {
    throw new WalletEncryptionConfigurationError(
      `Decoded encryption key has ${keyBuffer.length} byte(s), ` +
        `expected exactly ${WALLET_ENCRYPTION_KEY_BYTES} bytes.`,
    );
  }

  return keyBuffer;
}
