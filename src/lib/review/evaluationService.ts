// ---------------------------------------------------------------------------
// Agent-assisted delivery review — server orchestration (P6.2).
//
// Flow: auth (P4.3D challenge, single-use) → canonical payment → state gate
// → verified evidence → deterministic gates (no evidence / no policy → final
// without AI) → AI grading (grounded, cannot override deterministic facts) →
// scrubbed advisory evaluation. No plaintext ever leaves this module.
//
// Dependency-injected for tests: no Next.js, no network, no AI key needed.
// The API route supplies the real readers + provider grading.
// ---------------------------------------------------------------------------

import type { PaymentData } from "@/lib/contracts/types";
import type { DurableEvidenceMetadata } from "@/lib/evidence/reader";
import { isSupportedChain } from "@/lib/web3/chains";
import {
  deliveryEvaluationSchema,
  deadlineStatusFor,
  deriveReleaseMode,
  isEvaluableState,
  recommendationFor,
  EVALUATION_UNAVAILABLE_MESSAGE,
  type DeadlineStatus,
  type DeliveryEvaluation,
  type EvaluationRequirement,
} from "./deliveryEvaluation";
import type {
  AIEvaluationContext,
  AIEvaluationOutput,
} from "./aiEvaluation";

export interface ChallengeVerification {
  ok: boolean;
  code?: string;
  error?: string;
  status?: number;
  signer?: string;
}

export interface EvaluationServiceDeps {
  verifyChallenge: (input: {
    paymentId: string;
    chainId: number;
    wallet: string;
    challengeId: string;
    signature: string;
  }) => Promise<ChallengeVerification>;
  consumeChallenge: (challengeHash: string) => Promise<boolean>;
  hashChallenge: (challengeId: string) => string;
  readPayment: (
    paymentId: string,
    chainId: number,
  ) => Promise<PaymentData | null>;
  readEvidence: (
    paymentId: string,
    chainId: string,
  ) => Promise<DurableEvidenceMetadata>;
  gradeWithAI: (
    context: AIEvaluationContext,
  ) => Promise<AIEvaluationOutput | null>;
}

export interface EvaluationRequest {
  paymentId: unknown;
  chainId: unknown;
  wallet: unknown;
  challengeId: unknown;
  signature: unknown;
}

export interface EvaluationResponse {
  status: number;
  body: Record<string, unknown>;
}

function parseChainId(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (!isSupportedChain(parsed)) return null;
  return parsed;
}

/** Non-content manifest signals the model may cite (never raw content). */
export function manifestSignalsFor(
  facts: DurableEvidenceMetadata,
): string[] {
  const signals: string[] = [];
  if (facts.pastedText && facts.pastedText.trim()) signals.push("delivery text present");
  if (facts.relatedClaim && facts.relatedClaim.trim()) signals.push("delivery claim present");
  if (facts.description && facts.description.trim()) signals.push("delivery description present");
  if (facts.fileHash && facts.fileHash.trim()) signals.push("file hash present");
  if (facts.externalRef && facts.externalRef.trim()) signals.push("external reference present");
  if (facts.evidenceDate && facts.evidenceDate.trim()) signals.push("delivery date present");
  if (facts.evidenceType && facts.evidenceType.trim())
    signals.push(`evidence type: ${facts.evidenceType.trim()}`);
  if (facts.substantiveEvidence) signals.push("substantive delivery content");
  return signals;
}

/** Agreed requirement labels reconstructed from canonical agreement fields. */
export function requirementLabelsFor(payment: {
  deliverableSummary?: string | null;
  deliveryFormat?: string | null;
  evidenceExpectation?: string | null;
}): string[] {
  const labels: string[] = [];
  if (payment.deliverableSummary && payment.deliverableSummary.trim()) {
    labels.push(payment.deliverableSummary.trim());
  }
  if (payment.deliveryFormat && payment.deliveryFormat.trim()) {
    labels.push(`Delivery format: ${payment.deliveryFormat.trim()}`);
  }
  if (payment.evidenceExpectation && payment.evidenceExpectation.trim()) {
    labels.push(payment.evidenceExpectation.trim());
  }
  return labels.slice(0, 8);
}

/**
 * Remove verbatim delivery-plaintext echoes (≥24 chars) from model prose.
 * Agreement labels (public) are never secrets.
 */
export function scrubPlaintext(
  text: string,
  secrets: Array<string | null | undefined>,
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const trimmed = secret.trim();
    if (trimmed.length < 24) continue;
    if (out.includes(trimmed)) {
      out = out.split(trimmed).join("[delivery detail]");
    }
  }
  return out;
}

function unavailable(status: number, reason: string, message: string) {
  return { status, body: { available: false, reason, message } };
}

export async function evaluateDeliveryRequest(
  deps: EvaluationServiceDeps,
  req: EvaluationRequest,
): Promise<EvaluationResponse> {
  const paymentId =
    typeof req.paymentId === "string" ? req.paymentId.trim() : "";
  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return {
      status: 400,
      body: { error: "Invalid payment id.", code: "INVALID_PAYMENT_ID" },
    };
  }
  const chainId = parseChainId(req.chainId);
  if (chainId === null) {
    return {
      status: 400,
      body: { error: "Unsupported chain.", code: "UNSUPPORTED_CHAIN" },
    };
  }
  const challengeId =
    typeof req.challengeId === "string" ? req.challengeId.trim() : "";
  const signature =
    typeof req.signature === "string" ? req.signature.trim() : "";
  const wallet = typeof req.wallet === "string" ? req.wallet.trim() : "";

  if (!challengeId || !signature) {
    return {
      status: 401,
      body: {
        error: "Evidence challenge and signature are required.",
        code: "CHALLENGE_REQUIRED",
      },
    };
  }
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return {
      status: 400,
      body: { error: "Wallet address is required.", code: "INVALID_WALLET" },
    };
  }

  const verification = await deps.verifyChallenge({
    paymentId,
    chainId,
    wallet,
    challengeId,
    signature,
  });
  if (!verification.ok) {
    return {
      status: verification.status ?? 401,
      body: { error: verification.error, code: verification.code },
    };
  }

  const consumed = await deps.consumeChallenge(
    deps.hashChallenge(challengeId),
  );
  if (!consumed) {
    return {
      status: 401,
      body: {
        error: "Evidence challenge has already been used.",
        code: "CHALLENGE_CONSUMED",
      },
    };
  }

  const payment = await deps.readPayment(paymentId, chainId);
  if (!payment) {
    return {
      status: 404,
      body: { error: "Payment does not exist.", code: "PAYMENT_NOT_FOUND" },
    };
  }

  const signer = (verification.signer ?? wallet).toLowerCase();
  const role =
    signer === payment.client.toLowerCase()
      ? "client"
      : signer === payment.worker.toLowerCase()
        ? "worker"
        : null;
  if (!role) {
    return {
      status: 403,
      body: {
        error: "Only the client or worker may request a delivery review.",
        code: "NOT_PARTY",
      },
    };
  }

  if (!isEvaluableState(payment.state)) {
    return unavailable(
      200,
      "INVALID_STATE",
      "A delivery review is available after the worker submits delivery.",
    );
  }

  const facts = await deps.readEvidence(paymentId, String(chainId));
  const labels = requirementLabelsFor(payment);
  if (labels.length === 0) {
    return unavailable(
      200,
      "NO_POLICY_REQUIREMENTS",
      EVALUATION_UNAVAILABLE_MESSAGE,
    );
  }

  const hasReference = Boolean(
    payment.evidenceReference && payment.evidenceReference.trim(),
  );
  const signals = manifestSignalsFor(facts);

  // Deterministic floor: no evidence record at all → final, no AI call.
  if (!hasReference || signals.length === 0) {
    const requirements: EvaluationRequirement[] = labels.map((label) => ({
      requirement: label,
      status: "missing" as const,
      evidence: "no evidence submitted",
    }));
    const evaluation: DeliveryEvaluation = {
      paymentId,
      chainId,
      recommendation: "insufficient_evidence",
      summary:
        "No delivery evidence is available for review yet. The client should wait for the worker's submission or ask for it directly.",
      requirements,
      deadlineStatus: deadlineStatusFor(payment.deliveryAt, payment.deliveryDeadline),
      concerns: ["No delivery evidence has been submitted yet."],
      confidence: "high",
      evaluatedAt: new Date().toISOString(),
    };
    return {
      status: 200,
      body: {
        available: true,
        role,
        releaseMode: deriveReleaseMode(payment.releaseRule),
        evaluation,
      },
    };
  }

  const deadlineStatus: DeadlineStatus = deadlineStatusFor(
    payment.deliveryAt,
    payment.deliveryDeadline,
  );

  // AI grading — honest unavailability, never a silent positive.
  let graded: AIEvaluationOutput | null;
  try {
    graded = await deps.gradeWithAI({
      purpose: payment.agreementLabel || "",
      deliverables: payment.deliverableSummary ? [payment.deliverableSummary] : [],
      evidenceRequirements: payment.evidenceExpectation ? [payment.evidenceExpectation] : [],
      deadlineLabel:
        payment.deliveryDeadline > BigInt(0)
          ? new Date(Number(payment.deliveryDeadline) * 1000).toISOString().split("T")[0] ?? ""
          : "not set",
      requirementLabels: labels,
      manifestSignals: signals,
      deadlineStatus,
    });
  } catch {
    graded = null;
  }
  if (!graded) {
    return unavailable(200, "AI_UNAVAILABLE", EVALUATION_UNAVAILABLE_MESSAGE);
  }

  // Ground grades: only known labels survive; gaps stay unclear.
  const gradeByLabel = new Map(
    graded.requirements.map((g) => [g.requirement.trim().toLowerCase(), g]),
  );
  const secrets = [
    facts.title,
    facts.description,
    facts.relatedClaim,
    facts.pastedText,
    facts.evidenceDate,
    facts.externalRef,
  ];
  const requirements: EvaluationRequirement[] = labels.map((label) => {
    const grade = gradeByLabel.get(label.trim().toLowerCase());
    if (!grade) {
      return {
        requirement: label,
        status: "unclear" as const,
        evidence: "not clearly evidenced",
      };
    }
    return {
      requirement: label,
      status: grade.status,
      evidence: scrubPlaintext(grade.evidence, secrets) || "manifest signal present",
    };
  });

  const evaluation: DeliveryEvaluation = {
    paymentId,
    chainId,
    recommendation: recommendationFor(requirements, deadlineStatus),
    summary: scrubPlaintext(graded.summary, secrets),
    requirements,
    deadlineStatus,
    concerns: graded.concerns.map((c) => scrubPlaintext(c, secrets)),
    confidence: graded.confidence,
    evaluatedAt: new Date().toISOString(),
  };

  const parsed = deliveryEvaluationSchema.safeParse(evaluation);
  if (!parsed.success) {
    return unavailable(200, "AI_UNAVAILABLE", EVALUATION_UNAVAILABLE_MESSAGE);
  }

  return {
    status: 200,
    body: {
      available: true,
      role,
      releaseMode: deriveReleaseMode(payment.releaseRule),
      evaluation: parsed.data,
    },
  };
}
