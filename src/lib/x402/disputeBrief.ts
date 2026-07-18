// ---------------------------------------------------------------------------
// Deterministic dispute brief generator
//
// SERVER-ONLY. Generates a structured dispute brief from user-submitted data
// and on-chain payment data WITHOUT AI. The brief is deterministic — given
// the same inputs it always produces the same output.
//
// IMPORTANT: This module does not call any AI / LLM services. It is a pure
// data transformation that produces a human-readable, structured brief.
// ---------------------------------------------------------------------------

import { keccak256, stringToHex } from "viem";
import type { PaymentData } from "@/lib/contracts/types";
import { formatUSDC, PAYMENT_STATE_LABELS } from "@/lib/contracts/types";
import type { DisputeBriefRequestInput } from "./validation";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DisputeBriefParty {
  label: string;
  address: string;
}

export interface TimelineEntry {
  date: string;
  description: string;
}

export interface DisputeBrief {
  /** Deterministic brief ID: keccak256(paymentId + timestamp + reason). */
  briefId: string;

  /** ISO 8601 timestamp when the brief was generated. */
  generatedTimestamp: string;

  /** Payment ID from the escrow contract. */
  paymentId: string;

  /** Neutral, human-readable case title. */
  neutralCaseTitle: string;

  /** Identified parties (client, worker). */
  parties: {
    client: DisputeBriefParty;
    worker: DisputeBriefParty;
  };

  /** Formatted USDC amount under protection. */
  protectedAmount: string;

  /** Current on-chain state label (human-readable). */
  currentOnChainState: string;

  /** Summary of what was agreed from on-chain terms. */
  agreementSummary: string;

  /** The issue claimed by the disputant. */
  claimedIssue: string;

  /** What the disputant wants as an outcome. */
  requestedOutcome: string;

  /** Inventory of evidence references provided. */
  evidenceInventory: string[];

  /** What evidence is noted as missing. */
  missingEvidence: string[];

  /** Chronological timeline of relevant events. */
  timeline: TimelineEntry[];

  /** Facts that appear to be in dispute (derived from issue + state). */
  disputedFacts: string[];

  /** Facts derived from on-chain data that are not in question. */
  undisputedFacts: string[];

  /** Standard questions that require human review. */
  questionsRequiringHumanReview: string[];

  /** Recommended procedural next steps. */
  proceduralNextSteps: string[];

  /** Standard limitations statement (must always be included). */
  limitationsStatement: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIMITATIONS_STATEMENT =
  "This brief does not determine truth. This brief does not select a winner. " +
  "This brief is not legal advice. AI is not deciding the dispute. Human " +
  "review and contract rules govern resolution.";

const STANDARD_REVIEW_QUESTIONS: readonly string[] = [
  "Was the deliverable substantially completed according to the agreed terms?",
  "What specific portion of the deliverable is in dispute?",
  "Is there independent evidence (screenshots, repos, messages) supporting the claim?",
  "Have the parties attempted to resolve this before raising a formal dispute?",
  "What would a fair split or resolution look like based on work completed?",
  "Are there any external factors (force majeure, third-party dependency) affecting delivery?",
];

const STANDARD_NEXT_STEPS: readonly string[] = [
  "Both parties are invited to review the brief and submit additional evidence.",
  "No automated settlement will occur — human reviewers evaluate the case.",
  "The escrow contract remains frozen until reviewers reach a decision.",
  "Parties may negotiate a private settlement and request dismissal of the dispute.",
];

const DISPUTE_STATE_FACTS: Readonly<Record<string, string[]>> = {
  Funded: [
    "Funds are held in escrow and have not been accessed by either party.",
    "The worker has not yet accepted the payment (no acceptance on-chain).",
  ],
  Accepted: [
    "Funds are held in escrow.",
    "The worker has accepted the payment on-chain, confirming they intend to deliver.",
  ],
  DeliverySubmitted: [
    "Funds are held in escrow.",
    "The worker claims to have delivered and submitted evidence.",
  ],
  ReleaseRequested: [
    "Funds are held in escrow.",
    "The worker has requested release of funds.",
    "The release window may still be active.",
  ],
  Disputed: [
    "Funds are held in escrow and the payment is already in a disputed state.",
    "A dispute reference has been recorded on-chain.",
  ],
};

// ---------------------------------------------------------------------------
// Helper: derive disputed facts from the issue + on-chain state
// ---------------------------------------------------------------------------

function deriveDisputedFacts(
  issue: string,
  payment: PaymentData,
): string[] {
  const facts: string[] = [];

  facts.push(`Dispute reason: ${issue}`);

  if (
    payment.state === "DeliverySubmitted" ||
    payment.state === "ReleaseRequested"
  ) {
    facts.push(
      "The worker claims delivery is complete, but this is contested.",
    );
  }

  if (payment.evidenceReference === "") {
    facts.push("No on-chain evidence reference has been submitted.");
  } else {
    facts.push(
      `An on-chain evidence reference exists (${payment.evidenceReference.slice(0, 10)}...). Its relevance is contested.`,
    );
  }

  // If the payment is already Disputed, note it
  if (payment.state === "Disputed") {
    if (payment.disputeReference) {
      facts.push(
        `An existing dispute reference exists on-chain: ${payment.disputeReference.slice(0, 10)}...`,
      );
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Helper: derive undisputed facts from on-chain data
// ---------------------------------------------------------------------------

function deriveUndisputedFacts(payment: PaymentData): string[] {
  const facts: string[] = [];

  facts.push(
    `Payment ID ${payment.id.toString()} exists on-chain on Celo Sepolia.`,
  );

  facts.push(
    `Protected amount: ${formatUSDC(payment.amount)} USDC held in escrow contract.`,
  );

  facts.push(`Client address: ${payment.client}`);
  facts.push(`Worker address: ${payment.worker}`);

  if (payment.agreementLabel) {
    facts.push(`Agreement terms label: ${payment.agreementLabel}`);
  }
  if (payment.deliverableSummary) {
    facts.push(
      `Deliverable described as: ${payment.deliverableSummary}`,
    );
  }
  if (payment.releaseRule) {
    facts.push(`Release rule: ${payment.releaseRule}`);
  }

  // State-specific undisputed facts
  const stateFacts = DISPUTE_STATE_FACTS[payment.state];
  if (stateFacts) {
    for (const fact of stateFacts) {
      facts.push(fact);
    }
  }

  if (payment.deliveryDeadline > BigInt(0)) {
    facts.push(
      `Delivery deadline recorded on-chain as Unix timestamp ${payment.deliveryDeadline.toString()}.`,
    );
  }

  facts.push(
    `Current on-chain state: ${PAYMENT_STATE_LABELS[payment.state] ?? payment.state}`,
  );

  return facts;
}

// ---------------------------------------------------------------------------
// Helper: build missing evidence list
// ---------------------------------------------------------------------------

function deriveMissingEvidence(
  providedEvidence: string[],
  payment: PaymentData,
): string[] {
  const missing: string[] = [];

  if (!providedEvidence || providedEvidence.length === 0) {
    missing.push("No evidence references were provided by the disputant.");
  }

  if (payment.evidenceReference === "") {
    missing.push(
      "No evidence reference is recorded on-chain for this payment.",
    );
  }

  if (payment.evidenceExpectation) {
    missing.push(
      `The agreement expects evidence: ${payment.evidenceExpectation}`,
    );
  }

  // Check for common missing items
  const providedText = (providedEvidence || []).join(" ").toLowerCase();
  if (!providedText.includes("message") && !providedText.includes("chat")) {
    missing.push("Communication records between parties have not been provided.");
  }
  if (!providedText.includes("deliver") && !providedText.includes("file")) {
    missing.push("Deliverable files or links have not been provided as evidence.");
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic dispute brief from user-submitted dispute data
 * and on-chain payment data.
 *
 * @param request  The validated dispute brief request from the client.
 * @param payment  On-chain payment data fetched from the escrow contract.
 * @returns A structured DisputeBrief.
 */
export function generateDisputeBrief(
  request: DisputeBriefRequestInput,
  payment: PaymentData,
): DisputeBrief {
  const now = new Date();
  const generatedTimestamp = now.toISOString();

  // Deterministic brief ID
  const briefIdSeed = `${request.paymentId}:${generatedTimestamp}:${request.disputeReason}`;
  const briefId = keccak256(stringToHex(briefIdSeed));

  // Neutral case title
  const neutralCaseTitle = request.agreementTitle
    ? `Dispute: ${request.agreementTitle} (Payment #${request.paymentId})`
    : `Payment Dispute #${request.paymentId}`;

  // Parties
  const clientAddr = request.clientAddress || payment.client;
  const workerAddr = request.workerAddress || payment.worker;

  // Protected amount
  const protectedAmount = request.protectedAmount || formatUSDC(payment.amount);

  // Agreement summary from on-chain data
  const agreementParts: string[] = [];
  if (payment.agreementLabel) agreementParts.push(payment.agreementLabel);
  if (payment.deliverableSummary)
    agreementParts.push(`Deliverable: ${payment.deliverableSummary}`);
  if (payment.releaseRule)
    agreementParts.push(`Release: ${payment.releaseRule}`);
  const agreementSummary =
    agreementParts.length > 0
      ? agreementParts.join(" | ")
      : "Agreement terms recorded on-chain (see contract).";

  // Evidence inventory
  const evidenceInventory = request.evidenceReferences || [];

  // Missing evidence
  const missingEvidence = deriveMissingEvidence(evidenceInventory, payment);

  // Timeline
  const timeline: TimelineEntry[] = [
    ...(request.relevantTimelineEntries || []),
    {
      date: generatedTimestamp,
      description: "Dispute brief generated via Reclaim x402 service.",
    },
  ];

  // Disputed and undisputed facts
  const disputedFacts = deriveDisputedFacts(request.disputeReason, payment);
  const undisputedFacts = deriveUndisputedFacts(payment);

  return {
    briefId,
    generatedTimestamp,
    paymentId: request.paymentId,
    neutralCaseTitle,
    parties: {
      client: { label: "Client", address: clientAddr },
      worker: { label: "Worker", address: workerAddr },
    },
    protectedAmount: `${protectedAmount} USDC`,
    currentOnChainState:
      PAYMENT_STATE_LABELS[payment.state] ?? payment.state,
    agreementSummary,
    claimedIssue: request.disputeReason,
    requestedOutcome: request.requestedOutcome,
    evidenceInventory,
    missingEvidence,
    timeline,
    disputedFacts,
    undisputedFacts,
    questionsRequiringHumanReview: [...STANDARD_REVIEW_QUESTIONS],
    proceduralNextSteps: [...STANDARD_NEXT_STEPS],
    limitationsStatement: LIMITATIONS_STATEMENT,
  };
}
