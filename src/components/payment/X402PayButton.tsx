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
import AICaseBriefDisplay from "./AICaseBriefDisplay";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import {
  useSignTypedData,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { getCeloExplorerTxUrl, getCeloMainnetExplorerTxUrl } from "@/lib/web3/chains";
import { normalizeForJson } from "@/lib/x402/jsonSafe";
import {
  X402_NETWORK,
  X402_PAY_TO_ADDRESS,
  X402_SPENDER_ADDRESS,
  X402_DISPUTE_BRIEF_PRICE,
  X402_FACILITATOR_NETWORK,
  X402_FACILITATOR_USDC_MAINNET,
  X402_PAY_TO_ADDRESS_FACILITATOR,
  CELO_MAINNET_CHAIN_ID,
  isFacilitatorMode,
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

/** Permit2 PermitTransferFrom typed-data type definitions (chain-agnostic). */
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
  | "needs-approval"
  | "approving"
  | "fetching-requirements"
  | "ready-to-sign"
  | "signing"
  | "submitting"
  | "settling"
  | "success"
  | "checking-cached"
  | "retrieving-brief"
  | "error"
  | "no-wallet"
  | "wrong-network"
  | "wrong-network-facilitator"
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
  const [briefData, setBriefData] = useState<unknown>(null);
  const [correlationId, setCorrelationId] = useState<string>("");
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  const [generationMode, setGenerationMode] = useState<string>("");
  const [usedFallback, setUsedFallback] = useState<boolean>(false);
  const [paymentId, setPaymentId] = useState<string>("");

  // -----------------------------------------------------------------------
  // Mode detection — local (Sepolia) vs facilitator (mainnet)
  // -----------------------------------------------------------------------

  const facilitatorMode = isFacilitatorMode();

  const activeNetwork = facilitatorMode
    ? X402_FACILITATOR_NETWORK
    : X402_NETWORK;
  const activeUSDC = facilitatorMode
    ? X402_FACILITATOR_USDC_MAINNET
    : USDC_CELO_SEPOLIA;
  const activePayTo = facilitatorMode
    ? X402_PAY_TO_ADDRESS_FACILITATOR
    : X402_PAY_TO_ADDRESS;
  const activeChainId = facilitatorMode
    ? CELO_MAINNET_CHAIN_ID
    : 11142220;
  const activeChainName = facilitatorMode ? "Celo Mainnet" : "Celo Sepolia";

  // -----------------------------------------------------------------------
  // Chain switching (for facilitator mode — switch to Celo mainnet)
  // -----------------------------------------------------------------------

  const { switchChain } = useSwitchChain();

  // -----------------------------------------------------------------------
  // Read USDC balance via ERC-20 balanceOf
  // -----------------------------------------------------------------------

  const {
    data: usdcBalanceRaw,
  } = useReadContract({
    address: activeUSDC as `0x${string}`,
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
    chainId: activeChainId,
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
  // Read Permit2 allowance for USDC
  // -----------------------------------------------------------------------

  const {
    data: permit2AllowanceRaw,
    refetch: refetchAllowance,
  } = useReadContract({
    address: activeUSDC as `0x${string}`,
    abi: [
      {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "allowance",
    args: wallet.address
      ? [wallet.address as `0x${string}`, PERMIT2_ADDRESS as `0x${string}`]
      : undefined,
    chainId: activeChainId,
    query: { enabled: !!wallet.address && wallet.chainSupported },
  });

  const permit2Allowance = (permit2AllowanceRaw as bigint) ?? BigInt(0);
  const hasSufficientAllowance = permit2Allowance >= requiredAtomic;

  // -----------------------------------------------------------------------
  // Approve USDC for Permit2
  // -----------------------------------------------------------------------

  const {
    writeContract: approveUSDC,
    data: approveTxHash,
  } = useWriteContract();

  const { isLoading: isApproving, isSuccess: isApproved } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // When approval tx confirms, refetch allowance and transition to idle
  if (flowState === "approving" && isApproved) {
    refetchAllowance();
    setFlowState("idle");
    setErrorMessage("");
  }

  const handleApprove = useCallback(() => {
    setFlowState("approving");
    setErrorMessage("");
    approveUSDC({
      address: activeUSDC as `0x${string}`,
      abi: [
        {
          name: "approve",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [PERMIT2_ADDRESS as `0x${string}`, requiredAtomic],
      chainId: activeChainId,
    });
  }, [approveUSDC, requiredAtomic, activeUSDC, activeChainId]);

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

    // Deadline: 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // The spender must be the address that will call permitTransferFrom
    // on-chain. Permit2 binds spender = msg.sender, and the server relayer
    // submits the settlement transaction — so this is the relayer's PUBLIC
    // address (NEXT_PUBLIC_X402_SPENDER_ADDRESS), falling back to payTo.
    const spender = X402_SPENDER_ADDRESS as `0x${string}`;

    // Permit2 EIP-712 domain — chainId depends on active settlement mode.
    const permit2Domain = {
      name: "Permit2",
      chainId: activeChainId,
      verifyingContract: PERMIT2_ADDRESS as `0x${string}`,
    };

    const message = {
      permitted: {
        token: activeUSDC as `0x${string}`,
        amount: requiredAtomic,
      },
      spender,
      nonce,
      deadline,
    } as const;

    const signature = await signTypedDataAsync({
      domain: permit2Domain,
      types: PERMIT2_TYPES,
      primaryType: "PermitTransferFrom",
      message,
    });

    return {
      signature,
      from: wallet.address,
      to: activePayTo,
      token: activeUSDC,
      amount: requiredAtomic.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      spender,
    };
  }, [wallet.address, requiredAtomic, generateNonce, signTypedDataAsync, activeUSDC, activeChainId, activePayTo]);

  // -----------------------------------------------------------------------
  // EIP-3009 TransferWithAuthorization — used in facilitator (mainnet) mode
  // instead of Permit2. The facilitator's ExactEvmScheme uses EIP-3009 by
  // default when assetTransferMethod is not "permit2" in extra.
  // -----------------------------------------------------------------------

  /** EIP-712 domain for USDC on Celo mainnet (verified on-chain). */
  const USDC_EIP3009_DOMAIN = {
    name: "USDC",
    version: "2",
    chainId: 42220,
    verifyingContract: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
  } as const;

  /** EIP-3009 TransferWithAuthorization typed-data types. */
  const EIP3009_TYPES = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const signEIP3009Authorization = useCallback(async () => {
    if (!wallet.address) throw new Error("Wallet not connected.");

    const now = Math.floor(Date.now() / 1000);
    const validBefore = BigInt(now + 3600); // 1 hour deadline
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonce = "0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join("");

    const authorization = {
      from: wallet.address as `0x${string}`,
      to: activePayTo as `0x${string}`,
      value: requiredAtomic,
      validAfter: BigInt(0),
      validBefore,
      nonce: nonce as `0x${string}`,
    };

    const signature = await signTypedDataAsync({
      domain: USDC_EIP3009_DOMAIN,
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });

    return { authorization, signature };
  }, [wallet.address, requiredAtomic, activePayTo, signTypedDataAsync]);

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
      // Include walletAddress in preflight body so the server can compute
      // the canonical request hash including the payer (no signature needed).
      const preflightBody = { ...disputeRequest, walletAddress: wallet.address };
      const initialResponse = await fetch("/api/x402/dispute-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeForJson(preflightBody)),
      });

      if (initialResponse.status !== 402) {
        const { data, raw } = await safeParseJSON(initialResponse);
        const body = data as Record<string, unknown>;
        const serverError = body.error || raw || "Unexpected response";

        // Pre-payment recovery: request already paid — brief exists.
        if (initialResponse.ok && body.status === "settled" && body.brief) {
          setCorrelationId((body.correlationId as string) || "");
          setPaymentId((body.paymentId as string) || "");
          if ((body.settlement as Record<string, unknown>)?.txHash) {
            const s = body.settlement as Record<string, unknown>;
            setSettlement({
              txHash: String(s.txHash),
              blockNumber: String(s.blockNumber ?? ""),
              from: String(s.from),
              to: String(s.to),
              amount: String(s.amount),
            });
          }
          setBriefData(body.brief || body);
          setGenerationMode((body.generationMode as string) || "");
          setFlowState("success");
          if (onBriefReady) onBriefReady(body.brief);
          return;
        }

        // Pre-payment recovery: request already paid — brief pending.
        if (initialResponse.ok && body.status === "paid_pending_brief") {
          // Retrigger as a brief-only recovery POST with paymentId header
          const recoveryPid = (body.paymentId as string) || "";
          if (recoveryPid) {
            try {
              setFlowState("retrieving-brief");
              const recoveryRes = await fetch("/api/x402/dispute-brief", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Payment-Id": recoveryPid,
                },
                body: JSON.stringify(normalizeForJson(disputeRequest)),
              });
              const { data: recoveryData } = await safeParseJSON(recoveryRes);
              const recBody = recoveryData as Record<string, unknown>;
              if (recoveryRes.ok && recBody.brief) {
                setCorrelationId((recBody.correlationId as string) || "");
                setPaymentId(recoveryPid);
                if ((recBody.settlement as Record<string, unknown>)?.txHash) {
                  const s = recBody.settlement as Record<string, unknown>;
                  setSettlement({ txHash: String(s.txHash), blockNumber: String(s.blockNumber ?? ""), from: String(s.from), to: String(s.to), amount: String(s.amount) });
                }
                setBriefData(recBody.brief || recBody);
                setGenerationMode((recBody.generationMode as string) || "");
                setFlowState("success");
                if (onBriefReady) onBriefReady(recBody.brief);
                return;
              }
            } catch {}
            setFlowState("error");
            setErrorMessage("Brief recovery failed. Please try again.");
            return;
          }
        }

        if (initialResponse.ok && data.brief) {
          // Server returned brief without payment (unconfigured mode)
          setCorrelationId((body.correlationId as string) || "");
          setBriefData(JSON.stringify(normalizeForJson(data.brief), null, 2));
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
      setFlowState("signing");

      // Step 3: Sign authorization — Permit2 for local mode, EIP-3009 for facilitator
      if (facilitatorMode) {
        const { authorization, signature } = await signEIP3009Authorization();
        // EIP-3009 payload: authorization + signature sent to official facilitator.
        // Convert BigInt fields to decimal strings for JSON-safe wire format.
        // The typed-data signing requires BigInt; the wire format requires strings.
        const paymentPayload = {
          scheme: "exact",
          network: activeNetwork,
          payment: {
            authorization: {
              from: authorization.from,
              to: authorization.to,
              value: authorization.value.toString(),
              validAfter: authorization.validAfter.toString(),
              validBefore: authorization.validBefore.toString(),
              nonce: authorization.nonce,
            },
            signature,
          },
          requestId: crypto.randomUUID(),
        };

        const paymentSignatureHeader = btoa(JSON.stringify(normalizeForJson(paymentPayload)));

        setFlowState("submitting");
        const reqHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": paymentSignatureHeader,
        };
        if (paymentId) {
          reqHeaders["X-Payment-Id"] = paymentId;
        }
        const response = await fetch("/api/x402/dispute-brief", {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(normalizeForJson(disputeRequest)),
        });

        const responsePaymentId = response.headers.get("X-Payment-Id");
        if (responsePaymentId) setPaymentId(responsePaymentId);

        const { data, raw } = await safeParseJSON(response);

        if (!response.ok) {
          setFlowState("error");
          const serverMsg = (data as Record<string, unknown>).error || raw || "Payment failed";
          setErrorMessage(`${serverMsg} (HTTP ${response.status})`);
          if (onError) onError(`${serverMsg} (HTTP ${response.status})`);
          return;
        }

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
        setBriefData(data.brief || data);
        setGenerationMode((data as Record<string, unknown>).generationMode as string || "");
        setUsedFallback(Boolean((data as Record<string, unknown>).usedFallback));
        setFlowState("success");
        if (onBriefReady) onBriefReady(data.brief || (data as Record<string, unknown>));
        return;
      }

      // LOCAL mode — Permit2 authorization (existing flow)
      const paymentDetails = await signPermit2Authorization();

      // Step 4: Build payment payload
      const paymentPayload = {
        scheme: "exact",
        network: activeNetwork,
        payment: paymentDetails,
        requestId: crypto.randomUUID(),
      };

          const paymentSignatureHeader = btoa(JSON.stringify(normalizeForJson(paymentPayload)));

          // Step 5: Submit to API (include existing paymentId for idempotency)
          setFlowState("submitting");
          const reqHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "PAYMENT-SIGNATURE": paymentSignatureHeader,
          };
          if (paymentId) {
            reqHeaders["X-Payment-Id"] = paymentId;
          }
          const response = await fetch("/api/x402/dispute-brief", {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify(normalizeForJson(disputeRequest)),
          });

      // Store payment ID from response for future idempotency
      const responsePaymentId = response.headers.get("X-Payment-Id");
      if (responsePaymentId) setPaymentId(responsePaymentId);

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

      setBriefData(data.brief || data);
      setGenerationMode((data as Record<string, unknown>).generationMode as string || "");
      setUsedFallback(Boolean((data as Record<string, unknown>).usedFallback));
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
  }, [signPermit2Authorization, signEIP3009Authorization, facilitatorMode, disputeRequest, onBriefReady, onError, activeNetwork, paymentId]);

  // -----------------------------------------------------------------------
  // Check cached/paid state without paying
  // -----------------------------------------------------------------------

  const handleCheckCached = useCallback(async (pid: string) => {
    setFlowState("checking-cached");
    try {
      const res = await fetch(`/api/x402/dispute-brief?paymentId=${encodeURIComponent(pid)}`);
      const { data } = await safeParseJSON(res);
      const body = data as Record<string, unknown>;
      if (body.status === "settled" || body.status === "paid_pending_brief") {
        setBriefData(body.brief || body);
        setGenerationMode((body.generationMode as string) || "");
        setUsedFallback(Boolean(body.usedFallback));
        if ((body.settlement as Record<string, unknown>)?.txHash) {
          const s = body.settlement as Record<string, unknown>;
          setSettlement({ txHash: String(s.txHash), blockNumber: String(s.blockNumber ?? ""), from: String(s.from), to: String(s.to), amount: String(s.amount) });
        }
        setCorrelationId((body.paymentId as string) || pid);
        setFlowState("success");
        return;
      }
      if (body.status === "failed") {
        setFlowState("idle");
        setPaymentId("");
        return;
      }
    } catch {}
    setFlowState("idle");
  }, []);

  // -----------------------------------------------------------------------
  // Wallet-gated click handler
  // -----------------------------------------------------------------------

  const handleClick = useCallback(() => {
    requireWallet(() => {
      // Mode-specific chain check: only the correct chain for the
      // active settlement mode is allowed through.
      const isCorrectChainForMode = facilitatorMode
        ? wallet.chainId === CELO_MAINNET_CHAIN_ID
        : wallet.chainId === 11142220;

      if (!isCorrectChainForMode) {
        if (facilitatorMode) {
          setFlowState("wrong-network-facilitator");
          setErrorMessage(
            "AI brief payment uses Celo Mainnet. Please switch networks.",
          );
        } else {
          setFlowState("wrong-network");
          setErrorMessage("Please switch to Celo Sepolia network.");
        }
        return;
      }
      if (!hasSufficientBalance) {
        setFlowState("insufficient-balance");
        setErrorMessage(`Insufficient USDC. Need at least $${X402_DISPUTE_BRIEF_PRICE}.`);
        return;
      }
      if (!hasSufficientAllowance && !facilitatorMode) {
        setFlowState("needs-approval");
        setErrorMessage(`Permit2 allowance is ${Number(permit2Allowance) / 10 ** USDC_DECIMALS} USDC — 0.01 needed.`);
        return;
      }

      // If we already have a payment ID from a prior settlement, check cached state first
      if (paymentId) {
        handleCheckCached(paymentId);
        return;
      }

      handlePay();
    });
  }, [requireWallet, facilitatorMode, wallet.chainId, hasSufficientBalance, hasSufficientAllowance, permit2Allowance, paymentId, handleCheckCached, handlePay]);

  // -----------------------------------------------------------------------
  // Derived display state
  // -----------------------------------------------------------------------

  const payToShort = activePayTo
    ? `${activePayTo.slice(0, 6)}…${activePayTo.slice(-4)}`
    : "Not configured";

  const isReady =
    wallet.isConnected &&
    wallet.chainId === activeChainId &&
    hasSufficientBalance &&
    activePayTo.length > 0;

  const buttonLabel = useMemo(() => {
    switch (flowState) {
      case "checking-cached":
        return "Checking existing brief...";
      case "retrieving-brief":
        return "Loading brief...";
      case "fetching-requirements":
        return "Fetching requirements...";
      case "needs-approval":
        return "Approve 0.01 USDC first";
      case "approving":
        return "Confirming approval...";
      case "ready-to-sign":
        return "Sign to pay...";
      case "signing":
        return "Sign in wallet...";
      case "submitting":
        return "Submitting payment...";
      case "settling":
        return "Settling on-chain...";
      default:
        return paymentId ? "View prepared brief" : `Pay $${X402_DISPUTE_BRIEF_PRICE} and prepare brief`;
    }
  }, [flowState, paymentId]);

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
                  href={
                    facilitatorMode
                      ? getCeloMainnetExplorerTxUrl(settlement.txHash)
                      : getCeloExplorerTxUrl(settlement.txHash)
                  }
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
              href={
                facilitatorMode
                  ? getCeloMainnetExplorerTxUrl(settlement.txHash)
                  : getCeloExplorerTxUrl(settlement.txHash)
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-[12px] text-gold hover:underline"
            >
              {facilitatorMode ? "View on Celoscan →" : "View on Blockscout →"}
            </a>
          </div>
        )}

        {correlationId && (
          <p className="text-[12px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
            Correlation ID: {correlationId}
          </p>
        )}

        {briefData ? (
          <div className="max-h-[600px] overflow-y-auto">
            <AICaseBriefDisplay
              brief={briefData as Record<string, unknown>}
              generationMode={generationMode}
              usedFallback={usedFallback}
            />
          </div>
        ) : null}

        {/* Copy & download actions */}
        {briefData ? (
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(briefData, null, 2));
              }}
            >
              Copy brief JSON
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const blob = new Blob([JSON.stringify(briefData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "reclaim-dispute-brief.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download JSON
            </Button>
          </div>
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFlowState("idle");
            setBriefData(null);
            setSettlement(null);
            setGenerationMode("");
            setUsedFallback(false);
            setPaymentId("");
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
        {facilitatorMode && (
          <p className="mt-2 text-[12px] font-medium text-gold uppercase tracking-wider">
            Track 2 — Celo x402 Facilitator
          </p>
        )}
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
            {activeChainName}
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
        {activePayTo && (
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

      {/* Wrong network — facilitator mode (needs Celo mainnet) */}
      {flowState === "wrong-network-facilitator" && (
        <div className="rounded-[--radius-card] border border-gold/30 bg-gold/5 p-4 space-y-3">
          <p className="text-[14px] font-medium text-ink">
            AI brief payment uses Celo Mainnet
          </p>
          <p className="text-[13px] text-muted leading-relaxed">
            {errorMessage}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => switchChain({ chainId: CELO_MAINNET_CHAIN_ID })}
          >
            Switch to Celo Mainnet
          </Button>
        </div>
      )}

      {/* Insufficient balance warning */}
      {flowState === "insufficient-balance" && (
        <Notice variant="warning">
          <p className="text-[14px] leading-relaxed">{errorMessage}</p>
        </Notice>
      )}

      {/* Permit2 approval needed */}
      {flowState === "needs-approval" && (
        <div className="rounded-[--radius-card] border border-gold/30 bg-gold/5 p-4 space-y-3">
          <p className="text-[14px] font-medium text-ink">
            Permit2 allowance required
          </p>
          <p className="text-[13px] text-muted leading-relaxed">
            Your wallet has {Number(permit2Allowance) / 10 ** USDC_DECIMALS} USDC approved to Permit2.
            Approve exactly 0.01 USDC to continue with the x402 payment.
          </p>
          <div className="rounded-[--radius-card] border border-border bg-page p-3">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
              Approval details
            </p>
            <div className="mt-1 space-y-1 text-[12px] font-[family-name:var(--font-ibm-plex-mono)]">
              <div className="flex justify-between">
                <span className="text-muted">Token</span>
                <span className="text-ink">USDC ({activeUSDC.slice(0, 6)}...{activeUSDC.slice(-4)})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Spender</span>
                <span className="text-ink">{PERMIT2_ADDRESS.slice(0, 10)}...{PERMIT2_ADDRESS.slice(-8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Amount</span>
                <span className="text-ink tabular-nums">{Number(requiredAtomic) / 10 ** USDC_DECIMALS} USDC ({requiredAtomic.toString()} atomic)</span>
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApprove}
            disabled={isApproving}
          >
            {isApproving ? "Approving..." : "Approve 0.01 USDC to Permit2"}
          </Button>
          <p className="text-[12px] text-muted">
            This grants Permit2 permission to transfer exactly 0.01 USDC for the x402 settlement. You will sign a separate Permit2 authorization afterwards.
          </p>
        </div>
      )}

      {/* Approving transaction pending */}
      {flowState === "approving" && (
        <div className="flex items-center gap-3 text-[14px] text-muted">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="30 10" />
          </svg>
          {isApproving ? "Confirming approval transaction..." : "Waiting for wallet confirmation..."}
        </div>
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
            (facilitatorMode
              ? "Please sign the authorization in your wallet…"
              : "Please sign the Permit2 authorization in your wallet…")}
          {flowState === "submitting" &&
            "Submitting payment to server…"}
          {flowState === "settling" &&
            (facilitatorMode
              ? "Settling via Celo x402 facilitator…"
              : "Settling payment on-chain (Permit2)…")}
        </div>
      )}

      {/* Ready to sign: show confirmation prompt */}
      {flowState === "ready-to-sign" && (
        <div className="rounded-[--radius-card] border border-gold/30 bg-gold/5 p-4 space-y-3">
          <p className="text-[14px] font-medium text-ink">
            Confirm payment of ${X402_DISPUTE_BRIEF_PRICE} USDC
          </p>
          <p className="text-[13px] text-muted leading-relaxed">
            {facilitatorMode
              ? "You will be prompted to sign an EIP-3009 TransferWithAuthorization in your wallet. This authorizes the transfer of USDC to the service wallet via the official Celo x402 facilitator. Gas fees are covered by the facilitator."
              : "You will be prompted to sign a Permit2 authorization in your wallet. This authorizes the transfer of USDC from your wallet to the service wallet. Gas fees (CELO) for settlement are covered by the service."}
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
      {wallet.isConnected && wallet.chainId !== activeChainId && (
        <p className="text-[12px] text-muted text-center">
          Switch to {activeChainName} network to continue.
        </p>
      )}
      {wallet.isConnected && wallet.chainId === activeChainId && !hasSufficientBalance && (
        <p className="text-[12px] text-gold text-center">
          Insufficient USDC balance. {facilitatorMode ? "Add USDC to your wallet on Celo Mainnet." : "Get testnet USDC from the Celo faucet."}
        </p>
      )}
      {!activePayTo && (
        <p className="text-[12px] text-muted text-center">
          x402 payment processing is not configured.
        </p>
      )}
    </div>
  );
}
