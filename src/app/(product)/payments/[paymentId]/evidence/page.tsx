"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import {
  useSignTypedData,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import Button from "@/components/ui/Button";
import EvidenceForm from "@/components/payment/EvidenceForm";
import type { EvidenceFormData } from "@/components/payment/EvidenceForm";
import type { EvidenceQualityResultData } from "@/components/payment/EvidenceQualityResult";
import Notice from "@/components/ui/Notice";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { useWalletState } from "@/hooks/wallet/useWalletState";
import { usePayment } from "@/hooks/contracts/useReadContract";
import { useSubmitEvidenceFlow } from "@/hooks/evidence/useSubmitEvidenceFlow";
import {
  usePaymentActionSync,
  PAYMENT_SYNCING_MESSAGE,
  PAYMENT_SYNC_TIMEOUT_MESSAGE,
} from "@/hooks/payment/usePaymentActionSync";
import { getCeloExplorerTxUrl, getCeloMainnetExplorerTxUrl, getChainName, CELO_CHAIN_ID } from "@/lib/web3/chains";
import {
  readEvidenceChainRaw,
  resolveEvidenceChainId,
} from "@/lib/evidence/chainScope";import { normalizeForJson } from "@/lib/x402/jsonSafe";
import {
  getEscrowDeployment,
  isCanonicalDeployment,
  parseEscrowParam,
} from "@/lib/contracts/escrowIdentity";
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
import { getAttributionDataSuffix } from "@/lib/contracts/attribution";

// ---------------------------------------------------------------------------
// Static x402 constants — defined at module scope for stable references
// ---------------------------------------------------------------------------

/** Canonical Permit2 contract address — same on every EVM chain. */
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** USDC token address on Celo Sepolia (canonical). */
const USDC_CELO_SEPOLIA = "0x01C5C0122039549AD1493B8220cABEdD739BC44E" as const;

/** USDC decimals. */
const USDC_DECIMALS = 6;

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

/** EIP-712 domain for USDC on Celo mainnet (verified on-chain). Used in facilitator mode. */
const USDC_EIP3009_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: 42220,
  verifyingContract: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
} as const;

/** EIP-3009 TransferWithAuthorization typed-data types (facilitator mode). */
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

/** Convert human-readable USDC price to atomic units. */
function humanToAtomic(price: string): bigint {
  const parts = price.split(".");
  const whole = BigInt(parts[0] ?? "0");
  const fraction = (parts[1] ?? "")
    .slice(0, USDC_DECIMALS)
    .padEnd(USDC_DECIMALS, "0");
  return whole * BigInt(10 ** USDC_DECIMALS) + BigInt(fraction);
}

export default function EvidencePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
          <div className="flex flex-col items-center justify-center gap-4">
            <p className="text-[15px] text-muted">Loading payment data…</p>
          </div>
        </div>
      }
    >
      <EvidencePageInner />
    </Suspense>
  );
}

function EvidencePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ paymentId: string }>();
  const paymentIdStr = params?.paymentId;
  const paymentId = useMemo(() => {
    if (!paymentIdStr) return undefined;
    try {
      return BigInt(paymentIdStr);
    } catch {
      return undefined;
    }
  }, [paymentIdStr]);

  const { requireWallet, requestNetworkSwitch } = useRequireWallet();
  const wallet = useWalletState();

  // -----------------------------------------------------------------------
  // P4.3b chain scope — explicit, validated ?chainId= (Sepolia default
  // preserves behavior). Unsupported values fail closed (null) and render
  // an explicit error instead of binding to the wrong canonical escrow.
  // useSearchParams (Suspense boundary above) keeps SSR and hydration in
  // agreement — no window reads during render.
  // P4.5F: preserve explicit chain in all return navigation via chainQuery.
  // -----------------------------------------------------------------------
  const targetChainId: number | null = useMemo(() => {
    try {
      return resolveEvidenceChainId([
        readEvidenceChainRaw(searchParams.toString()),
      ]);
    } catch {
      return null;
    }
  }, [searchParams]);
  const explicitEvidenceChainId: number | undefined = useMemo(() => {
    const raw = readEvidenceChainRaw(searchParams.toString());
    if (raw === null || raw.trim() === "") return undefined;
    if (targetChainId === null) return undefined;
    return targetChainId;
  }, [searchParams, targetChainId]);
  const chainQueryBase =
    explicitEvidenceChainId !== undefined
      ? `?chainId=${explicitEvidenceChainId}`
      : "";
  // P7.2 escrow threading (?escrow=): absent → canonical V1 (legacy
  // behavior); present → fail-closed allowlist validation against the
  // resolved chain (unknown escrow joins the fail-closed branch below —
  // never falls back to the canonical contract).
  const escrowRaw = searchParams?.get("escrow") ?? null;
  const escrowParam = useMemo(() => parseEscrowParam(escrowRaw), [escrowRaw]);
  const escrowChainForValidation = targetChainId ?? CELO_CHAIN_ID;
  const escrowDeployment = useMemo(() => {
    if (escrowParam.status !== "valid") return undefined;
    try {
      return getEscrowDeployment({
        chainId: escrowChainForValidation,
        escrowAddress: escrowParam.address,
      });
    } catch {
      return undefined;
    }
  }, [escrowParam, escrowChainForValidation]);
  const isEscrowInvalid =
    escrowParam.status === "invalid" ||
    (escrowParam.status === "valid" && escrowDeployment === undefined);
  const explicitEscrowAddress =
    escrowDeployment && !isCanonicalDeployment(escrowDeployment)
      ? escrowDeployment.address
      : undefined;
  const chainQuery =
    explicitEscrowAddress !== undefined
      ? `${chainQueryBase || `?chainId=${escrowChainForValidation}`}&escrow=${explicitEscrowAddress}`
      : chainQueryBase;

  const { data: payment, isLoading, isError, notFound, refetch: refetchPayment } = usePayment(
    targetChainId === null ? undefined : paymentId,
    targetChainId ?? CELO_CHAIN_ID,
  );
  const {
    submit: submitEvidence,
    isPending,
    isTxConfirmed,
    error,
    txHash,
    lastReference,
    metadataState,
    metadataError,
    retryMetadata,
    reset,
  } = useSubmitEvidenceFlow(paymentId, paymentIdStr, targetChainId ?? CELO_CHAIN_ID);

  // P4.5F post-receipt sync: Accepted → DeliverySubmitted barrier. Locks the
  // form (submit guards on isTxConfirmed), shows syncing copy, bounded-polls
  // canonical state — never rebroadcasts.
  const evidenceSync = usePaymentActionSync({
    isSuccess: isTxConfirmed,
    txHash,
    canonicalState: payment?.state,
    expectedState: "DeliverySubmitted",
    refetch: () => {
      try {
        refetchPayment();
      } catch {
        // Best-effort.
      }
    },
    paymentId: paymentIdStr,
    chainId: targetChainId ?? CELO_CHAIN_ID,
  });

  // -----------------------------------------------------------------------
  // Evidence quality check state
  // -----------------------------------------------------------------------
  const [checkState, setCheckState] = useState<
    "idle" | "checking" | "paid" | "settled"
  >("idle");
  const [checkResult, setCheckResult] = useState<EvidenceQualityResultData | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // x402 payment helpers
  // -----------------------------------------------------------------------

  const EV_CHECK_PRICE = X402_DISPUTE_BRIEF_PRICE;
  const requiredAtomic = useMemo(() => humanToAtomic(EV_CHECK_PRICE), [EV_CHECK_PRICE]);

  // ------ Mode detection ------
  const facilitatorMode = isFacilitatorMode();
  const activeNetwork = facilitatorMode ? X402_FACILITATOR_NETWORK : X402_NETWORK;
  const activeUSDC = facilitatorMode
    ? X402_FACILITATOR_USDC_MAINNET
    : USDC_CELO_SEPOLIA;
  const activePayTo = facilitatorMode
    ? X402_PAY_TO_ADDRESS_FACILITATOR
    : X402_PAY_TO_ADDRESS;
  const activeChainId = facilitatorMode ? CELO_MAINNET_CHAIN_ID : 11142220;

  // ------ Wagmi hooks ------
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChain } = useSwitchChain();

  // ------ USDC balance ------
  const { data: usdcBalanceRaw } = useReadContract({
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

  const usdcBalance = (usdcBalanceRaw as bigint) ?? BigInt(0);
  const hasSufficientBalance = usdcBalance >= requiredAtomic;

  // ------ Permit2 allowance ------
  const { data: permit2AllowanceRaw, refetch: refetchAllowance } = useReadContract({
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

  // ------ Permit2 approval ------
  const {
    writeContract: approveUSDC,
    data: approveTxHash,
  } = useWriteContract();

  const { isLoading: isApprovalPending, isSuccess: isApprovalConfirmed } =
    useWaitForTransactionReceipt({ hash: approveTxHash });

  // When approval confirms, refetch allowance so the user can retry
  useEffect(() => {
    if (isApprovalConfirmed) {
      refetchAllowance();
    }
  }, [isApprovalConfirmed, refetchAllowance]);

  /** Generate a unique nonce for Permit2 signing. */
  const generateNonce = useCallback(() => {
    return (
      BigInt(Date.now()) * BigInt(1_000_000) +
      BigInt(Math.floor(Math.random() * 1_000_000))
    );
  }, []);

  /** Build and sign a Permit2 authorization. */
  const signPermit2Authorization = useCallback(async () => {
    if (!wallet.address) throw new Error("Wallet not connected.");
    const nonce = generateNonce();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const spender = X402_SPENDER_ADDRESS as `0x${string}`;

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
  }, [
    wallet.address,
    requiredAtomic,
    generateNonce,
    signTypedDataAsync,
    activeUSDC,
    activeChainId,
    activePayTo,
  ]);

  /** Build and sign an EIP-3009 TransferWithAuthorization (facilitator mode). */
  const signEIP3009Authorization = useCallback(async () => {
    if (!wallet.address) throw new Error("Wallet not connected.");

    const now = Math.floor(Date.now() / 1000);
    const validBefore = BigInt(now + 3600);
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonce =
      "0x" +
      Array.from(nonceBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

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
  // Evidence submit flow
  // -----------------------------------------------------------------------

  // Redirect to the Payment Room only AFTER the tx confirmed AND the
  // evidence metadata was persisted. P4.5F: preserve explicit chain.
  useEffect(() => {
    if (metadataState !== "persisted") return;
    const timer = setTimeout(() => {
      router.push(`/payments/${paymentIdStr}${chainQuery}`);
    }, 2000);
    return () => clearTimeout(timer);
  }, [metadataState, paymentIdStr, router, chainQuery]);

  // -----------------------------------------------------------------------
  // Evidence submit callback
  // -----------------------------------------------------------------------

  const handleAddEvidence = useCallback(
    (data: EvidenceFormData) => {
      submitEvidence(data);
    },
    [submitEvidence],
  );

  // -----------------------------------------------------------------------
  // Evidence quality check — full x402 payment flow
  // -----------------------------------------------------------------------

  /** Build the evidence package payload for the API. */
  function buildEvidencePackage(data: EvidenceFormData) {
    return {
      escrowPaymentId: paymentIdStr,
      evidenceTitle: data.title,
      evidenceDescription: data.description,
      evidenceType: data.type,
      relatedClaim: data.relatedClaim,
      evidenceDate: data.date,
      externalRef: data.externalRef,
      pastedText: data.pastedText,
      fileHash: data.fileHash,
      walletAddress: wallet.address,
    };
  }

  /** Safely parse JSON response, falling back to raw text. */
  async function safeParseJSON(response: Response) {
    const raw = await response.text().catch(() => "");
    if (!raw) return { data: {}, raw: "" };
    try {
      return { data: JSON.parse(raw), raw };
    } catch {
      return { data: {}, raw };
    }
  }

  const handleCheckStrength = useCallback(
    async (formData: EvidenceFormData) => {
      setCheckError(null);

      requireWallet(async () => {
        // ---- Validate network ----
        const isCorrectChain = facilitatorMode
          ? wallet.chainId === CELO_MAINNET_CHAIN_ID
          : wallet.chainId === 11142220;

        if (!isCorrectChain) {
          setCheckError(
            facilitatorMode
              ? "Evidence check payment uses Celo Mainnet. Please switch networks."
              : "Please switch to Celo Sepolia network.",
          );
          setCheckState("idle");
          return;
        }

        if (!hasSufficientBalance) {
          setCheckError(
            `Insufficient USDC balance. Need at least $${EV_CHECK_PRICE} USDC.`,
          );
          setCheckState("idle");
          return;
        }

        // ---- If in "paid" state: user confirmed payment, sign and submit ----
        if (checkState === "paid") {
          setCheckState("checking");
          try {
            let paymentSignatureHeader: string;

            if (facilitatorMode) {
              // EIP-3009 flow
              const { authorization, signature: eip3009Sig } =
                await signEIP3009Authorization();
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
                  signature: eip3009Sig,
                },
                requestId: crypto.randomUUID(),
              };
              paymentSignatureHeader = btoa(
                JSON.stringify(normalizeForJson(paymentPayload)),
              );
            } else {
              // Permit2 flow
              const paymentDetails = await signPermit2Authorization();
              const paymentPayload = {
                scheme: "exact",
                network: activeNetwork,
                payment: paymentDetails,
                requestId: crypto.randomUUID(),
              };
              paymentSignatureHeader = btoa(
                JSON.stringify(normalizeForJson(paymentPayload)),
              );
            }

            // Retry with payment signature
            const evidencePackage = buildEvidencePackage(formData);
            const paidRes = await fetch("/api/x402/evidence-check", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "PAYMENT-SIGNATURE": paymentSignatureHeader,
              },
              body: JSON.stringify(normalizeForJson(evidencePackage)),
            });

            const { data: paidData, raw: paidRaw } = await safeParseJSON(paidRes);

            if (!paidRes.ok) {
              const serverMsg =
                (paidData as Record<string, unknown>).error ||
                paidRaw ||
                "Payment failed.";
              throw new Error(`${serverMsg} (HTTP ${paidRes.status})`);
            }

            const result = (paidData as Record<string, unknown>).brief || paidData;
            setCheckResult(result as EvidenceQualityResultData);
            setCheckState("settled");
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Payment error.";
            if (
              message.includes("rejected") ||
              message.includes("denied") ||
              message.includes("cancelled")
            ) {
              setCheckState("paid");
              setCheckError("Signing was cancelled. Please try again.");
            } else {
              setCheckState("idle");
              setCheckError(message);
            }
          }
          return;
        }

        // ---- Permit2 allowance check (non-facilitator mode only) ----
        if (!facilitatorMode && !hasSufficientAllowance) {
          setCheckError(
            `Permit2 allowance is ${Number(permit2Allowance) / 10 ** USDC_DECIMALS} USDC — ${EV_CHECK_PRICE} needed. Approve Permit2 first.`,
          );
          setCheckState("idle");
          return;
        }

        // ---- Preflight: check if already paid / get payment requirements ----
        setCheckState("checking");

        try {
          const evidencePackage = buildEvidencePackage(formData);
          const preflightRes = await fetch("/api/x402/evidence-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(normalizeForJson(evidencePackage)),
          });

          // 200: already settled — show result immediately
          if (preflightRes.ok) {
            const { data: okData } = await safeParseJSON(preflightRes);
            const body = okData as Record<string, unknown>;
            const result = body.brief || okData;
            setCheckResult(result as EvidenceQualityResultData);
            setCheckState("settled");
            return;
          }

          // 402: payment required — prompt user to confirm
          if (preflightRes.status === 402) {
            const paymentReqHeader = preflightRes.headers.get("PAYMENT-REQUIRED");
            if (!paymentReqHeader) {
              throw new Error("Server did not return payment requirements.");
            }
            try {
              decodePaymentRequiredHeader(paymentReqHeader);
            } catch {
              throw new Error("Failed to decode payment requirements.");
            }
            setCheckState("paid");
            return;
          }

          // Other error
          const { raw: errRaw } = await safeParseJSON(preflightRes);
          throw new Error(
            errRaw || `Unexpected response (HTTP ${preflightRes.status})`,
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Network error.";
          setCheckState("idle");
          setCheckError(message);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      requireWallet,
      checkState,
      facilitatorMode,
      wallet.chainId,
      hasSufficientBalance,
      hasSufficientAllowance,
      permit2Allowance,
      EV_CHECK_PRICE,
      activeNetwork,
      signPermit2Authorization,
      signEIP3009Authorization,
    ],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4">
          <svg
            className="animate-spin h-8 w-8 text-muted"
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
          <p className="text-[15px] text-muted">Loading payment data…</p>
        </div>
      </div>
    );
  }

  if (isError || notFound || !payment) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Payment not found
          </h1>
          <p className="text-[15px] text-muted">
            Payment #{paymentIdStr} could not be loaded.
          </p>
          <Link href="/payments">
            <Button variant="secondary">Return to payments</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isWorker =
    wallet.address &&
    payment.worker.toLowerCase() === wallet.address.toLowerCase();

  // P4.3b fail-closed: an unsupported ?chainId= never binds to an escrow.
  // P7.2: an unknown ?escrow= fails closed the same way (never falls back).
  if (targetChainId === null || isEscrowInvalid) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Unsupported network
          </h1>
          <p className="text-[15px] text-muted">
            This delivery evidence form supports Celo Sepolia and Celo Mainnet.
            {isEscrowInvalid
              ? " The escrow contract in the page URL is not a known deployment."
              : " The network in the page URL is not supported."}
          </p>
          <Button
            variant="secondary"
            onClick={() => requestNetworkSwitch(CELO_CHAIN_ID)}
          >
            Switch to Celo Sepolia
          </Button>
          <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!isWorker) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Access restricted
          </h1>
          <p className="text-[15px] text-muted">
            Only the assigned worker can submit evidence for this payment.
          </p>
          <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (payment.state !== "Accepted" && payment.state !== "DeliverySubmitted") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-[24px] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Cannot submit evidence
          </h1>
          <p className="text-[15px] text-muted">
            Evidence can be submitted after you accept the terms (and updated until release is
            requested). Current state: {payment.state}.
          </p>
          <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
            <Button variant="secondary">Return to Payment Room</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
            Add delivery evidence
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {payment.state === "DeliverySubmitted"
              ? `Update your delivery evidence reference for payment #${paymentIdStr}.`
              : `Submit your delivery evidence reference for payment #${paymentIdStr}.`}
          </p>
        </div>
        <Link href={`/payments/${paymentIdStr}${chainQuery}`}>
          <Button variant="secondary" size="sm">
            Return to Payment Room
          </Button>
        </Link>
      </div>

      <div className="mt-8">
        {/* Wrong-network action: shown only when the connected wallet chain
            differs from this form's explicit escrow chain. Switches to the
            form's chain (Sepolia default preserves behavior). */}
        {wallet.isConnected &&
          wallet.chainId !== undefined &&
          wallet.chainId !== targetChainId && (
            <div className="mb-6">
              <Notice variant="warning">
                <p className="text-[14px] leading-relaxed">
                  Your wallet is on {getChainName(wallet.chainId)}. This
                  delivery evidence will be recorded on{" "}
                  {getChainName(targetChainId)}.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => requestNetworkSwitch(targetChainId)}
                >
                  Switch to {getChainName(targetChainId)}
                </Button>
              </Notice>
            </div>
          )}

        {error && (
          <div className="mb-6">
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">{error}</p>
              <button
                type="button"
                className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                onClick={() => reset()}
              >
                Dismiss
              </button>
            </Notice>
          </div>
        )}

        {isPending && !txHash && (
          <div className="mb-6">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <span className="inline-flex items-center gap-2">
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
                  Waiting for signature…
                </span>
              </p>
            </Notice>
          </div>
        )}

        {isPending && txHash && (
          <div className="mb-6">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <span className="inline-flex items-center gap-2">
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
                  Confirming evidence submission…
                </span>
              </p>
              <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                {txHash}
              </p>
            </Notice>
          </div>
        )}

        {isTxConfirmed && txHash && metadataState === "idle" && (
          <div className="mb-6">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <span className="inline-flex items-center gap-2">
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
                  Recording evidence details…
                </span>
              </p>
            </Notice>
          </div>
        )}

        {metadataState === "persisted" && txHash && (
          <div className="mb-6">
            <Notice variant="success">
              <p className="text-[14px] leading-relaxed">
                Evidence submitted successfully. Redirecting to Payment Room…
              </p>
              {evidenceSync.isSyncing && (
                <p className="mt-1 text-[13px] text-muted">
                  {PAYMENT_SYNCING_MESSAGE}
                </p>
              )}
              {evidenceSync.isTimedOut && (
                <div className="mt-2">
                  <p className="text-[13px] text-muted">
                    {PAYMENT_SYNC_TIMEOUT_MESSAGE}
                  </p>
                  <button
                    type="button"
                    className="mt-1 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                    onClick={() => {
                      try {
                        refetchPayment();
                      } catch {
                        // Best-effort.
                      }
                    }}
                  >
                    Refresh status
                  </button>
                </div>
              )}
              {lastReference && (
                <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                  Verification reference: {lastReference}
                </p>
              )}
              <a
                href={
                  targetChainId === CELO_MAINNET_CHAIN_ID
                    ? getCeloMainnetExplorerTxUrl(txHash)
                    : getCeloExplorerTxUrl(txHash)
                }
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
              >
                View on Celo Explorer
              </a>
            </Notice>
          </div>
        )}

        {metadataError && metadataState === "error" && (
          <div className="mb-6">
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">{metadataError}</p>
              <button
                type="button"
                className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                onClick={retryMetadata}
              >
                Retry
              </button>
            </Notice>
          </div>
        )}
      </div>

      <div className="rounded-[--radius-card] border border-border bg-surface p-6 md:p-8">
        <div className="mb-6">
          <Notice variant="info">
            <p className="text-[14px] leading-relaxed">
              New: describe your delivery in the Payment Room and Reclaim will
              draft the evidence — or fill the form below manually.
            </p>
            <Link
              href={`/payments/${paymentIdStr}${chainQuery}`}
              className="mt-2 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
            >
              Use conversational delivery in the Payment Room
            </Link>
          </Notice>
        </div>
        <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
          Evidence form
        </h2>
        <p className="mt-1 text-[14px] text-muted">
          Files remain private and off-chain. Reclaim records a verification reference.
        </p>
        <div className="mt-6">
          <EvidenceForm
            onSubmit={handleAddEvidence}
            onCheckStrength={handleCheckStrength}
            checkStrengthState={checkState}
            checkStrengthResult={checkResult}
            onImproveEvidence={() => setCheckState("idle")}
            onCopyResultJson={() => {
              // no-op — EvidenceQualityResult handles the actual copy,
              // this callback lets the parent know it happened
            }}
          />
        </div>

        {/* ---- Evidence check error notice ---- */}
        {checkError && (
          <div className="mt-4">
            <Notice variant="warning">
              <p className="text-[14px] leading-relaxed">{checkError}</p>
              <button
                type="button"
                className="mt-2 text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                onClick={() => setCheckError(null)}
              >
                Dismiss
              </button>
            </Notice>
          </div>
        )}

        {/* ---- Permit2 approval UI (non-facilitator mode only) ---- */}
        {checkError &&
          checkError.includes("Permit2 allowance") &&
          !facilitatorMode && (
            <div className="mt-4">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCheckError(null);
                  const dataSuffix = getAttributionDataSuffix();
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
                    dataSuffix,
                  });
                }}
                disabled={isApprovalPending}
              >
                {isApprovalPending
                  ? "Approving…"
                  : `Approve ${EV_CHECK_PRICE} USDC to Permit2`}
              </Button>
              {isApprovalPending && (
                <p className="mt-2 text-[13px] text-muted">
                  Waiting for approval transaction confirmation…
                </p>
              )}
            </div>
          )}
      </div>

      {/* ---- Network switch prompt (facilitator mode) ---- */}
      {checkError &&
        checkError.includes("Celo Mainnet") &&
        facilitatorMode && (
          <div className="mt-4">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                switchChain({ chainId: CELO_MAINNET_CHAIN_ID })
              }
            >
              Switch to Celo Mainnet
            </Button>
          </div>
        )}
    </div>
  );
}
