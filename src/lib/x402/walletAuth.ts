import { verifyMessage } from "viem";

export interface WalletAuthResult {
  verified: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Wallet-auth message TRANSPORT encoding
//
// Canonical wallet-auth messages are multiline (joined with \n) and must be
// signed EXACTLY as built. HTTP header values cannot contain CR/LF bytes —
// browser fetch rejects them ("Invalid value"), so the signed message can
// NEVER be placed into x-wallet-message raw.
//
// Transport contract (applies to EVERY wallet-auth request):
//   canonicalMessage
//     → wallet signs canonicalMessage
//     → x-wallet-message = encodeWalletAuthMessage(canonicalMessage)
//     → server decodes via decodeWalletAuthMessage BEFORE verifyMessage
//
// Encoding: UTF-8 → base64url (RFC 4648 §5), prefixed with "b64url:" so
// decode can distinguish encoded transport from legacy raw values without
// ambiguous attempt-decoding. Raw (unprefixed) values pass through
// unchanged for backward compatibility with non-browser/internal callers.
// Malformed encoded values FAIL CLOSED (decode throws).
// ---------------------------------------------------------------------------

export const WALLET_AUTH_MESSAGE_ENCODING_PREFIX = "b64url:" as const;

/**
 * ASCII/header-safe reversible encoding of a canonical wallet-auth message.
 * The output contains no CR/LF or other illegal header bytes, so it can be
 * transported in the x-wallet-message header.
 */
export function encodeWalletAuthMessage(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const base64url = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${WALLET_AUTH_MESSAGE_ENCODING_PREFIX}${base64url}`;
}

/**
 * Recover the EXACT canonical message (byte-for-byte) from a transported
 * value. Values WITHOUT the b64url: prefix are legacy raw messages and pass
 * through unchanged. Malformed prefixed values throw — fail closed, never
 * attempt signature verification against a corrupted string.
 */
export function decodeWalletAuthMessage(value: string): string {
  if (!value.startsWith(WALLET_AUTH_MESSAGE_ENCODING_PREFIX)) {
    return value;
  }
  try {
    const payload = value.slice(WALLET_AUTH_MESSAGE_ENCODING_PREFIX.length);
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Malformed wallet-auth message encoding.");
  }
}

export function buildRecoveryAuthMessage(
  txHash: string,
  paymentId: string,
  timestamp: string,
): string {
  return [
    "Reclaim I3.1 recovery authentication",
    `Transaction: ${txHash}`,
    `Payment: #${paymentId}`,
    `Timestamp: ${timestamp}`,
    "Signing this message proves you control the payer wallet.",
  ].join("\n");
}

export function extractWalletAuth(
  body: Record<string, unknown>,
): { walletAddress: string; signedMessage: string; walletSignature: string } {
  const rawMessage = typeof body.signedMessage === "string" ? body.signedMessage : "";
  return {
    walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : "",
    signedMessage: decodeWalletAuthMessage(rawMessage),
    walletSignature: typeof body.walletSignature === "string" ? body.walletSignature : "",
  };
}

export function extractWalletAuthHeaders(
  headers: Headers,
): { walletAddress: string; signedMessage: string; walletSignature: string } {
  const rawMessage = headers.get("x-wallet-message") || "";
  return {
    walletAddress: headers.get("x-wallet-address") || "",
    signedMessage: decodeWalletAuthMessage(rawMessage),
    walletSignature: headers.get("x-wallet-signature") || "",
  };
}

export async function verifyWalletSignature(
  claimedAddress: string,
  message: string,
  signature: string,
): Promise<WalletAuthResult> {
  if (!claimedAddress || !/^0x[0-9a-fA-F]{40}$/.test(claimedAddress)) {
    return { verified: false, error: "Invalid wallet address format." };
  }
  if (!signature || signature === "0x") {
    return { verified: false, error: "Wallet signature is missing or empty." };
  }
  if (!message) {
    return { verified: false, error: "Signed message is missing." };
  }

  try {
    const isValid = await verifyMessage({
      address: claimedAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!isValid) {
      return { verified: false, error: "Wallet signature verification failed." };
    }
    return { verified: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown verification error";
    return { verified: false, error: `Signature verification error: ${errorMessage}` };
  }
}
