// ---------------------------------------------------------------------------
// x402 local payment verification — Permit2 EIP-712 signature + funds checks
//
// SERVER-ONLY. The public Celo facilitator (api.x402.celo.org) only supports
// Celo MAINNET (eip155:42220). For Celo Sepolia (eip155:11142220) we verify
// the payment locally — which is cryptographically equivalent to what the
// facilitator's /verify endpoint does:
//
//   1. Recover the EIP-712 signer of the Permit2 PermitTransferFrom message
//      and require it to equal the claimed buyer (payment.from).
//   2. Require the signed spender to be OUR relayer (Permit2 binds
//      spender = msg.sender of permitTransferFrom).
//   3. Require an unexpired deadline.
//   4. On-chain: buyer USDC balance >= amount, buyer has approved Permit2
//      for >= amount, and the Permit2 nonce is not already consumed.
//
// This performs NO state changes and moves NO funds. Settlement remains a
// separate, explicit on-chain transaction in settlement.ts.
// ---------------------------------------------------------------------------

import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { recoverTypedDataAddress } from "viem";
import { celoSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentDetails } from "./types";
import {
  X402_USDC_ADDRESS,
  X402_PAY_TO_ADDRESS,
  requireRelayerPrivateKey,
  getDisputeBriefPriceAtomic,
} from "./config";

/** Canonical Permit2 contract address — same on every EVM chain. */
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** Celo Sepolia chain id. */
const CHAIN_ID = 11142220;
const DECIMAL_RE = /^[0-9]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Permit2 PermitTransferFrom typed-data definition (must match the client). */
const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

const erc20ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const permit2NonceABI = parseAbi([
  "function nonceBitmap(address, uint256) view returns (uint256)",
]);

export interface LocalVerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface Permit2VerificationTerms {
  amountAtomic: string;
  tokenAddress: string;
  payToAddress: string;
  /** Chain metadata persisted with the payment requirement. */
  chainId?: number;
}

function getRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org"
  );
}

function getClient(chainId = CHAIN_ID): PublicClient {
  // Local settlement is currently Celo Sepolia, but use the server-owned
  // chain metadata when a caller supplies it rather than silently signing or
  // querying against a hardcoded chain id.
  const chain = chainId === CHAIN_ID
    ? celoSepolia
    : { ...celoSepolia, id: chainId };
  return createPublicClient({
    chain,
    transport: http(getRpcUrl()),
  }) as unknown as PublicClient;
}

/**
 * Pure cryptographic verification of the Permit2 authorization.
 * No network access — usable in unit tests.
 *
 * NOTE: EOA signatures only (MetaMask et al). Smart-contract wallets
 * (EIP-1271) are not supported by this local verifier.
 */
export async function verifyPermit2SignatureOffline(
  payment: PaymentDetails,
  expectedSpender: `0x${string}`,
  chainId = CHAIN_ID,
): Promise<LocalVerifyResult> {
  if (
    !payment ||
    typeof payment.from !== "string" ||
    !ADDRESS_RE.test(payment.from) ||
    typeof payment.token !== "string" ||
    !ADDRESS_RE.test(payment.token) ||
    typeof payment.signature !== "string" ||
    !payment.signature ||
    typeof payment.amount !== "string" ||
    !DECIMAL_RE.test(payment.amount) ||
    typeof payment.nonce !== "string" ||
    !DECIMAL_RE.test(payment.nonce) ||
    typeof payment.deadline !== "string" ||
    !DECIMAL_RE.test(payment.deadline) ||
    typeof payment.spender !== "string" ||
    !ADDRESS_RE.test(payment.spender) ||
    !ADDRESS_RE.test(expectedSpender)
  ) {
    return {
      isValid: false,
      invalidReason:
        "Payment payload is missing Permit2 fields (nonce, deadline, spender).",
    };
  }

  let deadline: bigint;
  try {
    deadline = BigInt(payment.deadline);
  } catch {
    return { isValid: false, invalidReason: "Invalid Permit2 deadline format." };
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < nowSec) {
    return { isValid: false, invalidReason: "Permit2 deadline has expired." };
  }

  if (payment.spender.toLowerCase() !== expectedSpender.toLowerCase()) {
    return {
      isValid: false,
      invalidReason:
        `Signed spender ${payment.spender} does not match the settlement relayer ` +
        `${expectedSpender}. Permit2 requires spender == msg.sender at settlement.`,
    };
  }

  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: "Permit2",
        chainId,
        verifyingContract: PERMIT2_ADDRESS,
      },
      types: PERMIT2_TYPES,
      primaryType: "PermitTransferFrom",
      message: {
        permitted: {
          token: payment.token as `0x${string}`,
          amount: BigInt(payment.amount),
        },
        spender: payment.spender as `0x${string}`,
        nonce: BigInt(payment.nonce),
        deadline,
      },
      signature: payment.signature as `0x${string}`,
    });
  } catch {
    return {
      isValid: false,
      invalidReason: "Permit2 signature is malformed or unrecoverable.",
    };
  }

  if (recovered.toLowerCase() !== payment.from.toLowerCase()) {
    return {
      isValid: false,
      invalidReason:
        `Signature was produced by ${recovered}, not by the claimed buyer ${payment.from}.`,
    };
  }

  return { isValid: true, payer: recovered };
}

/**
 * On-chain funds and replay checks (read-only RPC calls):
 * balance, Permit2 allowance, and Permit2 nonce consumption.
 */
export async function verifyPermit2FundsOnChain(
  payment: PaymentDetails,
  expectedToken = X402_USDC_ADDRESS,
  chainId = CHAIN_ID,
): Promise<LocalVerifyResult> {
  if (
    !payment ||
    typeof payment.from !== "string" ||
    !ADDRESS_RE.test(payment.from) ||
    !ADDRESS_RE.test(expectedToken)
  ) {
    return { isValid: false, invalidReason: "Invalid buyer or token address." };
  }
  const buyer = payment.from as `0x${string}`;
  const usdc = expectedToken as `0x${string}`;
  let amount: bigint;
  let nonce: bigint;
  try {
    if (typeof payment.amount !== "string" || !DECIMAL_RE.test(payment.amount)) throw new Error();
    if (typeof payment.nonce !== "string" || !DECIMAL_RE.test(payment.nonce)) throw new Error();
    amount = BigInt(payment.amount);
    nonce = BigInt(payment.nonce);
  } catch {
    return { isValid: false, invalidReason: "Invalid Permit2 amount or nonce format." };
  }
  const client = getClient(chainId);

  const [balance, allowance, bitmap] = await Promise.all([
    client.readContract({
      address: usdc,
      abi: erc20ABI,
      functionName: "balanceOf",
      args: [buyer],
    }),
    client.readContract({
      address: usdc,
      abi: erc20ABI,
      functionName: "allowance",
      args: [buyer, PERMIT2_ADDRESS],
    }),
    client.readContract({
      address: PERMIT2_ADDRESS,
      abi: permit2NonceABI,
      functionName: "nonceBitmap",
      args: [buyer, nonce >> BigInt(8)],
    }),
  ]);

  if ((balance as bigint) < amount) {
    return {
      isValid: false,
      invalidReason: `Buyer USDC balance ${balance} is less than the required ${amount}.`,
    };
  }

  if ((allowance as bigint) < amount) {
    return {
      isValid: false,
      invalidReason:
        `Buyer has not approved Permit2 for enough USDC (allowance ${allowance}, ` +
        `required ${amount}). Approve exactly ${amount} atomic USDC to ${PERMIT2_ADDRESS} first.`,
    };
  }

  const bitPos = nonce & BigInt(0xff);
  const used = ((bitmap as bigint) >> bitPos) & BigInt(1);
  if (used === BigInt(1)) {
    return {
      isValid: false,
      invalidReason: `Permit2 nonce ${nonce} has already been used (replay rejected).`,
    };
  }

  return { isValid: true, payer: buyer };
}

/**
 * Full local verification: amount floor, offline signature recovery, then
 * on-chain funds/replay checks. Read-only; never moves funds.
 */
export async function verifyPermit2Authorization(
  payment: PaymentDetails,
  terms: Permit2VerificationTerms = {
    amountAtomic: getDisputeBriefPriceAtomic().toString(),
    tokenAddress: X402_USDC_ADDRESS,
    payToAddress: X402_PAY_TO_ADDRESS,
    chainId: CHAIN_ID,
  },
): Promise<LocalVerifyResult> {
  let required: bigint;
  try {
    if (typeof terms.amountAtomic !== "string" || !DECIMAL_RE.test(terms.amountAtomic)) throw new Error();
    required = BigInt(terms.amountAtomic);
  } catch {
    return { isValid: false, invalidReason: "Invalid configured payment amount." };
  }
  let amount: bigint;
  try {
    if (typeof payment.amount !== "string" || !DECIMAL_RE.test(payment.amount)) throw new Error();
    amount = BigInt(payment.amount);
  } catch {
    return { isValid: false, invalidReason: "Invalid payment amount format." };
  }
  if (amount !== required) {
    return {
      isValid: false,
      invalidReason: `Payment amount ${amount} does not match exact amount ${required}.`,
    };
  }

  if (
    !payment ||
    typeof payment.token !== "string" ||
    !ADDRESS_RE.test(payment.token) ||
    !ADDRESS_RE.test(terms.tokenAddress) ||
    !ADDRESS_RE.test(terms.payToAddress)
  ) {
    return { isValid: false, invalidReason: "Invalid payment token address." };
  }

  if (!Number.isInteger(terms.chainId) || (terms.chainId ?? 0) <= 0) {
    return { isValid: false, invalidReason: "Invalid configured payment chain ID." };
  }
  const chainId = terms.chainId as number;
  if (payment.token.toLowerCase() !== terms.tokenAddress.toLowerCase()) {
    return {
      isValid: false,
      invalidReason: `Payment token ${payment.token} does not match expected ${terms.tokenAddress}.`,
    };
  }
  if (
    terms.payToAddress &&
    (typeof payment.to !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(payment.to) ||
      payment.to.toLowerCase() !== terms.payToAddress.toLowerCase())
  ) {
    return {
      isValid: false,
      invalidReason: `Payment recipient ${payment.to} does not match expected ${terms.payToAddress}.`,
    };
  }

  const relayer = privateKeyToAccount(requireRelayerPrivateKey());

  const sigResult = await verifyPermit2SignatureOffline(
    payment,
    relayer.address,
    chainId,
  );
  if (!sigResult.isValid) return sigResult;

  const fundsResult = await verifyPermit2FundsOnChain(
    payment,
    terms.tokenAddress,
    chainId,
  );
  if (!fundsResult.isValid) return fundsResult;

  return { isValid: true, payer: sigResult.payer };
}
