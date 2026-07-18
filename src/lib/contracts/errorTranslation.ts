/**
 * Contract error translation — maps raw viem / wagmi errors to
 * user-friendly message strings for display.
 */

/**
 * Friendly copy for the ProtectedPaymentEscrow custom errors.
 * Names must match the Solidity custom error identifiers.
 */
const CUSTOM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  InvalidAddress: "One of the addresses in this transaction is not valid.",
  InvalidAmount: "The payment amount must be greater than zero.",
  InvalidState: "This action is not available in the payment's current state.",
  UnauthorizedClient: "Only the client of this payment can perform this action.",
  UnauthorizedWorker: "Only the assigned worker can perform this action.",
  PaymentNotFound: "This payment does not exist on the contract.",
  AlreadyFunded: "This payment has already been funded.",
  EvidenceRequired: "A non-empty reference is required for this action.",
  TransferAmountMismatch:
    "The token transfer amount did not match the payment amount.",
  ContractIsPaused:
    "The escrow contract is temporarily paused. Please try again later.",
  ERC20InsufficientAllowance:
    "The escrow contract does not have enough USDC allowance. Approve the exact amount first.",
  ERC20InsufficientBalance:
    "Your USDC balance is not sufficient for this transaction.",
};

function matchCustomError(text: string): string | undefined {
  for (const [name, friendly] of Object.entries(CUSTOM_ERROR_MESSAGES)) {
    if (text.includes(name)) return friendly;
  }
  return undefined;
}

/**
 * Map a raw error object to a human-readable error string.
 */
export function translateContractError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "An unexpected contract error occurred.";
  }

  const err = error as Record<string, unknown>;

  // ---- User rejected (MetaMask error code 4001) ----
  if (
    (typeof err.code === "number" && err.code === 4001) ||
    (typeof err.name === "string" && err.name === "UserRejectedRequestError")
  ) {
    return "Transaction was rejected. You can try again when ready.";
  }

  // ---- Wallet pending request (code -32002) ----
  if (typeof err.code === "number" && err.code === -32002) {
    return "A wallet request is already pending. Please check your wallet.";
  }

  const message = typeof err.message === "string" ? err.message : "";
  const shortMessage =
    typeof err.shortMessage === "string" ? err.shortMessage : "";
  const details = typeof err.details === "string" ? err.details : "";
  const combined = `${shortMessage} ${message} ${details}`.toLowerCase();

  // ---- Known contract custom errors (checked before generic paths) ----
  const customError = matchCustomError(`${shortMessage} ${message} ${details}`);
  if (customError) {
    return customError;
  }

  // ---- Rejection variants ----
  if (
    combined.includes("rejected") ||
    combined.includes("cancelled") ||
    combined.includes("denied") ||
    combined.includes("user denied")
  ) {
    return "Transaction was rejected. You can try again when ready.";
  }

  // ---- Insufficient funds ----
  if (
    combined.includes("insufficient funds") ||
    combined.includes("insufficient balance")
  ) {
    return "Insufficient funds to complete this transaction.";
  }

  // ---- Gas estimation failures ----
  if (
    combined.includes("gas required exceeds") ||
    combined.includes("out of gas") ||
    combined.includes("intrinsic gas")
  ) {
    return "The transaction cannot be completed — gas estimation failed.";
  }

  // ---- Contract revert messages — extract the reason if available ----
  const revertMatch = shortMessage.match(
    /The contract function .+ reverted with the following (?:reason|error):\s*(.+)/i,
  );
  if (revertMatch && revertMatch[1]) {
    const reason = revertMatch[1].trim();
    // Heuristic: if the reason looks like a human-readable message, use it
    if (reason.length > 3 && !reason.startsWith("0x")) {
      return `Contract reverted: ${reason}`;
    }
  }

  // ---- Generic revert fallback ----
  if (
    combined.includes("revert") ||
    combined.includes("execution reverted")
  ) {
    return "The transaction was reverted by the contract.";
  }

  // ---- Pending / nonce issues ----
  if (combined.includes("nonce")) {
    return "A transaction nonce error occurred. Please try again.";
  }

  // ---- Best-effort fallback: use shortMessage if present ----
  if (shortMessage && shortMessage.length > 0) {
    return shortMessage;
  }

  return "An unexpected error occurred during the transaction.";
}
