// ---------------------------------------------------------------------------
// Case Refresh Generator
//
// Produces a structured case refresh result using AI with a deterministic
// fallback when AI is unavailable.
//
// The refresh evaluates the current case state, identifies changes since
// the last refresh, resolves reviewer questions, and determines readiness.
// ---------------------------------------------------------------------------

import type { CaseRefreshInput } from "./caseRefreshValidation";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CaseRefreshResult {
  caseVersionHash: string;
  evidenceVersionHash: string;
  readiness: "ready" | "needs_more_evidence" | "blocked";
  generatedAt: string;
  generationMode: "ai" | "deterministic_fallback";
  changeSummary: string;
  addressedEvidenceGaps: string[];
  remainingEvidenceGaps: string[];
  unresolvedEvidenceGaps: string[];
  newQuestions: string[];
  reviewerQuestionsResolved: string[];
  reviewerQuestionsRemaining: string[];
  conciseReviewerSummary: string;
  resultVersion: string;
}

export interface CaseRefreshGenerationResult {
  result: CaseRefreshResult;
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

export function generateCaseRefreshDeterministic(
  input: CaseRefreshInput,
): CaseRefreshGenerationResult {
  const now = new Date().toISOString();

  const openGaps = input.openEvidenceRequests.map((r) => r.item);
  const fulfilledGaps = input.fulfilledEvidenceRequests.map((r) => r.item);

  // Determine readiness
  let readiness: CaseRefreshResult["readiness"] = "ready";

  if (input.evidenceCount === 0 && input.openEvidenceRequests.length === 0) {
    readiness = "blocked";
  } else if (input.openEvidenceRequests.length > 0) {
    if (input.openEvidenceRequests.length >= 3) {
      readiness = "blocked";
    } else {
      readiness = "needs_more_evidence";
    }
  }

  // Previous quality check reviewer questions
  const previousQuestions = input.previousQualityCheck?.reviewerQuestions ?? [];
  const resolvedQuestions: string[] = [];
  const remainingQuestions: string[] = [];

  for (const q of previousQuestions) {
    if (fulfilledGaps.length > 0) {
      resolvedQuestions.push(q);
    } else {
      remainingQuestions.push(q);
    }
  }

  // Change summary
  const changeParts: string[] = [];
  if (!input.previousCaseRefresh) {
    changeParts.push("First case refresh for this state.");
  } else if (input.previousCaseRefresh.caseVersionHash !== input.caseVersionHash) {
    changeParts.push(`Case version changed from ${input.previousCaseRefresh.caseVersionHash} to ${input.caseVersionHash}.`);
  } else {
    changeParts.push("No case version change detected since last refresh.");
  }

  if (fulfilledGaps.length > 0) {
    changeParts.push(`${fulfilledGaps.length} evidence request(s) fulfilled: ${fulfilledGaps.join(", ")}.`);
  }

  if (input.openEvidenceRequests.length > 0) {
    changeParts.push(`${input.openEvidenceRequests.length} evidence request(s) still pending.`);
  }

  if (input.evidenceCount === 0) {
    changeParts.push("No evidence has been submitted yet.");
  }

  // New questions based on gaps
  const newQuestions: string[] = [];
  for (const gap of input.openEvidenceRequests) {
    newQuestions.push(`When will evidence for "${gap.item}" be provided by ${gap.party}?`);
  }

  // Unresolved gaps from previous refresh
  const unresolvedGaps: string[] = [
    ...(input.previousCaseRefresh?.unresolvedGaps ?? []),
    ...openGaps.filter((g) =>
      input.previousCaseRefresh?.unresolvedGaps?.includes(g),
    ),
  ];

  const addressedGaps: string[] = fulfilledGaps.filter(
    (g) => input.previousCaseRefresh?.unresolvedGaps?.includes(g),
  );

  const conciseSummary =
    readiness === "ready"
      ? "Case is ready for the next step."
      : readiness === "needs_more_evidence"
        ? "Case needs additional evidence before proceeding."
        : "Case is blocked — significant evidence gaps remain.";

  return {
    result: {
      caseVersionHash: input.caseVersionHash,
      evidenceVersionHash: input.evidenceVersionHash,
      readiness,
      generatedAt: now,
      generationMode: "deterministic_fallback",
      changeSummary: changeParts.join(" "),
      addressedEvidenceGaps: addressedGaps,
      remainingEvidenceGaps: openGaps,
      unresolvedEvidenceGaps: unresolvedGaps,
      newQuestions,
      reviewerQuestionsResolved: resolvedQuestions,
      reviewerQuestionsRemaining: remainingQuestions,
      conciseReviewerSummary: conciseSummary,
      resultVersion: "1.0.0",
    },
    usedFallback: true,
  };
}

// ---------------------------------------------------------------------------
// AI-powered case refresh (stub — falls back to deterministic)
// ---------------------------------------------------------------------------

async function generateAICaseRefresh(
  _input: CaseRefreshInput,
): Promise<CaseRefreshResult> {
  // In the full implementation, this would use AI to analyze the case state.
  // For now, it falls back to deterministic.
  throw new Error("AI case refresh not yet implemented — using fallback");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateCaseRefresh(
  input: CaseRefreshInput,
  _paymentProof?: { txHash: string },
): Promise<CaseRefreshGenerationResult> {
  const apiKey = process.env.AI_API_KEY || "";

  if (!apiKey) {
    return generateCaseRefreshDeterministic(input);
  }

  try {
    const result = await generateAICaseRefresh(input);
    return { result, usedFallback: false };
  } catch {
    return generateCaseRefreshDeterministic(input);
  }
}
