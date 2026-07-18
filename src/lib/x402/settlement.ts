// ---------------------------------------------------------------------------
// x402 on-chain settlement — real Permit2 USDC transfer on Celo Sepolia
//
// SERVER-ONLY. Executes the actual on-chain USDC transfer using the Permit2
// authorization signed by the buyer. Requires a relayer wallet for gas.
//
// This replaces the previous false-settlement behavior where structural
// validation alone was treated as settlement. Now every successful settlement
// MUST have a confirmed on-chain transaction receipt.
//
// Flow:
//  1. Validate Permit2 authorization from payment payload
//  2. Decode buyer's Permit2 signature
//  3. Submit permitTransferFrom on Permit2 contract via relayer wallet
//  4. Wait for transaction confirmation
//  5. Verify the Transfer event on-chain
//  6. Return SettlementReceipt with real txHash, blockNumber, etc.
//
// On ANY failure: throws with descriptive error. NEVER returns a fake receipt.
// ---------------------------------------------------------------------------

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
  type Log,
  decodeEventLog,
  keccak256,
  toHex,
  stringToHex,
} from "viem";
import { celoSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  X402_NETWORK,
  X402_USDC_ADDRESS,
  X402_PAY_TO_ADDRESS,
  X402_USDC_DECIMALS,
  requireRelayerPrivateKey,
  getDisputeBriefPriceAtomic,
  validatePayToAddress,
} from "./config";
import type { PaymentDetails, SettlementReceipt } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical Permit2 contract address — same on every EVM chain.
 * See: https://github.com/Uniswap/permit2
 */
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** Permit2 ABI (only the functions we need). */
const permit2ABI = parseAbi([
  "function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature) external",
  "function nonceBitmap(address,uint256) view returns (uint256)",
]);

/** ERC-20 Transfer event topic for verification. */
const TRANSFER_EVENT_TOPIC = keccak256(
  toHex("Transfer(address,address,uint256)"),
);

/** Standard ERC-20 ABI for event decoding. */
const erc20EventABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ---------------------------------------------------------------------------
// Types for Permit2
// ---------------------------------------------------------------------------

interface Permit2TransferDetails {
  to: `0x${string}`;
  requestedAmount: bigint;
}

// ---------------------------------------------------------------------------
// RPC client factory (lazy, cached per request)
// ---------------------------------------------------------------------------

function getRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org"
  );
}

function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: celoSepolia,
    transport: http(getRpcUrl()),
  }) as unknown as PublicClient;
}

// ---------------------------------------------------------------------------
// Main settlement function
// ---------------------------------------------------------------------------

/**
 * Execute on-chain settlement of a Permit2-authorized USDC payment.
 *
 * Takes the buyer-signed Permit2 authorization from the payment payload,
 * submits the `permitTransferFrom` call on the Permit2 contract via a relayer
 * wallet, waits for confirmation, and verifies the USDC Transfer event.
 *
 * @param payment - PaymentDetails with Permit2 signature, from, to, token, amount
 * @returns SettlementReceipt with real on-chain fields
 * @throws If any step fails — signature invalid, tx reverted, wrong Transfer event, etc.
 */
export async function settlePayment(
  payment: PaymentDetails,
): Promise<SettlementReceipt> {
  // --- Step 0: Validate configuration ---
  validatePayToAddress();

  const payTo = X402_PAY_TO_ADDRESS as `0x${string}`;
  const usdcAddress = X402_USDC_ADDRESS as `0x${string}`;
  const requiredAmount = getDisputeBriefPriceAtomic();

  // --- Step 1: Validate payment details ---
  if (!payment.signature || payment.signature === "0x") {
    throw new Error("Payment signature is missing or empty.");
  }
  if (!payment.from || !/^0x[0-9a-fA-F]{40}$/.test(payment.from)) {
    throw new Error(`Invalid buyer address: ${payment.from}`);
  }
  if (payment.to.toLowerCase() !== payTo.toLowerCase()) {
    throw new Error(
      `Payment recipient ${payment.to} does not match payTo address ${payTo}.`,
    );
  }
  if (payment.token.toLowerCase() !== usdcAddress.toLowerCase()) {
    throw new Error(
      `Payment token ${payment.token} does not match USDC address ${usdcAddress}.`,
    );
  }

  const amount = BigInt(payment.amount);
  if (amount < requiredAmount) {
    throw new Error(
      `Payment amount ${payment.amount} (${amount}) is less than required ${requiredAmount}.`,
    );
  }

  // --- Step 2: Get relayer wallet ---
  const relayerKey = requireRelayerPrivateKey();
  const relayerAccount = privateKeyToAccount(relayerKey);

  const publicClient = getPublicClient();
  const walletClient = createWalletClient({
    chain: celoSepolia,
    transport: http(getRpcUrl()),
    account: relayerAccount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // --- Step 3: Decode Permit2 authorization parameters ---
  // The payment.nonce is required for Permit2. If not provided, we try to
  // find the next unused nonce for the buyer.
  const nonce = payment.nonce
    ? BigInt(payment.nonce)
    : await getNextPermit2Nonce(publicClient, payment.from as `0x${string}`);

  const deadline = payment.deadline
    ? BigInt(payment.deadline)
    : BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour default

  // Validate deadline hasn't passed
  if (deadline < BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error(
      `Permit2 deadline has expired (deadline: ${deadline}, now: ${Math.floor(Date.now() / 1000)}).`,
    );
  }

  // The spender in the Permit2 authorization — this is who submits the tx.
  // Permit2 binds spender = msg.sender of permitTransferFrom, and the relayer
  // submits it, so the buyer-signed spender MUST equal the relayer address.
  const spender = payment.spender
    ? (payment.spender as `0x${string}`)
    : relayerAccount.address;

  if (spender.toLowerCase() !== relayerAccount.address.toLowerCase()) {
    throw new Error(
      `Permit2 spender mismatch: the buyer authorized spender ${spender}, ` +
        `but the settlement relayer is ${relayerAccount.address}. ` +
        "Permit2 requires spender == msg.sender; settlement would revert with InvalidSigner.",
    );
  }

  const signature = payment.signature as `0x${string}`;
  const buyer = payment.from as `0x${string}`;

  // --- Step 4: Submit permitTransferFrom on Permit2 contract ---
  const permit = {
    permitted: {
      token: usdcAddress,
      amount,
    },
    nonce,
    deadline,
  };
  const transferDetails: Permit2TransferDetails = {
    to: payTo,
    requestedAmount: amount,
  };

  console.log(
    `[x402][settlement] Submitting Permit2 transfer: ${amount} USDC from ${buyer} to ${payTo} via relayer ${relayerAccount.address}`,
  );

  let txHash: `0x${string}`;
  let receipt: TransactionReceipt;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txHash = await (walletClient as any).writeContract({
      address: PERMIT2_ADDRESS,
      abi: permit2ABI,
      functionName: "permitTransferFrom",
      args: [permit, transferDetails, buyer, signature],
      chain: celoSepolia,
      // Gas estimation will be automatic; add a buffer for safety
      gas: undefined as unknown as bigint,
    });

    console.log(
      `[x402][settlement] Transaction submitted: ${txHash}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown RPC error";
    // Check for common Permit2 revert reasons
    if (message.includes("AllowanceExpired")) {
      throw new Error(`Permit2 settlement reverted: allowance expired. ${message}`);
    }
    if (message.includes("InvalidSigner") || message.includes("InvalidSignature")) {
      throw new Error(`Permit2 settlement reverted: invalid signature. ${message}`);
    }
    if (message.includes("InsufficientBalance") || message.includes("transfer amount exceeds")) {
      throw new Error(`Permit2 settlement reverted: insufficient USDC balance. ${message}`);
    }
    throw new Error(`Permit2 settlement transaction failed: ${message}`);
  }

  // --- Step 5: Wait for confirmation ---
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000, // 2 minute timeout
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(
      `Settlement transaction ${txHash} failed to confirm: ${message}`,
    );
  }

  // --- Step 6: Verify transaction status ---
  if (receipt.status !== "success") {
    throw new Error(
      `Settlement transaction ${txHash} reverted on-chain (status: ${receipt.status}).`,
    );
  }

  console.log(
    `[x402][settlement] Transaction confirmed in block ${receipt.blockNumber}`,
  );

  // --- Step 7: Verify the USDC Transfer event ---
  const transferEvent = findTransferEvent(
    receipt.logs,
    usdcAddress,
    buyer,
    payTo,
    amount,
  );

  if (!transferEvent) {
    throw new Error(
      `Settlement tx ${txHash} confirmed but no valid USDC Transfer event found. ` +
        `Expected: from=${buyer}, to=${payTo}, amount=${amount}, token=${usdcAddress}.`,
    );
  }

  // --- Step 8: Build and return the settlement receipt ---
  return {
    txHash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    status: "success",
    from: buyer,
    to: payTo,
    amount: amount.toString(),
    tokenAddress: usdcAddress,
    transferEventLog: {
      logIndex: transferEvent.logIndex ?? 0,
      topics: transferEvent.topics,
      data: transferEvent.data,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: find the correct USDC Transfer event in the receipt logs
// ---------------------------------------------------------------------------

function findTransferEvent(
  logs: Log[],
  tokenAddress: `0x${string}`,
  expectedFrom: `0x${string}`,
  expectedTo: `0x${string}`,
  expectedAmount: bigint,
): Log | null {
  const expectedFromPadded = padAddressToTopic(expectedFrom);
  const expectedToPadded = padAddressToTopic(expectedTo);

  for (const log of logs) {
    // Must be from the USDC token contract
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;

    // Must be a Transfer event (topic[0] matches)
    if (!log.topics[0] || log.topics[0].toLowerCase() !== TRANSFER_EVENT_TOPIC.toLowerCase()) continue;

    // Check indexed parameters
    const fromTopic = log.topics[1]?.toLowerCase();
    const toTopic = log.topics[2]?.toLowerCase();

    if (fromTopic !== expectedFromPadded.toLowerCase()) continue;
    if (toTopic !== expectedToPadded.toLowerCase()) continue;

    // Decode the value (non-indexed, in data field)
    try {
      const decoded = decodeEventLog({
        abi: erc20EventABI,
        data: log.data,
        topics: log.topics,
        eventName: "Transfer",
      });

      if ((decoded.args as { value: bigint }).value === expectedAmount) {
        return log;
      }
    } catch {
      // Couldn't decode this log — skip
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper: pad a 20-byte address to a 32-byte topic
// ---------------------------------------------------------------------------

function padAddressToTopic(address: `0x${string}`): `0x${string}` {
  const stripped = address.slice(2).toLowerCase();
  return `0x${"0".repeat(24)}${stripped}` as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Helper: get the next unused Permit2 nonce for a user
// ---------------------------------------------------------------------------

async function getNextPermit2Nonce(
  client: PublicClient,
  user: `0x${string}`,
): Promise<bigint> {
  // This is a simplified nonce discovery. In production, you'd iterate through
  // the nonceBitmap to find the first unused nonce. For the demo, we accept
  // that the nonce MUST be provided in the payment details.
  throw new Error(
    "Payment nonce is required for Permit2 settlement. " +
      "The payment payload must include a valid Permit2 nonce.",
  );
}
