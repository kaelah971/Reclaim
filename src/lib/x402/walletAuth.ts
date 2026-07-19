import { verifyMessage } from "viem";

export interface WalletAuthResult {
  verified: boolean;
  error?: string;
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
  return {
    walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : "",
    signedMessage: typeof body.signedMessage === "string" ? body.signedMessage : "",
    walletSignature: typeof body.walletSignature === "string" ? body.walletSignature : "",
  };
}

export function extractWalletAuthHeaders(
  headers: Headers,
): { walletAddress: string; signedMessage: string; walletSignature: string } {
  return {
    walletAddress: headers.get("x-wallet-address") || "",
    signedMessage: headers.get("x-wallet-message") || "",
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
