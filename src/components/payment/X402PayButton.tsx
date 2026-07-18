"use client";

// ---------------------------------------------------------------------------
// X402PayButton — Client component for initiating x402 payment flows
//
// Real browser authorization flow using Permit2 signed typed data:
//
// 1. Displays service description, price, and payTo address
// 2. On "Pay": validates wallet connection, network (Celo Sepolia), USDC balance
// 3. Fetches PAYMENT-REQUIRED from the API to get payment requirements
// 4. Builds a Permit2 `PermitTransferFrom` typed-data message
// 5. Prompts user to sign via their wallet (wagmi useSignTypedData)
// 6. Builds PaymentPayload with the Permit2 signature
// 7. Sends to API with PAYMENT-SIGNATURE header
// 8. Handles all states: pending, confirming, success (real txHash), error
// 9. On success: shows real txHash with Blockscout link
//
// CRITICAL: This component NEVER uses a deployer private key.
// All signing happens in the user's wallet.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { useSignTypedData, useReadContract, useBalance } from "wagmi";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { getCeloExplorerTxUrl } from "@/lib/web3/chains";
import {
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_SPENDER_ADDRESS,
  X402_DISPUTE_BRIEF_PRICE,
} from "@/lib/x402/config.public";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical Permit2 contract address — same on every EVM chain. */
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** USDC token address on Celo Sepolia (canonical). */
const USDC_CELO_SEPOLIA = "0x01C5C0122039549AD1493B8220cABEdD739BC44E" as const;

/** USDC decimals. */
const USDC_DECIMALS = 6;

/** Price in atomic units (human price × 10^decimals). */
function humanToAtomic(price: string): bigint {
  const parts = price.split(".");
  const whole = BigInt(parts[0] ?? "0");
  const fraction = (parts[1] ?? "")
    .slice(0, USDC_DECIMALS)
    .padEnd(USDC_DECIMALS, "0");
  return whole * BigInt(10 ** USDC_DECIMALS) + BigInt(fraction);
}

/** Permit2 EIP-712 domain. */
const PERMIT2_DOMAIN = {
  name: "Permit2",
  chainId: 11142220,
  verifyingContract: PERMIT2_ADDRESS as `0x${string}`,
} as const;

/** Permit2 PermitTransferFrom typed-data type definitions. */
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface X402PayButtonProps {
  /** The dispute brief request body to submit after payment. */
  disputeRequest: Record<string, unknown>;

  /** Called when the brief is successfully returned. */
  onBriefReady?: (brief: unknown) => void;

  /** Called when an error occurs. */
  onError?: (error: string) => void;
}

type FlowState =
  | "idle"
  | "fetching-requirements"
  | "ready-to-sign"
  | "signing"
  | "submitting"
  | "settling"
  | "success"
  | "error"
  | "no-wallet"
  | "wrong-network"
  | "insufficient-balance";

interface SettlementInfo {
  txHash: string;
  blockNumber: string;
  from: string;
  to: string;
  amount: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Safely parse a Response body as JSON.  Falls back to reading the raw text
 * when content-type is not JSON or the parse fails, so we never lose the
 * server's actual error message behind a JSON parsing exception.
 */
async function safeParseJSON(response: Response): Promise<{ data: Record<string, unknown>; raw: string }> {
  const raw = await response.text().catch(() => "");
  if (!raw) return { data: {}, raw: "" };
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: {}, raw };
  }
}

export default function X402PayButton({
  disputeRequest,
  onBriefReady,
  onError,
}: X402PayButtonProps) {
  const wallet = useWalletState();
  const { requireWallet } = useRequireWallet();
  const { signTypedDataAsync } = useSignTypedData();

  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [briefData, setBriefData] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string>("");
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  const [paymentNonce, setPaymentNonce] = useState<bigint>(BigInt(0));

  // -----------------------------------------------------------------------
  // Read USDC balance via ERC-20 balanceOf
  // -----------------------------------------------------------------------

  const {
    data: usdcBalanceRaw,
  } = useReadContract({
    address: USDC_CELO_SEPOLIA,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: wallet.address ? [wallet.address as `0x${string}`] : undefined,
    chainId: 11142220,
    query: { enabled: !!wallet.address && wallet.chainSupported },
  });

  const usdcBalanceRawBigInt = (usdcBalanceRaw as bigint) ?? BigInt(0);

  const requiredAtomic = useMemo(
    () => humanToAtomic(X402_DISPUTE_BRIEF_PRICE),
    [],
  );

  const hasSufficientBalance = useMemo(() => {
    return usdcBalanceRawBigInt >= requiredAtomic;
  }, [usdcBalanceRawBigInt, requiredAtomic]);

  // -----------------------------------------------------------------------
  // Generate a unique nonce for this payment attempt
  // -----------------------------------------------------------------------

  const generateNonce = useCallback(() => {
    // Use timestamp + random for a unique nonce per signing attempt
    return BigInt(Date.now()) * BigInt(1_000_000) + BigInt(Math.floor(Math.random() * 1_000_000));
  }, []);

  // -----------------------------------------------------------------------
  // Build and sign the Permit2 authorization
  // -----------------------------------------------------------------------

  const signPermit2Authorization = useCallback(async () => {
    if (!wallet.address) throw new Error("Wallet not connected.");

    const nonce = generateNonce();
    setPaymentNonce(nonce);

    // Deadline: 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // The spender must be the address that will call permitTransferFrom
    // on-chain. Permit2 binds spender = msg.sender, and the server relayer
    // submits the settlement transaction — so this is the relayer's PUBLIC
    // address (NEXT_PUBLIC_X402_SPENDER_ADDRESS), falling back to payTo.
    const spender = X402_SPENDER_ADDRESS as `0x${string}`;

    const message = {
      permitted: {
        token: USDC_CELO_SEPOLIA as `0x${string}`,
        amount: requiredAtomic,
      },
      spender,
      nonce,
      deadline,
    } as const;

    const signature = await signTypedDataAsync({
      domain: PERMIT2_DOMAIN,
      types: PERMIT2_TYPES,
      primaryType: "PermitTransferFrom",
      message,
    });

    return {
      signature,
      from: wallet.address,
      to: X402_PAY_TO_ADDRESS,
      token: USDC_CELO_SEPOLIA,
      amount: requiredAtomic.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      spender,
    };
  }, [wallet.address, requiredAtomic, generateNonce, signTypedDataAsync]);

  // -----------------------------------------------------------------------
  // Submit the payment-gated request
  // -----------------------------------------------------------------------

  const handlePay = useCallback(async () => {
    if (!wallet.address) {
      setFlowState("no-wallet");
      setErrorMessage("Connect your wallet to proceed.");
      return;
    }

    // Step 1: Fetch PAYMENT-REQUIRED from API
    setFlowState("fetching-requirements");
    setErrorMessage("");

    try {
      const initialResponse = await fetch("/api/x402/dispute-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(disputeRequest),
      });

      if (initialResponse.status !== 402) {
        const { data, raw } = await safeParseJSON(initialResponse);
        const serverError = (data as Record<string, unknown>).error || raw || "Unexpected response";
        if (initialResponse.ok && data.brief) {
          // Server returned brief without payment (unconfigured mode)
          setCorrelationId((data.correlationId as string) || "");
          setBriefData(JSON.stringify(data.brief, null, 2));
          setFlowState("success");
          if (onBriefReady) onBriefReady(data.brief);
          return;
        }
        setFlowState("error");
        setErrorMessage(
          (serverError as string) || `Unexpected response: ${initialResponse.status}`,
        );
        if (onError) onError((serverError as string) || "Unexpected response.");
        return;
      }

      // Got 402 — decode requirements
      const paymentRequiredHeader =
        initialResponse.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        setFlowState("error");
        setErrorMessage("Server did not return payment requirements.");
        return;
      }

      // Decode and validate
      let requirements: unknown;
      try {
        requirements = decodePaymentRequiredHeader(paymentRequiredHeader);
      } catch {
        setFlowState("error");
        setErrorMessage("Failed to decode payment requirements.");
        return;
      }

      console.log("Payment requirements:", requirements);

      // Step 2: Show requirements to user, prompt for signing
      setFlowState("ready-to-sign");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error.";
      setFlowState("error");
      setErrorMessage(message);
      if (onError) onError(message);
    }
  }, [wallet.address, disputeRequest, onBriefReady, onError]);

  // -----------------------------------------------------------------------
  // Sign and submit (called after user confirms in "ready-to-sign" state)
  // -----------------------------------------------------------------------

  const handleSignAndSubmit = useCallback(async () => {
    try {
      // Step 3: Sign Permit2 authorization
      setFlowState("signing");
      const paymentDetails = await signPermit2Authorization();

      // Step 4: Build payment payload
      const paymentPayload = {
        scheme: "exact",
        network: X402_NETWORK,
        payment: paymentDetails,
        requestId: crypto.randomUUID(),
      };

      const paymentSignatureHeader = btoa(JSON.stringify(paymentPayload));

      // Step 5: Submit to API
      setFlowState("submitting");
      const response = await fetch("/api/x402/dispute-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": paymentSignatureHeader,
        },
        body: JSON.stringify(disputeRequest),
      });

      const { data, raw } = await safeParseJSON(response);

      if (!response.ok) {
        setFlowState("error");
        const serverMsg = (data as Record<string, unknown>).error || raw || "Payment failed";
        const msg = `${serverMsg} (HTTP ${response.status})`;
        setErrorMessage(msg);
        if (onError) onError(msg);
        return;
      }

      // Step 6: Success
      setCorrelationId((data.correlationId as string) || "");

      if (((data as Record<string, unknown>).settlement as Record<string, unknown>)?.txHash) {
        const s = data.settlement as Record<string, unknown>;
        setSettlement({
          txHash: String(s.txHash),
          blockNumber: String(s.blockNumber ?? "pending"),
          from: String(s.from),
          to: String(s.to),
          amount: String(s.amount),
        });
      }

      setBriefData(JSON.stringify(data.brief || data, null, 2));
      setFlowState("success");
      if (onBriefReady) onBriefReady(data.brief || (data as Record<string, unknown>));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment error.";
      // Detect user rejection
      if (
        message.includes("rejected") ||
        message.includes("denied") ||
        message.includes("cancelled")
      ) {
        setFlowState("idle");
        setErrorMessage("Signing was cancelled. Please try again.");
      } else {
        setFlowState("error");
        setErrorMessage(message);
        if (onError) onError(message);
      }
    }
  }, [signPermit2Authorization, disputeRequest, onBriefReady, onError]);

  // -----------------------------------------------------------------------
  // Wallet-gated click handler
  // -----------------------------------------------------------------------

  const handleClick = useCallback(() => {
    requireWallet(() => {
      // Check network
      if (!wallet.chainSupported) {
        setFlowState("wrong-network");
        setErrorMessage(
          "Please switch to Celo Sepolia network to use this service.",
        );
        return;
      }

      // Check balance
      if (!hasSufficientBalance) {
        setFlowState("insufficient-balance");
        setErrorMessage(
          `Insufficient USDC balance. You need at least $${X402_DISPUTE_BRIEF_PRICE} USDC on Celo Sepolia.`,
        );
        return;
      }

      // Start payment flow
      handlePay();
    });
  }, [requireWallet, wallet.chainSupported, hasSufficientBalance, handlePay]);

  // -----------------------------------------------------------------------
  // Derived display state
  // -----------------------------------------------------------------------

  const payToShort = X402_PAY_TO_ADDRESS
    ? `${X402_PAY_TO_ADDRESS.slice(0, 6)}…${X402_PAY_TO_ADDRESS.slice(-4)}`
    : "Not configured";

  const isReady =
    wallet.isConnected &&
    wallet.chainSupported &&
    hasSufficientBalance &&
    X402_PAY_TO_ADDRESS.length > 0;

  const buttonLabel = useMemo(() => {
    switch (flowState) {
      case "fetching-requirements":
        return "Fetching requirements…";
      case "ready-to-sign":
        return "Sign to pay…";
      case "signing":
        return "Sign in wallet…";
      case "submitting":
        return "Submitting payment…";
      case "settling":
        return "Settling on-chain…";
      default:
        return `Pay $${X402_DISPUTE_BRIEF_PRICE} and prepare brief`;
    }
  }, [flowState]);

  // -----------------------------------------------------------------------
  // Render: success state — show the brief + settlement details
  // -----------------------------------------------------------------------

  if (flowState === "success") {
    return (
      <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-4">
        <Notice variant="success">
          <p className="text-[14px] leading-relaxed">
            Payment settled. Dispute brief generated successfully.
          </p>
        </Notice>

        {settlement && (
          <div className="rounded-[--radius-card] border border-border bg-page p-4 space-y-2">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
              Settlement Details
            </p>
            <div className="space-y-1 text-[12px] font-[family-name:var(--font-ibm-plex-mono)]">
              <div className="flex justify-between">
                <span className="text-muted">Transaction</span>
                <a
                  href={getCeloExplorerTxUrl(settlement.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold hover:underline truncate max-w-[200px]"
                  title={settlement.txHash}
                >
                  {`${settlement.txHash.slice(0, 10)}…${settlement.txHash.slice(-8)}`}
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Block</span>
                <span className="text-ink tabular-nums">
                  {settlement.blockNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Amount</span>
                <span className="text-ink tabular-nums">
                  {Number(settlement.amount) / 10 ** USDC_DECIMALS} USDC
                </span>
              </div>
            </div>
            <a
              href={getCeloExplorerTxUrl(settlement.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-[12px] text-gold hover:underline"
            >
              View on Blockscout →
            </a>
          </div>
        )}

        {correlationId && (
          <p className="text-[12px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            Correlation ID: {correlationId}
          </p>
        )}

        {briefData && (
          <div className="rounded-[--radius-card] border border-border bg-page p-4 max-h-[500px] overflow-y-auto">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">
              Generated Brief
            </p>
            <pre className="text-[12px] font-[family-name:var(--font-ibm-plex-mono)] text-ink whitespace-pre-wrap break-words">
              {briefData}
            </pre>
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFlowState("idle");
            setBriefData(null);
            setSettlement(null);
            setErrorMessage("");
          }}
        >
          Prepare another brief
        </Button>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: main service card
  // -----------------------------------------------------------------------

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-5">
      {/* Service header */}
      <div>
        <h3 className="text-[16px] font-semibold text-ink">
          AI dispute preparation brief
        </h3>
        <p className="mt-1 text-[14px] text-muted leading-relaxed">
          Generate a structured dispute brief from on-chain payment data
          and your submitted details. No AI decides the outcome — people do.
        </p>
      </div>

      {/* Price and payment info */}
      <div className="rounded-[--radius-card] border border-border bg-page p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted">Service price</span>
          <span className="text-[15px] font-semibold text-ink tabular-nums">
            ${X402_DISPUTE_BRIEF_PRICE} USDC
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted">Network</span>
          <span className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink">
            Celo Sepolia
          </span>
        </div>
        {wallet.address && usdcBalanceRawBigInt !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">Your balance</span>
            <span
              className={`text-[13px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums ${
                hasSufficientBalance ? "text-ink" : "text-gold"
              }`}
            >
              {Number(usdcBalanceRawBigInt) / 10 ** USDC_DECIMALS} USDC
            </span>
          </div>
        )}
        {X402_PAY_TO_ADDRESS && (
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">Service wallet</span>
            <span className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted">
              {payToShort}
            </span>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-[13px] italic text-muted leading-relaxed">
        AI prepares the case. People decide. The contract settles.
      </p>

      {/* Error state */}
      {flowState === "error" && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{errorMessage}</p>
          <button
            type="button"
            className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
            onClick={() => setFlowState("idle")}
          >
            Dismiss
          </button>
        </Notice>
      )}

      {/* Wrong network warning */}
      {flowState === "wrong-network" && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{errorMessage}</p>
        </Notice>
      )}

      {/* Insufficient balance warning */}
      {flowState === "insufficient-balance" && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{errorMessage}</p>
        </Notice>
      )}

      {/* Loading / status states */}
      {["fetching-requirements", "signing", "submitting", "settling"].includes(
        flowState,
      ) && (
        <div className="flex items-center gap-3 text-[14px] text-muted">
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="30 10"
            />
          </svg>
          {flowState === "fetching-requirements" &&
            "Fetching payment requirements…"}
          {flowState === "signing" &&
            "Please sign the Permit2 authorization in your wallet…"}
          {flowState === "submitting" &&
            "Submitting payment to server…"}
          {flowState === "settling" &&
            "Settling payment on-chain (Permit2)…"}
        </div>
      )}

      {/* Ready to sign: show confirmation prompt */}
      {flowState === "ready-to-sign" && (
        <div className="rounded-[--radius-card] border border-gold/30 bg-gold/5 p-4 space-y-3">
          <p className="text-[14px] font-medium text-ink">
            Confirm payment of ${X402_DISPUTE_BRIEF_PRICE} USDC
          </p>
          <p className="text-[13px] text-muted leading-relaxed">
            You will be prompted to sign a Permit2 authorization in your wallet.
            This authorizes the transfer of USDC from your wallet to the service
            wallet. Gas fees (CELO) for settlement are covered by the service.
          </p>
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSignAndSubmit}
              disabled={(flowState as FlowState) === "signing"}
            >
              Sign and pay ${X402_DISPUTE_BRIEF_PRICE} USDC
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFlowState("idle")}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Action button (idle state) */}
      {flowState === "idle" && (
        <Button
          variant="primary"
          size="lg"
          onClick={handleClick}
          disabled={!isReady}
          className="w-full"
        >
          {buttonLabel}
        </Button>
      )}

      {/* Wallet not connected hint */}
      {!wallet.isConnected && (
        <p className="text-[12px] text-muted text-center">
          Connect your wallet to proceed.
        </p>
      )}
      {wallet.isConnected && !wallet.chainSupported && (
        <p className="text-[12px] text-muted text-center">
          Switch to Celo Sepolia network to continue.
        </p>
      )}
      {wallet.isConnected && wallet.chainSupported && !hasSufficientBalance && (
        <p className="text-[12px] text-gold text-center">
          Insufficient USDC balance. Get testnet USDC from the Celo faucet.
        </p>
      )}
      {!X402_PAY_TO_ADDRESS && (
        <p className="text-[12px] text-muted text-center">
          x402 payment processing is not configured.
        </p>
      )}
    </div>
  );
}
