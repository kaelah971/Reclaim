// ---------------------------------------------------------------------------
// Wallet-auth message TRANSPORT tests (RA1R.7G)
//
// Canonical wallet-auth messages are multiline; HTTP header values cannot
// contain CR/LF. Transport contract:
//   canonicalMessage → sign → encodeWalletAuthMessage → x-wallet-message
//   → server decodeWalletAuthMessage → verifyMessage(EXACT decoded message)
//
// Coverage:
//   1. RAW multiline message fails browser-style Headers construction
//      (reproduces the live "Invalid value" failure)
//   2. encoded message is accepted as a header value
//   3. encode → decode returns the exact canonical string incl. line breaks
//   4. real funder signature verifies after transport decode
//   5. tampered encoded payload fails verification
//   6. malformed encoded message fails closed
//   7. wrong funder still fails
//   9. every browser wallet-auth producer uses the shared encoder
//   10. legacy RAW values (no b64url: prefix) pass through unchanged
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { signMessage, privateKeyToAccount } from "viem/accounts";
import {
  encodeWalletAuthMessage,
  decodeWalletAuthMessage,
  WALLET_AUTH_MESSAGE_ENCODING_PREFIX,
  extractWalletAuthHeaders,
  verifyWalletSignature,
} from "../walletAuth";
import { buildRenewPolicyMessage } from "../../resolution-agent/api/auth";

const FUNDER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FUNDER_ACCOUNT = privateKeyToAccount(FUNDER_KEY);
const WRONG_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

function canonicalRenewalMessage(): string {
  return buildRenewPolicyMessage({
    agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    escrowChainId: "eip155:11142220",
    escrowPaymentId: "1",
    oldExpiresAtMs: 1786161440000,
    newExpiresAtMs: 1786161440000 + 86400000,
    funderAddress: FUNDER_ACCOUNT.address,
  });
}

describe("wallet-auth message transport", () => {
  it("1) RAW multiline canonical message FAILS browser-style Headers construction (live bug)", () => {
    const message = canonicalRenewalMessage();
    // The canonical message is multiline — this is the header-illegal byte.
    expect(message).toContain("\n");
    expect(message).toMatch(/\r?\n/);

    // Browser fetch rejects CR/LF header values with "Invalid value".
    expect(() => new Headers({ "x-wallet-message": message })).toThrow(TypeError);
  });

  it("2) ENCODED message is accepted as an HTTP header value", () => {
    const encoded = encodeWalletAuthMessage(canonicalRenewalMessage());

    expect(encoded).toMatch(/^b64url:[A-Za-z0-9_-]+$/); // base64url, no CR/LF
    expect(() => new Headers({ "x-wallet-message": encoded })).not.toThrow();
    const headers = new Headers({ "x-wallet-message": encoded });
    expect(headers.get("x-wallet-message")).toBe(encoded);
  });

  it("3) encode → decode returns the exact canonical message including line breaks", () => {
    const message = canonicalRenewalMessage();
    const decoded = decodeWalletAuthMessage(encodeWalletAuthMessage(message));

    expect(decoded).toBe(message); // byte-for-byte identity
    expect(decoded.length).toBe(message.length);
    expect(decoded).toContain("\n");
  });

  it("4) real funder signature verifies after transport decode (full round trip)", async () => {
    const message = canonicalRenewalMessage();
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    // Transport exactly as a browser would send it:
    const encoded = encodeWalletAuthMessage(message);
    const headers = new Headers({
      "x-wallet-address": FUNDER_ACCOUNT.address,
      "x-wallet-message": encoded,
      "x-wallet-signature": signature,
    });

    // Server-side boundary: shared extractor decodes BEFORE verification.
    const { walletAddress, signedMessage, walletSignature } =
      extractWalletAuthHeaders(headers);
    expect(signedMessage).toBe(message);

    const authResult = await verifyWalletSignature(
      walletAddress,
      signedMessage,
      walletSignature,
    );
    expect(authResult.verified).toBe(true);
  });

  it("5) tampered encoded payload fails signature verification", async () => {
    const message = canonicalRenewalMessage();
    const signature = await signMessage({ privateKey: FUNDER_KEY, message });

    const encoded = encodeWalletAuthMessage(message);
    const tampered = encodeWalletAuthMessage(message + "tampered");
    const headers = new Headers({
      "x-wallet-address": FUNDER_ACCOUNT.address,
      "x-wallet-message": tampered,
      "x-wallet-signature": signature,
    });
    const auth = extractWalletAuthHeaders(headers);

    expect(auth.signedMessage).not.toBe(message);
    const result = await verifyWalletSignature(
      auth.walletAddress,
      auth.signedMessage,
      auth.walletSignature,
    );
    expect(result.verified).toBe(false);
  });

  it("6) malformed encoded message fails closed", () => {
    // b64url of a lone 0xFF byte — syntactically base64url but NOT valid
    // UTF-8, so decoding must fail rather than yield a corrupted message.
    expect(() => decodeWalletAuthMessage("b64url:_w")).toThrow(
      "Malformed wallet-auth message encoding.",
    );
    // b64url of 0xF5 (invalid UTF-8 leading byte).
    expect(() => decodeWalletAuthMessage("b64url:9Q")).toThrow(
      "Malformed wallet-auth message encoding.",
    );
  });

  it("7) wrong funder still fails verification after transport decode", async () => {
    const message = canonicalRenewalMessage();
    const wrongSignature = await signMessage({ privateKey: WRONG_KEY, message });
    const headers = new Headers({
      "x-wallet-address": FUNDER_ACCOUNT.address,
      "x-wallet-message": encodeWalletAuthMessage(message),
      "x-wallet-signature": wrongSignature,
    });
    const auth = extractWalletAuthHeaders(headers);
    const result = await verifyWalletSignature(
      auth.walletAddress,
      auth.signedMessage,
      auth.walletSignature,
    );
    expect(result.verified).toBe(false);
  });

  it("10) legacy RAW messages (no b64url: prefix) pass through unchanged", () => {
    const raw = "legacy plain text wallet-auth message\nwith a line break";
    expect(decodeWalletAuthMessage(raw)).toBe(raw);
  });
});

describe("wallet-auth producers use the shared transport encoding", () => {
  const producerPath = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "components",
    "agent",
    "AgentPolicyRenewCard.tsx",
  );

  it("9) the browser producer encodes x-wallet-message with the shared helper", () => {
    const source = readFileSync(producerPath, "utf-8");
    expect(source).toContain('encodeWalletAuthMessage(canonicalMessage)');
    expect(source).toContain('"x-wallet-message"');
    // No raw canonical message may be assigned to the header directly.
    expect(source).not.toContain('"x-wallet-message": canonicalMessage,');
  });
});
