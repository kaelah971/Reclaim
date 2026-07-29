// ---------------------------------------------------------------------------
// x402 evidence quality assessment generator
//
// Produces a structured evidence quality assessment using AI with a
// deterministic fallback when AI is unavailable.
//
// The assessment evaluates:
//   - Credibility: factual basis, internal consistency
//   - Relevance: connection to the payment / agreement
//   - Completeness: what's present vs what's missing
//   - Bias / risk flags: language patterns, missing context
//
// IMPORTANT: This module NEVER determines truth or outcome. It flags
// quality indicators for human reviewers to consider.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import { generateStructuredJSON } from "./providers";
import type { EvidenceCheckRequestInput } from "../evidenceCheckValidation";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface EvidenceQualityAssessment {
  assessmentId: string;
  generatedAt: string;
  generationMode: "ai" | "deterministic_fallback";
  provider?: string;
  model?: string;
  evidenceTitle: string;
  evidenceInputHash: string;
  qualityScore: number; // 1-100, higher = better quality evidence
  relevanceRating: "high" | "medium" | "low";
  relevanceNote: string;
  credibilityAssessment: string;
  completenessAssessment: string;
  factualConsistencyNote: string;
  biasOrConflictNote: string;
  strengths: string[];
  weaknesses: string[];
  recommendedActions: string[];
  riskFlags: string[];
  limitations: string;
}

export interface EvidenceQualityGenerationResult {
  assessment: EvidenceQualityAssessment;
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// System prompt for the AI quality assessment
// ---------------------------------------------------------------------------

const QUALITY_SYSTEM_PROMPT = `You are an evidence quality analyst for a decentralized escrow dispute resolution system.

Your job is to ASSESS THE QUALITY of submitted evidence — NOT to determine truth, decide outcomes, or assign blame.

Evaluate evidence along these dimensions:
1. CREDIBILITY: Does the evidence have a factual basis? Is it internally consistent?
2. RELEVANCE: How directly does this evidence relate to the payment/agreement in question?
3. COMPLETENESS: What key information is present? What is obviously missing?
4. BIAS / CONFLICT: Are there signs of one-sided framing, emotional language, or gaps that suggest missing context?
5. STRENGTHS: What makes this evidence convincing?
6. WEAKNESSES: What undermines the credibility or usefulness of this evidence?

Give a qualityScore from 1 (completely unreliable) to 100 (ironclad, verifiable evidence).

IMPORTANT RULES:
- NEVER determine who is right or wrong
- NEVER recommend releasing funds to either party
- NEVER fabricate facts or assume information not present
- ALWAYS note when evidence is one-sided or incomplete
- ALWAYS flag emotionally charged language as a potential bias indicator`;

// ---------------------------------------------------------------------------
// Deterministic fallback — basic quality assessment without AI
// ---------------------------------------------------------------------------

function generateDeterministicQualityAssessment(
  input: EvidenceCheckRequestInput,
  evidenceInputHash: string,
): EvidenceQualityAssessment {
  const now = new Date().toISOString();
  const assessmentId = keccak256(
    stringToHex(`evidence-quality:${evidenceInputHash}:${now}`),
  );

  const hasDescription = (input.evidenceDescription?.length ?? 0) > 20;
  const hasPastedText = (input.pastedText?.length ?? 0) > 20;
  const hasFileHash = (input.fileHash?.length ?? 0) > 0;
  const hasExternalRef = (input.externalRef?.length ?? 0) > 0;
  const hasDate = (input.evidenceDate?.length ?? 0) > 0;
  const hasType = (input.evidenceType?.length ?? 0) > 0;

  // Simple heuristic scoring based on completeness of metadata
  let score = 50; // baseline
  if (hasDescription) score += 10;
  if (hasPastedText) score += 10;
  if (hasFileHash) score += 10;
  if (hasExternalRef) score += 5;
  if (hasDate) score += 5;
  if (hasType) score += 5;
  if (input.relatedClaim) score += 5;
  score = Math.min(score, 95);

  // Determine relevance
  let relevanceRating: "high" | "medium" | "low" = "medium";
  let relevanceNote = "Deterministic assessment — human review required to evaluate relevance.";
  if (hasDescription && input.relatedClaim) {
    relevanceRating = "high";
    relevanceNote = "Evidence includes a description and is linked to a specific claim.";
  } else if (!hasDescription && !input.relatedClaim) {
    relevanceRating = "low";
    relevanceNote = "Evidence lacks a description and is not linked to any claim. Context is missing.";
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];
  const riskFlags: string[] = [];

  if (hasDescription) {
    strengths.push("Evidence includes a written description.");
  } else {
    weaknesses.push("No evidence description provided — context is unclear.");
    recommendations.push("Add a detailed description of what the evidence shows.");
  }

  if (hasPastedText) {
    strengths.push("Text content has been submitted for review.");
  } else {
    weaknesses.push("No pasted text content — evidence may lack substance.");
    recommendations.push("Paste relevant message logs, terms, or documentation.");
  }

  if (hasFileHash) {
    strengths.push("A file hash is provided, enabling content integrity verification.");
  } else {
    weaknesses.push("No file hash — files cannot be verified for integrity.");
    recommendations.push("Upload supporting files to generate a verifiable file hash.");
  }

  if (hasExternalRef) {
    strengths.push("An external reference or link has been included.");
  }

  if (hasDate) {
    strengths.push("Evidence date is specified, providing a timeline anchor.");
  } else {
    weaknesses.push("No date specified — chronological context is missing.");
    recommendations.push("Specify when the evidence was created or when events occurred.");
  }

  if (hasType) {
    strengths.push("Evidence type is classified.");
  } else {
    weaknesses.push("Evidence type is not specified — hard to categorize.");
    recommendations.push("Classify the evidence type (e.g., screenshot, message log, contract).");
  }

  if (!input.walletAddress) {
    weaknesses.push("No wallet address provided — the submitter's identity is not cryptographically verified.");
    riskFlags.push("Unverified submitter — evidence could be from an unknown third party.");
  }

  // Check for bias indicators in deterministic mode
  const combinedText = `${input.evidenceDescription} ${input.pastedText}`.toLowerCase();
  const emotionWords = ["scam", "stole", "liar", "fraud", "cheat", "fake", "criminal"];
  for (const word of emotionWords) {
    if (combinedText.includes(word)) {
      riskFlags.push(`Emotionally charged language detected ("${word}") — may indicate biased framing.`);
      break;
    }
  }

  return {
    assessmentId,
    generatedAt: now,
    generationMode: "deterministic_fallback",
    evidenceTitle: input.evidenceTitle,
    evidenceInputHash,
    qualityScore: score,
    relevanceRating,
    relevanceNote,
    credibilityAssessment:
      "Deterministic assessment cannot evaluate credibility beyond metadata completeness. Human review is required.",
    completenessAssessment:
      weaknesses.length > 0
        ? `Missing elements: ${weaknesses.join("; ")}`
        : "All basic metadata fields are present.",
    factualConsistencyNote:
      "Factual consistency cannot be evaluated deterministically. Cross-reference with other evidence and on-chain data.",
    biasOrConflictNote:
      riskFlags.length > 0
        ? `Potential bias indicators found: ${riskFlags.join("; ")}`
        : "No obvious bias indicators detected in deterministic scan.",
    strengths,
    weaknesses,
    recommendedActions: [
      ...recommendations,
      "A human reviewer should evaluate this evidence in context with other case materials.",
    ],
    riskFlags,
    limitations:
      "This deterministic assessment is based on metadata completeness only. " +
      "It does not evaluate content credibility, factual accuracy, or authenticity. " +
      "AI-powered assessment is recommended for richer analysis.",
  };
}

// ---------------------------------------------------------------------------
// AI-powered quality assessment
// ---------------------------------------------------------------------------

async function generateAIQualityAssessment(
  input: EvidenceCheckRequestInput,
  evidenceInputHash: string,
  correlationId: string,
): Promise<EvidenceQualityAssessment> {
  const userMessageParts: string[] = [
    "Please assess the quality of the following evidence submission:",
    "",
    `TITLE: ${input.evidenceTitle}`,
  ];

  if (input.evidenceDescription) {
    userMessageParts.push(`DESCRIPTION: ${input.evidenceDescription}`);
  }
  if (input.evidenceType) {
    userMessageParts.push(`TYPE: ${input.evidenceType}`);
  }
  if (input.relatedClaim) {
    userMessageParts.push(`RELATED CLAIM: ${input.relatedClaim}`);
  }
  if (input.evidenceDate) {
    userMessageParts.push(`DATE: ${input.evidenceDate}`);
  }
  if (input.externalRef) {
    userMessageParts.push(`EXTERNAL REFERENCE: ${input.externalRef}`);
  }
  if (input.pastedText) {
    userMessageParts.push(
      `TEXT CONTENT:\n---\n${input.pastedText.slice(0, 5000)}\n---`,
    );
  }
  if (input.fileHash) {
    userMessageParts.push(`FILE HASH: ${input.fileHash}`);
  }

  userMessageParts.push(
    "",
    "Return a JSON object with these fields:",
    "  qualityScore: number (1-100)",
    '  relevanceRating: "high" | "medium" | "low"',
    "  relevanceNote: string (explain why this rating)",
    "  credibilityAssessment: string (detailed analysis of credibility)",
    "  completenessAssessment: string (what's present vs missing)",
    "  factualConsistencyNote: string (internal consistency check)",
    "  biasOrConflictNote: string (signs of bias or conflicts)",
    '  strengths: string[] (what makes this evidence good)',
    '  weaknesses: string[] (what undermines it)',
    '  recommendedActions: string[] (what should happen next)',
    '  riskFlags: string[] (red flags for reviewers)',
    '  limitations: string (what this assessment cannot determine)',
  );

  const userMessage = userMessageParts.join("\n");

  try {
    const result = await generateStructuredJSON(
      QUALITY_SYSTEM_PROMPT,
      userMessage,
      correlationId,
    );

    const now = new Date().toISOString();

    return {
      assessmentId: keccak256(
        stringToHex(`evidence-quality:${evidenceInputHash}:${now}`),
      ),
      generatedAt: now,
      generationMode: "ai",
      provider: process.env.AI_PROVIDER || "unknown",
      model: process.env.AI_MODEL || "unknown",
      evidenceTitle: input.evidenceTitle,
      evidenceInputHash,
      qualityScore:
        typeof result.qualityScore === "number"
          ? Math.max(1, Math.min(100, Math.round(result.qualityScore)))
          : 50,
      relevanceRating:
        result.relevanceRating === "high" ||
        result.relevanceRating === "medium" ||
        result.relevanceRating === "low"
          ? result.relevanceRating
          : "medium",
      relevanceNote:
        typeof result.relevanceNote === "string"
          ? result.relevanceNote
          : "AI assessment did not provide a relevance note.",
      credibilityAssessment:
        typeof result.credibilityAssessment === "string"
          ? result.credibilityAssessment
          : "AI assessment did not provide a credibility analysis.",
      completenessAssessment:
        typeof result.completenessAssessment === "string"
          ? result.completenessAssessment
          : "AI assessment did not provide a completeness analysis.",
      factualConsistencyNote:
        typeof result.factualConsistencyNote === "string"
          ? result.factualConsistencyNote
          : "AI assessment did not provide a factual consistency note.",
      biasOrConflictNote:
        typeof result.biasOrConflictNote === "string"
          ? result.biasOrConflictNote
          : "AI assessment did not provide a bias note.",
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
      recommendedActions: Array.isArray(result.recommendedActions)
        ? result.recommendedActions
        : [],
      riskFlags: Array.isArray(result.riskFlags) ? result.riskFlags : [],
      limitations:
        typeof result.limitations === "string"
          ? result.limitations
          : "This assessment evaluates quality, not truth. Human review is required.",
    };
  } catch {
    // AI failed — fall back to deterministic
    return generateDeterministicQualityAssessment(input, evidenceInputHash);
  }
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate an evidence quality assessment. Uses AI when configured,
 * falls back to deterministic metadata-based assessment otherwise.
 */
export async function generateEvidenceQuality(
  input: EvidenceCheckRequestInput,
  evidenceInputHash: string,
  correlationId: string,
): Promise<EvidenceQualityGenerationResult> {
  const apiKey = process.env.AI_API_KEY || "";
  const useAI = apiKey.length > 0;

  if (!useAI) {
    console.log(
      `[evidence-quality][${correlationId}] AI not configured — using deterministic fallback`,
    );
    return {
      assessment: generateDeterministicQualityAssessment(input, evidenceInputHash),
      usedFallback: true,
    };
  }

  try {
    console.log(
      `[evidence-quality][${correlationId}] Starting AI quality assessment`,
    );
    const assessment = await generateAIQualityAssessment(
      input,
      evidenceInputHash,
      correlationId,
    );
    return { assessment, usedFallback: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[evidence-quality][${correlationId}] AI assessment failed: ${message}`,
    );
    return {
      assessment: generateDeterministicQualityAssessment(input, evidenceInputHash),
      usedFallback: true,
    };
  }
}
