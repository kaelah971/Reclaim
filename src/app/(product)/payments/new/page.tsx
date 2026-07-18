"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import Dialog from "@/components/ui/Dialog";
import ProtectionRules from "@/components/payment/ProtectionRules";
import type { ProtectionRulesData } from "@/components/payment/ProtectionRules";
import AgreementPreview from "@/components/payment/AgreementPreview";
import WalletButton from "@/components/ui/WalletButton";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import { useCreatePayment } from "@/hooks/contracts/useCreatePayment";
import { parseUSDC, utf8ByteLength } from "@/lib/contracts/types";
import { getCeloExplorerTxUrl } from "@/lib/web3/chains";
import { PAYMENT_TOKEN_SYMBOL } from "@/lib/web3/tokens";

/** Derive a Unix timestamp (seconds) from a date input value (YYYY-MM-DD). */
function dateToUnixTimestamp(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

export default function CreatePaymentPage() {
  const router = useRouter();
  const { requireWallet } = useRequireWallet();
  const { createPayment, isPending, isSuccess, error, txHash, paymentId, reset } =
    useCreatePayment();

  const [step, setStep] = useState<"form" | "review">("form");
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

  const [workerWallet, setWorkerWallet] = useState("");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [deliveryFormat, setDeliveryFormat] = useState("");
  const [deadline, setDeadline] = useState("");
  const [protectionRules, setProtectionRules] = useState<ProtectionRulesData>({
    releaseRule: "",
    autoReleaseHours: "",
    disputeWindow: "",
    evidenceExpectation: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleRulesChange = useCallback((data: ProtectionRulesData) => {
    setProtectionRules(data);
    if (errors.releaseRule) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.releaseRule;
        return next;
      });
    }
  }, [errors.releaseRule]);

  // ---- Redirect to payment room on success ----
  useEffect(() => {
    if (isSuccess && paymentId !== undefined) {
      router.push(`/payments/${paymentId.toString()}`);
    }
  }, [isSuccess, paymentId, router]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      errs.amount = "Enter a valid amount.";
    } else if (amount.includes(".") && amount.split(".")[1]!.length > 6) {
      errs.amount = "USDC supports at most 6 decimal places.";
    }

    if (!workerWallet.trim()) {
      errs.workerWallet = "Worker wallet address is required.";
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(workerWallet.trim())) {
      errs.workerWallet = "Enter a valid Celo wallet address (0x\x2026).";
    }

    if (!title.trim()) {
      errs.title = "Agreement title is required.";
    } else if (utf8ByteLength(title.trim()) > 32) {
      errs.title = "Keep the title under 32 characters \u2014 it is stored on-chain.";
    }

    if (!deliverable.trim()) {
      errs.deliverable = "Deliverable description is required.";
    } else if (utf8ByteLength(deliverable.trim()) > 32) {
      errs.deliverable = "Keep the deliverable summary under 32 characters \u2014 it is stored on-chain.";
    }

    if (deliveryFormat.trim() !== "" && utf8ByteLength(deliveryFormat.trim()) > 32) {
      errs.deliveryFormat = "Keep the delivery format under 32 characters \u2014 it is stored on-chain.";
    }

    if (!deadline) {
      errs.deadline = "Delivery deadline is required.";
    } else if (dateToUnixTimestamp(deadline) <= Math.floor(Date.now() / 1000)) {
      errs.deadline = "Deadline must be in the future.";
    }

    if (!protectionRules.releaseRule) {
      errs.releaseRule = "Select a release rule.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleContinueToDeposit = () => {
    if (!validate()) return;
    requireWallet(() => {
      const rawAmount = parseUSDC(amount);
      const autoReleaseSecs = protectionRules.autoReleaseHours
        ? parseInt(protectionRules.autoReleaseHours, 10) * 3600
        : 0;
      const disputeWindowSecs = protectionRules.disputeWindow
        ? parseInt(protectionRules.disputeWindow, 10) * 3600
        : 0;

      createPayment({
        worker: workerWallet as `0x${string}`,
        amount: rawAmount,
        agreementLabel: title,
        deliverableSummary: deliverable,
        deliveryFormat: deliveryFormat || "",
        deliveryDeadline: dateToUnixTimestamp(deadline),
        releaseRule: protectionRules.releaseRule,
        autoReleaseSeconds: autoReleaseSecs,
        disputeWindowSeconds: disputeWindowSecs,
        evidenceExpectation: protectionRules.evidenceExpectation || "",
      });
    });
  };

  const handleCheckTerms = () => {
    const hasInput = title.trim() || deliverable.trim() || amount.trim();
    if (!hasInput) return;
    requireWallet(() => {
      setTermsDialogOpen(true);
    });
  };

  const handleReview = () => {
    if (!validate()) return;
    requireWallet(() => {
      setStep("review");
    });
  };

  if (step === "review") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Review your agreement
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Review the payment terms before creating the protected payment.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <AgreementPreview
              amount={amount}
              worker={workerWallet}
              deliverable={deliverable}
              deliveryFormat={deliveryFormat}
              deadline={deadline}
              releaseRule={protectionRules.releaseRule}
              disputeWindow={protectionRules.disputeWindow}
              evidenceExpectation={protectionRules.evidenceExpectation}
            />

            {/* ---- Transaction feedback ---- */}
            {error && (
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
            )}

            {isPending && !txHash && (
              <Notice variant="info">
                <p className="text-[14px] leading-relaxed">
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="30 10" />
                    </svg>
                    Waiting for signature in your wallet\u2026
                  </span>
                </p>
              </Notice>
            )}

            {isPending && txHash && (
              <Notice variant="info">
                <p className="text-[14px] leading-relaxed">
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="30 10" />
                    </svg>
                    Transaction submitted \u2014 confirming on-chain\u2026
                  </span>
                </p>
                <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                  {txHash}
                </p>
              </Notice>
            )}

            {isSuccess && txHash && (
              <Notice variant="success">
                <p className="text-[14px] leading-relaxed">
                  Payment created successfully. Redirecting to payment room\u2026
                </p>
                <a
                  href={getCeloExplorerTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-[13px] font-medium text-gold hover:text-gold/80 transition-colors"
                >
                  View on Celo Explorer
                </a>
              </Notice>
            )}

            <div className="flex items-center gap-4">
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  setStep("form");
                }}
                disabled={isPending}
              >
                Edit terms
              </Button>
              <Button onClick={handleContinueToDeposit} disabled={isPending}>
                {isPending ? "Creating payment\u2026" : "Continue to deposit"}
              </Button>
            </div>

            <button
              type="button"
              className="text-[14px] font-medium text-gold hover:text-gold/80 transition-colors"
              onClick={handleCheckTerms}
            >
              Check these terms \u2014 0.01 {PAYMENT_TOKEN_SYMBOL}
            </button>
          </div>

          <div className="lg:col-span-1">
            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <strong>You will deposit {PAYMENT_TOKEN_SYMBOL} after creation.</strong>
                {" "}The payment is created first; then you can fund it from the Payment Room.
              </p>
              <div className="mt-3">
                <WalletButton />
              </div>
            </Notice>
          </div>
        </div>

        <Dialog
          open={termsDialogOpen}
          onClose={() => setTermsDialogOpen(false)}
          title="Terms Risk Check"
          primaryLabel="Got it"
          onPrimary={() => setTermsDialogOpen(false)}
        >
          <p>Terms Risk Check will be enabled during x402 integration.</p>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
        Protect a payment
      </h1>
      <p className="mt-1 text-[15px] text-muted">
        Define the work, set the protection rules, and review the agreement before depositing {PAYMENT_TOKEN_SYMBOL}.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-10">
          <section>
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Payment
            </h2>
            <div className="mt-4 space-y-5">
              <div>
                <label className="text-[15px] font-medium text-ink">
                  Client wallet
                </label>
                <div className="mt-1.5">
                  <Notice variant="info">
                    <div className="flex items-center gap-3">
                      <span className="text-[14px]">
                        Connect your wallet before this payment can be funded.
                      </span>
                      <WalletButton />
                    </div>
                  </Notice>
                </div>
              </div>

              <Input
                label="Worker wallet"
                placeholder="0x..."
                value={workerWallet}
                onChange={(e) => {
                  setWorkerWallet(e.target.value);
                  if (errors.workerWallet) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.workerWallet;
                      return next;
                    });
                  }
                }}
                error={errors.workerWallet}
                helper="The Celo wallet address of the worker receiving this payment."
              />

              <Input
                label="Amount"
                placeholder="100.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.amount;
                      return next;
                    });
                  }
                }}
                error={errors.amount}
                helper={`Payment amount in ${PAYMENT_TOKEN_SYMBOL}.`}
              />

              <div>
                <label className="text-[15px] font-medium text-ink">Currency</label>
                <div className="mt-1.5 h-12 flex items-center rounded-[--radius-input] border border-border bg-input px-4 text-[15px] text-ink">
                  {PAYMENT_TOKEN_SYMBOL}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Work agreement
            </h2>
            <div className="mt-4 space-y-5">
              <Input
                label="Agreement title"
                placeholder="Landing page design"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.title;
                      return next;
                    });
                  }
                }}
                error={errors.title}
                maxLength={32}
              />

              <Textarea
                label="Deliverable description"
                placeholder="Short summary of what will be delivered"
                value={deliverable}
                onChange={(e) => {
                  setDeliverable(e.target.value);
                  if (errors.deliverable) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.deliverable;
                      return next;
                    });
                  }
                }}
                error={errors.deliverable}
                maxLength={32}
                helper="Keep the deliverable summary under 32 characters \u2014 it is stored on-chain."
              />

              <Input
                label="Delivery format"
                placeholder="Figma file and exported mobile screens"
                value={deliveryFormat}
                onChange={(e) => {
                  setDeliveryFormat(e.target.value);
                  if (errors.deliveryFormat) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.deliveryFormat;
                      return next;
                    });
                  }
                }}
                maxLength={32}
                error={errors.deliveryFormat}
              />

              <Input
                label="Delivery deadline"
                type="date"
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  if (errors.deadline) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.deadline;
                      return next;
                    });
                  }
                }}
                error={errors.deadline}
              />
            </div>
          </section>

          <ProtectionRules onChange={handleRulesChange} />
          {errors.releaseRule && (
            <p className="text-[13px] text-red-600" role="alert">{errors.releaseRule}</p>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-[8rem] space-y-6">
            <AgreementPreview
              amount={amount}
              worker={workerWallet}
              deliverable={deliverable}
              deliveryFormat={deliveryFormat}
              deadline={deadline}
              releaseRule={protectionRules.releaseRule}
              disputeWindow={protectionRules.disputeWindow}
              evidenceExpectation={protectionRules.evidenceExpectation}
            />

            <Notice variant="info">
              <p className="text-[14px] leading-relaxed">
                <strong>No platform fee on testnet.</strong> The full amount you deposit is held in escrow and released to the worker.
              </p>
            </Notice>

            <Button
              size="lg"
              className="w-full"
              onClick={handleReview}
            >
              Review agreement
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
