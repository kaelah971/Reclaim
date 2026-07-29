// ---------------------------------------------------------------------------
// Deterministic evidence quality assessment fallback
//
// Computes scores based on evidence metadata completeness and heuristics.
// Used when AI is unavailable or fails. NEVER includes adjudication content.
// ---------------------------------------------------------------------------

import type { EvidenceQualityInput } from "./evidenceQualityPrompt";
import type { EvidenceQualityResult } from "./evidenceQualitySchema";
import { EVIDENCE_QUALITY_SCHEMA_VERSION } from "./evidenceQualitySchema";

// ---------------------------------------------------------------------------
// Field weights for completeness scoring (total = 100)
// ---------------------------------------------------------------------------

const FIELD_WEIGHTS: Record<keyof EvidenceQualityInput, number> = {
  escrowPaymentId: 5,   // payment linkage
  title: 15,             // high weight — essential identifier
  description: 10,       // moderate — provides context
  evidenceType: 5,       // low — categorical
  relatedClaim: 10,      // moderate — ties evidence to claim
  date: 5,               // low — temporal context
  externalRef: 15,       // high — external verification
  pastedText: 15,        // high — content body
  fileHash: 20,          // highest — integrity / tamper evidence
  payerAddress: 0,       // not scored (always present from on-chain)
  paymentState: 0,       // not scored (always present from on-chain)
};

/**
 * Check if a field value is considered "present" (non-empty for strings).
 */
function isFieldPresent(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Compute specificity score based on text length and detail density.
 * Longer, more detailed evidence scores higher (capped at 100).
 */
function computeSpecificityScore(input: EvidenceQualityInput): number {
  const combinedText = [
    input.title,
    input.description,
    input.pastedText,
    input.relatedClaim,
    input.externalRef,
  ].join(" ");

  const length = combinedText.length;

  if (length === 0) return 0;
  if (length < 50) return 20;
  if (length < 150) return 40;
  if (length < 300) return 60;
  if (length < 600) return 75;
  if (length < 1000) return 85;
  return 95;
}

/**
 * Compute relevance score based on whether the evidence relates to
 * the stated claim (keyword overlap heuristic).
 */
function computeRelevanceScore(input: EvidenceQualityInput): number {
  if (!input.relatedClaim || !input.description) {
    // If no related claim or no description, we cannot assess relevance
    return input.relatedClaim ? 40 : 25;
  }

  const claimWords = input.relatedClaim.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const evidenceWords = (input.description + " " + input.pastedText).toLowerCase().split(/\s+/);

  if (claimWords.length === 0) return 50;

  let overlapCount = 0;
  for (const cw of claimWords) {
    if (evidenceWords.some((ew) => ew.includes(cw) || cw.includes(ew))) {
      overlapCount++;
    }
  }

  const ratio = overlapCount / claimWords.length;
  return Math.min(95, Math.round(ratio * 100));
}

/**
 * Compute consistency score — deterministic can only do basic checks,
 * so this is a conservative estimate unless obvious red flags exist.
 */
function computeConsistencyScore(_input: EvidenceQualityInput): number {
  void _input;
  // Deterministic mode cannot truly detect contradictions, so we
  // return a neutral middling score with a note.
  return 70; // neutral: "no contradictions detected by automated analysis"
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic evidence quality assessment based on metadata
 * completeness and simple heuristics. This is the fallback when AI fails
 * or is not configured.
 *
 * NEVER includes any forbidden adjudication content.
 */
export function generateDeterministicEvidenceQuality(
  input: EvidenceQualityInput,
): EvidenceQualityResult {
  // Compute completeness score from weighted field presence
  let completenessScore = 0;
  const presentFields: string[] = [];
  const missingFields: string[] = [];

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as [keyof EvidenceQualityInput, number][]) {
    if (weight === 0) continue; // skip always-present fields
    if (isFieldPresent(input[field])) {
      completenessScore += weight;
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  // Clamp completeness to 100
  completenessScore = Math.min(100, completenessScore);

  // Compute other scores
  const relevanceScore = computeRelevanceScore(input);
  const specificityScore = computeSpecificityScore(input);
  const consistencyScore = computeConsistencyScore(input);

  // Determine readiness from completeness threshold
  let readiness: "ready" | "needs-improvement" | "insufficient";
  if (completenessScore >= 70) {
    readiness = "ready";
  } else if (completenessScore >= 40) {
    readiness = "needs-improvement";
  } else {
    readiness = "insufficient";
  }

  // Build strengths list
  const strengths: string[] = [];
  if (isFieldPresent(input.fileHash)) strengths.push("Evidence includes a file hash for integrity verification.");
  if (isFieldPresent(input.pastedText) && input.pastedText.length > 100) strengths.push("Evidence contains substantial pasted text content.");
  if (isFieldPresent(input.externalRef)) strengths.push("Evidence references an external source for cross-verification.");
  if (isFieldPresent(input.relatedClaim)) strengths.push("Evidence is linked to a specific claim.");
  if (isFieldPresent(input.title)) strengths.push("Evidence has a descriptive title.");
  if (isFieldPresent(input.date)) strengths.push("Evidence includes a date for temporal context.");
  if (presentFields.length >= 6) strengths.push("Evidence metadata is mostly complete.");

  // Build missing evidence description
  const missingEvidenceList = missingFields.length > 0
    ? missingFields.map((f) => `Evidence field '${f}' is missing or empty.`)
    : ["All expected metadata fields are present."];

  // Build claim alignment
  const claimAlignment: string[] = [];
  if (isFieldPresent(input.relatedClaim)) {
    claimAlignment.push(`This evidence references claim: "${input.relatedClaim.slice(0, 200)}".`);
  } else {
    claimAlignment.push("No related claim specified — evidence linkage is unclear.");
  }

  // Build recommended improvements
  const recommendedImprovements: string[] = [];
  for (const field of missingFields) {
    if (field === "pastedText") recommendedImprovements.push("Provide the full text content of the evidence.");
    else if (field === "fileHash") recommendedImprovements.push("Include a cryptographic hash of the evidence file for tamper detection.");
    else if (field === "externalRef") recommendedImprovements.push("Add an external reference (URL, document ID, etc.) for verification.");
    else if (field === "relatedClaim") recommendedImprovements.push("Link this evidence to a specific claim in the dispute.");
    else if (field === "title") recommendedImprovements.push("Add a descriptive title to the evidence.");
    else if (field === "date") recommendedImprovements.push("Include the date associated with this evidence.");
    else if (field === "description") recommendedImprovements.push("Provide a description summarizing the evidence.");
    else if (field === "evidenceType") recommendedImprovements.push("Specify the type of evidence (e.g., screenshot, receipt, email).");
  }
  if (recommendedImprovements.length === 0) {
    recommendedImprovements.push("Evidence package is complete. Consider adding supplementary supporting documents.");
  }

  // Build reviewer questions
  const reviewerQuestions: string[] = [];
  if (!isFieldPresent(input.pastedText)) reviewerQuestions.push("What is the full content of this evidence?");
  if (!isFieldPresent(input.externalRef)) reviewerQuestions.push("Can the evidence be externally verified?");
  if (!isFieldPresent(input.date)) reviewerQuestions.push("When was this evidence created or captured?");
  if (!isFieldPresent(input.relatedClaim)) reviewerQuestions.push("Which specific claim does this evidence support?");
  if (!isFieldPresent(input.fileHash)) reviewerQuestions.push("Has the integrity of this evidence file been verified?");

  const generatedAt = new Date().toISOString();

  return {
    overallAssessment: buildOverallAssessment(completenessScore, readiness, missingFields.length, presentFields.length),
    readiness,
    completenessScore,
    relevanceScore,
    specificityScore,
    consistencyScore,
    strengths,
    missingEvidence: missingEvidenceList,
    ambiguities: consistencyScore < 50
      ? ["Automated analysis could not fully assess internal consistency. Human review recommended."]
      : [],
    contradictionsOrRisks: [],
    claimAlignment,
    recommendedImprovements,
    reviewerQuestions,
    disclaimer:
      "This is an automated, deterministic assessment. It does not determine the truth of any claim, " +
      "does not decide who should receive funds, and does not constitute legal or adjudicative guidance. " +
      "All scores are based on metadata completeness and heuristic analysis only.",

    generationMode: "deterministic_fallback",
    provider: "deterministic",
    model: "none",
    serviceVersion: `EQ-${EVIDENCE_QUALITY_SCHEMA_VERSION}`,
    generatedAt,
    attemptCount: 1,
  };
}

/**
 * Build a human-readable overall assessment summary paragraph.
 */
function buildOverallAssessment(
  completenessScore: number,
  readiness: string,
  missingCount: number,
  presentCount: number,
): string {
  const readinessLabel =
    readiness === "ready"
      ? "ready for reviewer consideration"
      : readiness === "needs-improvement"
        ? "in need of supplementation before full review"
        : "insufficient for meaningful review";

  return (
    `This evidence package received a completeness score of ${completenessScore}/100 ` +
    `(${presentCount} fields present, ${missingCount} missing) and is rated as "${readinessLabel}". ` +
    `The assessment is based on metadata completeness, text specificity, and claimed relevance. ` +
    `This is an automated heuristic analysis and should not replace human reviewer judgment.`
  );
}
