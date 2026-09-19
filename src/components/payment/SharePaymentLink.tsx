"use client";

import { useCallback, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { isSupportedChain } from "@/lib/web3/chains";

// ---------------------------------------------------------------------------
// SharePaymentLink — canonical shareable payment URL + copy button.
//
// Canonical form: /payments/{paymentId}?chainId={chainId}
// Non-canonical/V2 escrow form: /payments/{paymentId}?chainId={chainId}&escrow={address}
// - paymentId must be a canonical non-negative integer string (BigInt-safe).
// - chainId must be a supported Celo chain (validated via isSupportedChain).
// - escrowAddress is optional; when provided it must be well-formed hex
//   (validated format only here — allowlist validation happens at render
//   time via the room page fail-closed path). Canonical V1 links omit it so
//   legacy share URLs stay byte-identical.
// - No hostnames are hardcoded: the absolute URL is built from
//   window.location.origin at copy time. Contract addresses are public
//   on-chain values — no secrets, tokens, or keys are ever placed in the
//   URL; only paymentId + chainId (+ explicit escrow when non-canonical).
// - Invalid paymentId/chainId/escrow fails closed (no link is produced).
// ---------------------------------------------------------------------------

const ESCROW_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function buildPaymentSharePath(
  paymentId: string,
  chainId: number,
  escrowAddress?: string | null,
): string | null {
  const trimmed = paymentId.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    BigInt(trimmed);
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(chainId) || !isSupportedChain(chainId)) return null;
  if (
    escrowAddress !== undefined &&
    escrowAddress !== null &&
    escrowAddress.trim() !== ""
  ) {
    const escrowTrimmed = escrowAddress.trim();
    if (!ESCROW_ADDRESS_PATTERN.test(escrowTrimmed)) return null;
    return `/payments/${trimmed}?chainId=${chainId}&escrow=${escrowTrimmed}`;
  }
  return `/payments/${trimmed}?chainId=${chainId}`;
}

export function buildPaymentShareUrl(
  origin: string,
  paymentId: string,
  chainId: number,
  escrowAddress?: string | null,
): string | null {
  const path = buildPaymentSharePath(paymentId, chainId, escrowAddress);
  if (!path) return null;
  const cleanOrigin = origin.replace(/\/$/, "");
  if (!cleanOrigin) return null;
  return `${cleanOrigin}${path}`;
}

interface SharePaymentLinkProps {
  paymentId: string;
  chainId: number;
  escrowAddress?: string | null;
  buttonLabel?: string;
  className?: string;
}

export default function SharePaymentLink({
  paymentId,
  chainId,
  escrowAddress,
  buttonLabel = "Share with freelancer",
  className = "",
}: SharePaymentLinkProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const sharePath = useMemo(
    () => buildPaymentSharePath(paymentId, chainId, escrowAddress),
    [paymentId, chainId, escrowAddress],
  );

  const handleCopy = useCallback(async () => {
    setCopyError(null);
    if (!sharePath) {
      setCopyError(
        "This payment link is not available on a supported network.",
      );
      return;
    }
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = buildPaymentShareUrl(origin, paymentId, chainId, escrowAddress);
    if (!url) {
      setCopyError(
        "This payment link is not available on a supported network.",
      );
      return;
    }
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(url);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } else {
        throw new Error("clipboard unavailable");
      }
      setCopied(true);
    } catch {
      setCopyError("Could not copy the link. Copy it manually.");
    }
  }, [sharePath, paymentId, chainId, escrowAddress]);

  // Fail closed: never render a broken/unsupported link.
  if (!sharePath) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleCopy}
        aria-label={buttonLabel}
      >
        {copied ? "Link copied" : buttonLabel}
      </Button>
      <p className="mt-2 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
        {sharePath}
      </p>
      {copied && (
        <p className="mt-1 text-[13px] text-muted" aria-live="polite">
          Link copied — send it to the freelancer.
        </p>
      )}
      {copyError && (
        <p className="mt-1 text-[13px] text-red-700" role="alert">
          {copyError}
        </p>
      )}
    </div>
  );
}
