// ---------------------------------------------------------------------------
// Resolution Agent — case wallet generation
// SERVER-ONLY — imports node:crypto and viem, never use in browser bundles
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentCaseIdentity, EncryptedWalletSecret } from "../types";
import { InvalidCaseWalletPrivateKeyError } from "../errors";
import { encryptCaseWalletPrivateKey } from "./encryption";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** EVM private key size in bytes (256 bits). */
const PRIVATE_KEY_BYTES = 32;

/** Regex matching a valid 0x-prefixed 64-hex-char EVM private key. */
const EVM_PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Public Helpers
// ---------------------------------------------------------------------------

/**
 * Validates that `value` is a well-formed EVM private key:
 *   0x prefix followed by exactly 64 hexadecimal characters.
 *
 * @returns `true` if the value passes validation, `false` otherwise.
 */
export function isValidEVMPrivateKey(value: string): boolean {
  return typeof value === "string" && EVM_PRIVATE_KEY_RE.test(value);
}

// ---------------------------------------------------------------------------
// Case Wallet Generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically secure random EVM private key, derives its
 * corresponding address via viem, and immediately encrypts the private key
 * using the supplied encryption key and case identity.
 *
 * **The plaintext private key is never exposed outside this function.**
 *
 * This function:
 * - Does NOT query any blockchain or token balance.
 * - Does NOT persist anything to a database or file.
 * - Does NOT log secrets.
 *
 * @returns The derived EVM address and the encrypted wallet secret envelope.
 *
 * @throws {WalletEncryptionError} if encryption fails.
 * @throws {Error} if the system CSPRNG is unavailable.
 */
export async function generateEncryptedCaseWallet(params: {
  agentId: string;
  caseIdentity: AgentCaseIdentity;
  encryptionKey: Buffer;
}): Promise<{
  address: `0x${string}`;
  encryptedSecret: EncryptedWalletSecret;
}> {
  const { agentId, caseIdentity, encryptionKey } = params;

  // 1. Generate 32 random bytes for the private key
  let keyBytes: Buffer;
  try {
    keyBytes = randomBytes(PRIVATE_KEY_BYTES);
  } catch {
    throw new Error(
      "Failed to generate secure random bytes for wallet private key.",
    );
  }

  // 2. Convert to 0x-prefixed hex string
  const privateKeyHex = `0x${keyBytes.toString("hex")}` as `0x${string}`;

  // 3. Derive EVM address
  let address: `0x${string}`;
  try {
    address = privateKeyToAccount(privateKeyHex).address;
  } catch {
    throw new InvalidCaseWalletPrivateKeyError(
      "Failed to derive EVM address from generated private key.",
    );
  }

  // 4. Encrypt immediately — the plaintext never escapes
  const encryptedSecret = encryptCaseWalletPrivateKey({
    privateKey: privateKeyHex,
    caseIdentity,
    agentId,
    encryptionKey,
  });

  // 5. Overwrite the local reference as a defense-in-depth measure
  //    (the Buffer may still reside in memory until GC, but we zero our ref)
  keyBytes.fill(0);

  return { address, encryptedSecret };
}
