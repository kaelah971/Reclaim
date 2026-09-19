"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBalance } from "wagmi";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import ProtectionRules from "@/components/payment/ProtectionRules";
import type { ProtectionRulesData } from "@/components/payment/ProtectionRules";
import AgreementPreview from "@/components/payment/AgreementPreview";
import NewPaymentStepper from "@/components/payment/NewPaymentStepper";
import ProtectPreflight from "@/components/payment/ProtectPreflight";
import WalletButton from "@/components/ui/WalletButton";
import SharePaymentLink from "@/components/payment/SharePaymentLink";
import CommandBox from "@/components/command/CommandBox";
import PolicyConfirmationCard from "@/components/command/PolicyConfirmationCard";
import {
  draftToPolicy,
  type PaymentIntentDraft,
  type PaymentPolicy,
} from "@/lib/command/paymentIntent";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import {
  useProtectPaymentFlow,
  getProtectTokenDisplay,
  getProtectNetworkDisplay,
} from "@/hooks/payment/useProtectPaymentFlow";
import {
  validatePaymentStep,
  validateTermsStep,
  parseAmountToRaw,
  dateToUnixTimestamp,
} from "./validation";
import { formatUSDC } from "@/lib/contracts/types";
import { DEFAULT_NEW_PAYMENT_CHAIN_ID } from "@/lib/contracts/config";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  getChainName,
  getCeloExplorerTxUrl,
  getCeloMainnetExplorerTxUrl,
  isSupportedChain,
} from "@/lib/web3/chains";
import { getPaymentTokenConfig } from "@/lib/web3/tokens";

const EMPTY_RULES: ProtectionRulesData = {
  releaseRule: "",
  autoReleaseHours: "",
  disputeWindow: "",
  evidenceExpectation: "",
};

const RELEASE_RULE_LABELS: Record<string, string> = {
  "buyer-approval": "You approve every release",
  "auto-release": "You approve, or it releases after a backup delay",
  manual: "Only release when you say so",
};

function explorerTxUrl(chainId: number, txHash: string): string {
  return chainId === CELO_MAINNET_CHAIN_ID
    ? getCeloMainnetExplorerTxUrl(txHash)
    : getCeloExplorerTxUrl(txHash);
}

type WizardStep = 1 | 2 | 3;

export default function CreatePaymentPage() {
  const router = useRouter();
  const { requireWallet, requestNetworkSwitch, wallet } = useRequireWallet();

  // Mainnet by default (canonical constant); Sepolia only via explicit
  // selection below so existing Sepolia flows keep working.
  const [targetChainId, setTargetChainId] = useState<number>(
    DEFAULT_NEW_PAYMENT_CHAIN_ID,
  );
  const token = useMemo(
    () => getPaymentTokenConfig(targetChainId),
    [targetChainId],
  );
  const tokenDisplay = getProtectTokenDisplay(targetChainId);
  const networkDisplay = getProtectNetworkDisplay(targetChainId);
  const isMainnet = targetChainId === CELO_MAINNET_CHAIN_ID;

  const flow = useProtectPaymentFlow(targetChainId);

  const [step, setStep] = useState<WizardStep>(1);
  const [workerWallet, setWorkerWallet] = useState("");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [deliveryFormat, setDeliveryFormat] = useState("");
  const [deadline, setDeadline] = useState("");
  const [protectionRules, setProtectionRules] =
    useState<ProtectionRulesData>(EMPTY_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Reclaim Command (P6.1): chat understands, policy decides ----
  // Primary creation experience. The draft NEVER executes: confirmation hands
  // into the existing wizard/review flow below (no second tx architecture).
  const [showWizard, setShowWizard] = useState(false);
  const [commandDraft, setCommandDraft] = useState<PaymentIntentDraft | null>(null);
  const [commandQuestion, setCommandQuestion] = useState<string | null>(null);
  const [commandPolicy, setCommandPolicy] = useState<PaymentPolicy | null>(null);
  const [commandDeadlineLabel, setCommandDeadlineLabel] = useState<string | undefined>(undefined);
  const [commandThread, setCommandThread] = useState<Array<{ role: "user" | "agent"; text: string }>>([]);
  const [commandWorking, setCommandWorking] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBoundary, setCommandBoundary] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState("");

  const handleCommandSubmit = useCallback(
    async (userMessage: string) => {
      setCommandWorking(true);
      setCommandError(null);
      setCommandBoundary(null);
      setCommandThread((prev) => [...prev, { role: "user", text: userMessage }]);
      const nextHistory = `${commandHistory}\n${userMessage}`.trim();
      try {
        const res = await fetch("/api/command/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage,
            draft: commandDraft ?? {},
            messagesText: commandHistory,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          draft?: PaymentIntentDraft;
          missingFields?: string[];
          clarifyingQuestion?: string | null;
          ready?: boolean;
          rejected?: boolean;
          boundaryMessage?: string | null;
          errors?: string[];
          error?: string;
        };
        if (!res.ok || data.ok === false) {
          if (res.status === 503) {
            setCommandError(
              data.error ?? "Reclaim could not interpret that command right now.",
            );
          } else {
            setCommandError(data.error ?? "Could not interpret that command.");
          }
          return;
        }
        const draft = data.draft ?? {};
        setCommandDraft(draft);
        setCommandHistory(nextHistory);
        setCommandQuestion(data.clarifyingQuestion ?? null);
        if (data.rejected && data.boundaryMessage) {
          setCommandBoundary(data.boundaryMessage);
          setCommandThread((prev) => [...prev, { role: "agent", text: data.boundaryMessage as string }]);
          return;
        }
        if (data.errors && data.errors.length > 0) {
          setCommandThread((prev) => [...prev, { role: "agent", text: data.errors!.join(" ") }]);
        } else if (data.clarifyingQuestion) {
          setCommandThread((prev) => [...prev, { role: "agent", text: data.clarifyingQuestion as string }]);
        }
        // Derive the validated policy client-side for the confirmation card
        // (server is authoritative for readiness; this only renders).
        const { policy } = draftToPolicy(draft);
        setCommandPolicy(policy);
        setCommandDeadlineLabel(draft.deadlineLabel);
      } catch {
        setCommandError("Could not interpret that command. Nothing was created.");
      } finally {
        setCommandWorking(false);
      }
    },
    [commandDraft, commandHistory],
  );

  const applyPolicyToWizard = useCallback(
    (policy: PaymentPolicy, step: WizardStep) => {
      if (policy.chainId !== targetChainId) {
        setTargetChainId(policy.chainId);
        setErrors({});
        setSubmitError(null);
        flow.reset();
      }
      setWorkerWallet(policy.worker);
      setAmount(policy.amountHuman);
      setTitle(policy.title);
      setDeliverable(policy.deliverableSummary);
      setDeliveryFormat(policy.deliveryFormat);
      setDeadline(policy.deadlineDate);
      setProtectionRules({
        releaseRule: policy.releaseRule,
        autoReleaseHours: "",
        disputeWindow: "",
        evidenceExpectation: policy.evidenceExpectation,
      });
      setErrors({});
      setSubmitError(null);
      setShowWizard(true);
      setStep(step);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetChainId],
  );

  const handleProtectFromCommand = useCallback(() => {
    if (!commandPolicy) return;
    // Handoff into the existing review/protection flow (step 3): the user
    // still explicitly approves + locks funds via the wallet flow.
    applyPolicyToWizard(commandPolicy, 3);
  }, [commandPolicy, applyPolicyToWizard]);

  const handleEditFromCommand = useCallback(() => {
    if (!commandPolicy) {
      setShowWizard(true);
      setStep(1);
      return;
    }
    applyPolicyToWizard(commandPolicy, 1);
  }, [commandPolicy, applyPolicyToWizard]);

  // Native CELO balance for the gas warning (warning only, never blocking;
  // shown only when determinable).
  const { data: nativeBalance } = useBalance({
    address: wallet.address as `0x${string}` | undefined,
    chainId: targetChainId,
    query: { enabled: Boolean(wallet.address) },
  });

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleNetworkChange = useCallback(
    (chainId: number) => {
      if (chainId === targetChainId) return;
      setTargetChainId(chainId);
      setErrors({});
      setSubmitError(null);
      flow.reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetChainId],
  );

  const handleRulesChange = useCallback(
    (data: ProtectionRulesData) => {
      setProtectionRules(data);
      clearError("releaseRule");
    },
    [clearError],
  );

  // ---- Redirect to the Payment Room once funds are protected ----
  // P4.5F: preserve explicit chain (Mainnet 42220 / Sepolia) so the room
  // never falls back to the wrong network after a real production lifecycle.
  useEffect(() => {
    if (flow.phase === "done" && flow.createdPaymentId !== undefined) {
      router.push(`/payments/${flow.createdPaymentId.toString()}?chainId=${targetChainId}`);
    }
  }, [flow.phase, flow.createdPaymentId, router, targetChainId]);

  const parsedRaw = useMemo(
    () => parseAmountToRaw(amount, token.decimals),
    [amount, token.decimals],
  );

  const insufficientBalance =
    parsedRaw !== null &&
    flow.tokenBalance !== undefined &&
    flow.tokenBalance < parsedRaw;

  const walletOnTarget =
    wallet.isConnected &&
    wallet.chainId !== undefined &&
    wallet.chainId === targetChainId;
  const walletMismatched =
    wallet.isConnected &&
    wallet.chainId !== undefined &&
    wallet.chainId !== targetChainId;

  const goToStep1 = () => setStep(1);
  const goToStep2 = () => {
    const errs = validatePaymentStep(
      { workerWallet, amount },
      token.decimals,
      tokenDisplay,
    );
    setErrors(errs);
    if (Object.keys(errs).length === 0) setStep(2);
  };
  const goToStep3 = () => {
    const errs = validateTermsStep({
      title,
      deliverable,
      deliveryFormat,
      deadline,
      releaseRule: protectionRules.releaseRule,
    });
    setErrors(errs);
    if (Object.keys(errs).length === 0) setStep(3);
  };

  const handleProtect = () => {
    // Re-validate everything (never trust the step state alone).
    const step1Errs = validatePaymentStep(
      { workerWallet, amount },
      token.decimals,
      tokenDisplay,
    );
    const step2Errs = validateTermsStep({
      title,
      deliverable,
      deliveryFormat,
      deadline,
      releaseRule: protectionRules.releaseRule,
    });
    const all = { ...step1Errs, ...step2Errs };
    setErrors(all);
    if (Object.keys(all).length > 0) {
      setStep(Object.keys(step1Errs).length > 0 ? 1 : 2);
      return;
    }
    requireWallet(() => {
      setSubmitError(null);
      // Fail closed: never submit cross-network.
      if (wallet.chainId !== targetChainId) {
        setSubmitError(
          `Switch to ${networkDisplay} to protect this payment.`,
        );
        return;
      }
      const raw = parseAmountToRaw(amount, token.decimals);
      if (raw === null) {
        setErrors((prev) => ({
          ...prev,
          amount: "Enter an amount greater than zero.",
        }));
        setStep(1);
        return;
      }
      // Pre-transaction funds check (uses the existing allowance/balance hook).
      if (flow.tokenBalance !== undefined && flow.tokenBalance < raw) {
        setSubmitError(
          `Your ${tokenDisplay} balance is less than ${amount} ${tokenDisplay}. Add funds before protecting this payment.`,
        );
        return;
      }
      flow.start({
        worker: workerWallet.trim() as `0x${string}`,
        amount: raw,
        rawAmount: raw,
        agreementLabel: title.trim(),
        deliverableSummary: deliverable.trim(),
        deliveryFormat: deliveryFormat.trim(),
        deliveryDeadline: dateToUnixTimestamp(deadline),
        releaseRule: protectionRules.releaseRule,
        autoReleaseSeconds: protectionRules.autoReleaseHours
          ? parseInt(protectionRules.autoReleaseHours, 10) * 3600
          : 0,
        disputeWindowSeconds: protectionRules.disputeWindow
          ? parseInt(protectionRules.disputeWindow, 10) * 3600
          : 0,
        evidenceExpectation: protectionRules.evidenceExpectation.trim(),
      });
    });
  };

  const releaseRuleLabel =
    RELEASE_RULE_LABELS[protectionRules.releaseRule] ??
    protectionRules.releaseRule;
  const today = new Date().toISOString().slice(0, 10);
  const flowStarted = flow.phase !== "idle";
  const protectDisabled =
    flow.isWorking || walletMismatched || flow.phase === "done";

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
        Protect a payment
      </h1>
      {!showWizard && (
        <p className="mt-1 text-[15px] text-muted">
          Describe what you want handled — Reclaim drafts the protected-payment
          policy for your review.
        </p>
      )}
      {showWizard && (
        <p className="mt-1 text-[15px] text-muted">
          {step === 1 && "Step 1 of 3 — tell us who to pay and how much."}
          {step === 2 && "Step 2 of 3 — describe the work in plain words."}
          {step === 3 && "Step 3 of 3 — review, then lock the funds in."}
        </p>
      )}

      {!showWizard && (
        <div className="mt-6 space-y-6">
          <CommandBox
            onSubmit={handleCommandSubmit}
            isWorking={commandWorking}
            error={commandError}
            boundaryMessage={commandBoundary}
          />
          {commandThread.length > 0 && (
            <div
              aria-label="Command conversation"
              className="rounded-[--radius-card] border border-border bg-surface p-6 space-y-3"
            >
              {commandThread.map((msg, i) => (
                <p
                  key={i}
                  className={`text-[14px] leading-relaxed ${msg.role === "user" ? "text-ink" : "text-muted"}`}
                >
                  <span className="font-medium">
                    {msg.role === "user" ? "You: " : "Reclaim: "}
                  </span>
                  {msg.text}
                </p>
              ))}
              {commandQuestion && !commandPolicy && (
                <div className="pt-2">
                  <CommandBox
                    onSubmit={handleCommandSubmit}
                    isWorking={commandWorking}
                    error={null}
                    boundaryMessage={null}
                    compact
                  />
                </div>
              )}
            </div>
          )}
          {commandPolicy && (
            <PolicyConfirmationCard
              policy={commandPolicy}
              deadlineLabel={commandDeadlineLabel}
              onProtect={handleProtectFromCommand}
              onEdit={handleEditFromCommand}
            />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setShowWizard(true);
              }}
              className="text-[14px] font-medium text-muted hover:text-ink transition-colors"
            >
              Or fill in the details manually →
            </button>
          </div>
        </div>
      )}

      {showWizard && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowWizard(false)}
            className="text-[14px] font-medium text-muted hover:text-ink transition-colors"
          >
            ← Back to command
          </button>
        </div>
      )}
      {showWizard && (
        <div className="mt-4">
          <NewPaymentStepper currentStep={step} />
        </div>
      )}

      {showWizard && walletMismatched && (
        <div className="mt-6">
          <Notice variant="warning">
            <p className="text-[14px] leading-relaxed">
              {wallet.chainId !== undefined &&
              isSupportedChain(wallet.chainId) ? (
                <>
                  Your wallet is on {getChainName(wallet.chainId)}. This
                  payment will be protected on {networkDisplay}.
                </>
              ) : (
                <>
                  Your wallet is on an unsupported network. This payment will
                  be protected on {networkDisplay}.
                </>
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => requestNetworkSwitch(targetChainId)}
            >
              Switch to {networkDisplay}
            </Button>
          </Notice>
        </div>
      )}

      {showWizard && step === 1 && (
        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            <section aria-label="Network">
              <span
                id="new-payment-network-label"
                className="text-[15px] font-medium text-ink"
              >
                Network
              </span>
              <div
                role="group"
                aria-labelledby="new-payment-network-label"
                className="mt-1.5 flex gap-2"
              >
                <button
                  type="button"
                  aria-pressed={isMainnet}
                  disabled={flowStarted}
                  onClick={() =>
                    handleNetworkChange(DEFAULT_NEW_PAYMENT_CHAIN_ID)
                  }
                  className={`rounded-[--radius-pill] border px-4 py-2 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    isMainnet
                      ? "border-primary bg-primary text-page"
                      : "border-border bg-surface text-ink hover:bg-input"
                  }`}
                >
                  Celo <span className="opacity-70">· Live</span>
                </button>
                <button
                  type="button"
                  aria-pressed={!isMainnet}
                  disabled={flowStarted}
                  onClick={() => handleNetworkChange(CELO_CHAIN_ID)}
                  className={`rounded-[--radius-pill] border px-4 py-2 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    !isMainnet
                      ? "border-primary bg-primary text-page"
                      : "border-border bg-surface text-ink hover:bg-input"
                  }`}
                >
                  Celo Sepolia <span className="opacity-70">· Test</span>
                </button>
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {isMainnet
                  ? `Live payments on Celo, protected in ${tokenDisplay}.`
                  : "Test payments on Celo Sepolia, protected in USDC."}
              </p>
            </section>

            <div>
              <span className="text-[15px] font-medium text-ink">
                Your wallet
              </span>
              <div className="mt-1.5">
                <Notice variant="info">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[14px]">
                      {wallet.isConnected
                        ? `Connected. You will approve 3 transactions: create, approve ${tokenDisplay}, then lock the funds.`
                        : "Connect your wallet. You will approve 3 transactions: create, approve, then lock the funds."}
                    </span>
                    <WalletButton />
                  </div>
                </Notice>
              </div>
            </div>

            <Input
              label="Freelancer wallet"
              placeholder="0x..."
              value={workerWallet}
              onChange={(e) => {
                setWorkerWallet(e.target.value);
                clearError("workerWallet");
              }}
              error={errors.workerWallet}
              helper="The Celo wallet address of the freelancer receiving this payment."
            />

            <Input
              label="Amount"
              placeholder="100.00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError("amount");
              }}
              error={errors.amount}
              helper={`Payment amount in ${tokenDisplay}.`}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="text-[15px] font-medium text-ink">
                  Currency
                </label>
                <div className="mt-1.5 h-12 flex items-center rounded-[--radius-input] border border-border bg-input px-4 text-[15px] text-ink">
                  {tokenDisplay}
                  <span className="ml-2 text-[13px] text-muted">
                    {token.symbol}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-[15px] font-medium text-ink">
                  Network
                </label>
                <div className="mt-1.5 h-12 flex items-center rounded-[--radius-input] border border-border bg-input px-4 text-[15px] text-ink">
                  {networkDisplay}
                </div>
              </div>
            </div>

            {wallet.isConnected && (
              <p className="text-[14px] text-muted" aria-live="polite">
                Your {tokenDisplay} balance:{" "}
                {flow.isLoadingTokenBalance ? (
                  "checking…"
                ) : flow.tokenBalance !== undefined ? (
                  <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-ink">
                    {formatUSDC(flow.tokenBalance, token.decimals)}{" "}
                    {tokenDisplay}
                  </span>
                ) : (
                  "unavailable"
                )}
              </p>
            )}
            {insufficientBalance && (
              <Notice variant="warning">
                <p className="text-[14px] leading-relaxed">
                  Your {tokenDisplay} balance is less than {amount}{" "}
                  {tokenDisplay}. Add funds before protecting this payment.
                </p>
              </Notice>
            )}

            {nativeBalance?.value === 0n && (
              <Notice variant="warning">
                <p className="text-[14px] leading-relaxed">
                  You have no CELO on {networkDisplay} for network fees. Add a
                  small amount of CELO so your transactions can go through.
                </p>
              </Notice>
            )}

            <div className="flex items-center gap-4 pt-2">
              <Button size="lg" onClick={goToStep2}>
                Continue to terms
              </Button>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-[8rem] space-y-6">
              <AgreementPreview
                amount={amount}
                worker={workerWallet}
                tokenLabel={tokenDisplay}
                networkLabel={networkDisplay}
              />
            </div>
          </div>
        </div>
      )}

      {showWizard && step === 2 && (
        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            <section aria-label="Work description">
              <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                Describe the work
              </h2>
              <p className="mt-1 text-[14px] text-muted">
                Short titles work best. These details are saved with the
                agreement so both sides see the same terms.
              </p>
              <div className="mt-4 space-y-5">
                <Input
                  label="Agreement title"
                  placeholder="Landing page design"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearError("title");
                  }}
                  error={errors.title}
                  helper="Keep the title under 32 characters so it fits the agreement record."
                />

                <Textarea
                  label="Deliverable description"
                  placeholder="Short summary of what will be delivered"
                  value={deliverable}
                  onChange={(e) => {
                    setDeliverable(e.target.value);
                    clearError("deliverable");
                  }}
                  error={errors.deliverable}
                  helper="Keep the deliverable summary under 32 characters so it fits the agreement record."
                />

                <Input
                  label="Delivery format (optional)"
                  placeholder="Figma file and exported mobile screens"
                  value={deliveryFormat}
                  onChange={(e) => {
                    setDeliveryFormat(e.target.value);
                    clearError("deliveryFormat");
                  }}
                  error={errors.deliveryFormat}
                  helper="Keep the delivery format under 32 characters so it fits the agreement record."
                />

                <Input
                  label="Delivery date"
                  type="date"
                  min={today}
                  value={deadline}
                  onChange={(e) => {
                    setDeadline(e.target.value);
                    clearError("deadline");
                  }}
                  error={errors.deadline}
                  helper="When should the work be delivered? Pick a future date."
                />
              </div>
            </section>

            <ProtectionRules
              value={protectionRules}
              onChange={handleRulesChange}
            />
            {errors.releaseRule && (
              <p className="text-[13px] text-red-600" role="alert">
                {errors.releaseRule}
              </p>
            )}

            <div className="flex items-center gap-4 pt-2">
              <Button variant="secondary" onClick={goToStep1}>
                Back
              </Button>
              <Button size="lg" onClick={goToStep3}>
                Continue to review
              </Button>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-[8rem] space-y-6">
              <AgreementPreview
                amount={amount}
                worker={workerWallet}
                title={title}
                deliverable={deliverable}
                deliveryFormat={deliveryFormat}
                deadline={deadline}
                releaseRule={protectionRules.releaseRule}
                disputeWindow={protectionRules.disputeWindow}
                evidenceExpectation={protectionRules.evidenceExpectation}
                tokenLabel={tokenDisplay}
                networkLabel={networkDisplay}
              />
            </div>
          </div>
        </div>
      )}

      {showWizard && step === 3 && (
        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProtectPreflight
              amount={amount}
              tokenDisplay={tokenDisplay}
              worker={workerWallet}
              networkDisplay={networkDisplay}
              terms={{
                title,
                deliverable,
                deliveryFormat,
                deadline,
                releaseRuleLabel: releaseRuleLabel,
                disputeWindow: protectionRules.disputeWindow,
                evidenceExpectation: protectionRules.evidenceExpectation,
              }}
            />

            <div className="mt-6 space-y-4">
              {(submitError || flow.error) && (
                <Notice variant="warning">
                  <p className="text-[14px] leading-relaxed" role="alert">
                    {submitError ?? flow.error}
                  </p>
                  {flow.error && !flow.isWorking && flow.phase !== "done" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-3"
                      onClick={flow.retry}
                    >
                      Try again
                    </Button>
                  )}
                  {submitError?.startsWith("Switch to ") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-3"
                      onClick={() => requestNetworkSwitch(targetChainId)}
                    >
                      Switch to {networkDisplay}
                    </Button>
                  )}
                </Notice>
              )}

              {flowStarted && flow.phase !== "done" && (
                <Notice variant="info">
                  <p className="text-[14px] leading-relaxed">
                    <span className="inline-flex items-center gap-2">
                      {flow.isWorking && (
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
                      )}
                      <span aria-live="polite">{flow.progressLabel}</span>
                    </span>
                  </p>
                  <ul className="mt-2 space-y-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted break-all">
                    {flow.createTxHash && (
                      <li>
                        Create:{" "}
                        <a
                          href={explorerTxUrl(targetChainId, flow.createTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gold hover:text-gold/80 transition-colors"
                        >
                          {flow.createTxHash}
                        </a>
                      </li>
                    )}
                    {flow.approveTxHash && (
                      <li>
                        Approve:{" "}
                        <a
                          href={explorerTxUrl(targetChainId, flow.approveTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gold hover:text-gold/80 transition-colors"
                        >
                          {flow.approveTxHash}
                        </a>
                      </li>
                    )}
                    {flow.fundTxHash && (
                      <li>
                        Protect:{" "}
                        <a
                          href={explorerTxUrl(targetChainId, flow.fundTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gold hover:text-gold/80 transition-colors"
                        >
                          {flow.fundTxHash}
                        </a>
                      </li>
                    )}
                  </ul>
                </Notice>
              )}

              {flow.phase === "done" && (
                <Notice variant="success">
                  <p className="text-[15px] font-semibold text-ink">
                    Payment protected
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed">
                    {amount} {tokenDisplay} for{" "}
                    <span className="font-[family-name:var(--font-ibm-plex-mono)] break-all">
                      {workerWallet}
                    </span>{" "}
                    on {networkDisplay}
                    {flow.createdPaymentId !== undefined &&
                      ` · Payment ID ${flow.createdPaymentId.toString()}`}.
                    Taking you to the Payment Room…
                  </p>
                  {flow.createdPaymentId !== undefined &&
                    isSupportedChain(targetChainId) && (
                      <div className="mt-4">
                        <SharePaymentLink
                          paymentId={flow.createdPaymentId.toString()}
                          chainId={targetChainId}
                        />
                      </div>
                    )}
                </Notice>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="secondary"
                  onClick={goToStep2}
                  disabled={flow.isWorking || flow.phase === "done"}
                >
                  Back to terms
                </Button>
                {flow.phase !== "done" && (
                  <Button
                    size="lg"
                    onClick={handleProtect}
                    disabled={protectDisabled}
                  >
                    Protect payment
                  </Button>
                )}
              </div>
              {!walletOnTarget && flow.phase === "idle" && (
                <p className="text-[13px] text-muted">
                  {wallet.isConnected
                    ? `You are on ${wallet.chainId !== undefined ? getChainName(wallet.chainId) : "an unknown network"} — switch to ${networkDisplay} to continue.`
                    : `You will confirm on ${networkDisplay} when you protect this payment.`}
                </p>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-[8rem]">
              <Notice variant="info">
                <p className="text-[14px] leading-relaxed">
                  <strong>
                    Your {tokenDisplay} is locked, not sent.
                  </strong>{" "}
                  It moves to the freelancer only after you review and
                  release it — or through a dispute if you disagree.
                </p>
                <div className="mt-3">
                  <WalletButton />
                </div>
              </Notice>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
