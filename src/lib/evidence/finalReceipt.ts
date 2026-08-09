// ---------------------------------------------------------------------------
// Final receipt builder (RA1R.8F)
//
// Composes the canonical read-only receipt for a RELEASED payment from
// DURABLE, VERIFIED sources only:
//   - on-chain escrow state + release transaction proof (live read)
//   - verified evidence metadata + its on-chain submission proof
//   - the resolution agent's durable review packet (incl. QC provenance and
//     recorded QC-vs-verified-evidence inconsistencies)
//
// The receipt NEVER fabricates data: fields whose source is unavailable are
// null/omitted, never guessed. The receipt is read-only — no signatures, no
// mutations, no re-execution.
//
// Product model preserved:
//   "The contract protects the payment.
//    The agent prepares the resolution.
//    People make the final decision."
// ---------------------------------------------------------------------------

export interface ReceiptProtectedPayment {
  paymentId: string;
  amountAtomic: string;
  amountHuman: string;
  asset: string;
  client: string;
  worker: string;
  escrowContractAddress: string;
  chainId: string;
  network: string;
  finalState: string;
  releasedAt: string | null;
}

/** Original agreement terms, straight from the escrow struct (read-only). */
export interface ReceiptAgreement {
  deliverable: string | null;
  deliveryFormat: string | null;
  releaseRule: string | null;
  evidenceExpectation: string | null;
  deadline: string | null;
  autoReleaseSeconds: string | null;
  disputeWindowSeconds: string | null;
}

export interface ReceiptEvidence {
  title: string | null;
  claim: string | null;
  date: string | null;
  pastedText: string | null;
  evidenceReference: string | null;
  availability: string | null;
  evidenceType: string | null;
  submittedAt: string | null;
  submitter: string | null;
  /** Real on-chain evidence submission tx (DeliveryEvidenceSubmitted). */
  submissionTxHash: string | null;
}

export interface ReceiptResolutionAgent {
  agentId: string | null;
  objective: string | null;
  statement: string;
  caseVersionHash: string | null;
  evidenceVersionHash: string | null;
}

export interface ReceiptQualityCheck {
  toolId: string;
  priceHuman: string | null;
  network: string | null;
  facilitatorUrl: string | null;
  executionRequestHash: string | null;
  readiness: string | null;
  reviewerQuestions: string[];
  ambiguities: string[];
  recommendedImprovements: string[];
  settlementTxHash: string | null;
  paymentReference: string | null;
  resultReference: string | null;
  /** Recorded QC statements contradicting verified evidence (never hidden). */
  inconsistencies: string[];
}

export interface ReceiptHumanDecision {
  decision: string;
  authority: string;
  txHash: string | null;
  sender: string | null;
  blockNumber: string | null;
  blockTime: string | null;
  status: string | null;
  finalRecipient: string;
  outcome: string;
}

export interface ReceiptAudit {
  explorerLinks: {
    escrowContract: string;
    client: string;
    worker: string;
    releaseTransaction: string | null;
    evidenceSubmissionTransaction: string | null;
    x402SettlementTransaction: string | null;
  };
  timestamps: {
    evidenceSubmittedAt: string | null;
    releaseAt: string | null;
    qcSettlementAt: string | null;
  };
}

export interface FinalReceipt {
  schemaVersion: string;
  productModel: string;
  protectedPayment: ReceiptProtectedPayment;
  agreement: ReceiptAgreement;
  evidence: ReceiptEvidence;
  resolutionAgent: ReceiptResolutionAgent;
  qualityCheck: ReceiptQualityCheck;
  humanDecision: ReceiptHumanDecision;
  audit: ReceiptAudit;
}

export interface FinalReceiptInput {
  protectedPayment: ReceiptProtectedPayment;
  agreement: ReceiptAgreement;
  evidence: ReceiptEvidence;
  resolutionAgent: ReceiptResolutionAgent;
  qualityCheck: ReceiptQualityCheck;
  humanDecision: ReceiptHumanDecision;
  audit: ReceiptAudit;
}

/** The canonical product model — always present, never altered. */
export const PRODUCT_MODEL =
  "The contract protects the payment. The agent prepares the resolution. " +
  "People make the final decision.";

/** The agent's canonical closing statement for a completed case. */
export const AGENT_STATEMENT =
  "The agent prepared the case. A person made the final decision.";

export function buildFinalReceipt(input: FinalReceiptInput): FinalReceipt {
  return {
    schemaVersion: "reclaim-final-receipt-v1",
    productModel: PRODUCT_MODEL,
    ...input,
  };
}
