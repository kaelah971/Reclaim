import { utf8ByteLength, MAX_BYTES32_LABEL_BYTES } from "@/lib/contracts/types";

// ---------------------------------------------------------------------------
// Pure validators for the guided /payments/new flow (P4.2b).
//
// Plain-language copy only: no "stored on-chain" / "release rule" jargon,
// and no claims about privacy — agreement details are saved with the shared
// agreement record and visible to both sides.
// ---------------------------------------------------------------------------

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isValidWorkerAddress(value: string): boolean {
  const trimmed = value.trim();
  return ADDRESS_PATTERN.test(trimmed) && trimmed !== ZERO_ADDRESS;
}

/**
 * Parse a human-readable amount against the chain token's decimals.
 * Returns null when the input is not a positive number that fits.
 */
export function parseAmountToRaw(
  value: string,
  decimals: number,
): bigint | null {
  const normalized = value.trim();
  if (normalized === "") return null;
  if (!/^\d+(\.\d*)?$/.test(normalized)) return null;
  const [whole = "0", fractionRaw = ""] = normalized.split(".");
  if (fractionRaw.length > decimals) return null;
  try {
    const factor = BigInt(10) ** BigInt(decimals);
    const raw =
      BigInt(whole === "" ? "0" : whole) * factor +
      BigInt((fractionRaw + "0".repeat(decimals)).slice(0, decimals) || "0");
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

export interface Step1Input {
  workerWallet: string;
  amount: string;
}

export function validatePaymentStep(
  input: Step1Input,
  tokenDecimals: number,
  tokenDisplay: string,
): Record<string, string> {
  const errs: Record<string, string> = {};

  if (!input.workerWallet.trim()) {
    errs.workerWallet = "Enter the freelancer's wallet address.";
  } else if (!isValidWorkerAddress(input.workerWallet)) {
    errs.workerWallet =
      "Enter a valid freelancer wallet address (starts with 0x, 42 characters).";
  }

  if (!input.amount.trim()) {
    errs.amount = "Enter an amount to protect.";
  } else if (parseAmountToRaw(input.amount, tokenDecimals) === null) {
    const fraction = input.amount.includes(".")
      ? (input.amount.split(".")[1] ?? "")
      : "";
    errs.amount =
      fraction.length > tokenDecimals
        ? `${tokenDisplay} supports at most ${tokenDecimals} decimal places.`
        : "Enter an amount greater than zero.";
  }

  return errs;
}

/** Parse "YYYY-MM-DD" (date input) to a Unix timestamp in seconds. */
export function dateToUnixTimestamp(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

export interface Step2Input {
  title: string;
  deliverable: string;
  deliveryFormat: string;
  deadline: string;
  releaseRule: string;
}

function byteLimitError(fieldLabel: string): string {
  return `Keep the ${fieldLabel} under ${MAX_BYTES32_LABEL_BYTES} characters so it fits the agreement record.`;
}

export function validateTermsStep(input: Step2Input): Record<string, string> {
  const errs: Record<string, string> = {};

  if (!input.title.trim()) {
    errs.title = "Give the agreement a short title.";
  } else if (utf8ByteLength(input.title.trim()) > MAX_BYTES32_LABEL_BYTES) {
    errs.title = byteLimitError("title");
  }

  if (!input.deliverable.trim()) {
    errs.deliverable = "Describe what the freelancer will deliver.";
  } else if (
    utf8ByteLength(input.deliverable.trim()) > MAX_BYTES32_LABEL_BYTES
  ) {
    errs.deliverable = byteLimitError("deliverable summary");
  }

  if (
    input.deliveryFormat.trim() !== "" &&
    utf8ByteLength(input.deliveryFormat.trim()) > MAX_BYTES32_LABEL_BYTES
  ) {
    errs.deliveryFormat = byteLimitError("delivery format");
  }

  if (!input.deadline) {
    errs.deadline = "Pick a delivery date.";
  } else if (
    dateToUnixTimestamp(input.deadline) <= Math.floor(Date.now() / 1000)
  ) {
    errs.deadline = "Pick a delivery date in the future.";
  }

  if (!input.releaseRule) {
    errs.releaseRule = "Choose how the money should be released.";
  }

  return errs;
}
