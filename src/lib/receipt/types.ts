// ---------------------------------------------------------------------------
// Canonical receipt data model — shared by /receipts/[receiptId] and
// /receipts (index discovery). Shape of GET /api/payments/[paymentId]/receipt.
// READ-ONLY: composed from verified sources only; missing sources are null.
// ---------------------------------------------------------------------------

export interface ReceiptData {
  found: boolean;
  paymentId?: string;
  agentId?: string | null;
  packetEventId?: string | null;
  receiptCreatedAt?: string | null;
  receipt?: {
    schemaVersion?: string;
    productModel?: string;
    protectedPayment?: {
      paymentId?: string;
      amountAtomic?: string;
      amountHuman?: string;
      asset?: string;
      client?: string;
      worker?: string;
      escrowContractAddress?: string;
      chainId?: string;
      network?: string;
      finalState?: string;
      releasedAt?: string | null;
      escrowState?: string;
      financialOutcome?: string | null;
      resolvedAt?: string | null;
    };
    agreement?: {
      deliverable?: string | null;
      deliveryFormat?: string | null;
      releaseRule?: string | null;
      evidenceExpectation?: string | null;
      deadline?: string | null;
      autoReleaseSeconds?: string | null;
      disputeWindowSeconds?: string | null;
    };
    evidence?: {
      title?: string | null;
      claim?: string | null;
      date?: string | null;
      pastedText?: string | null;
      evidenceReference?: string | null;
      availability?: string | null;
      evidenceType?: string | null;
      submittedAt?: string | null;
      submitter?: string | null;
      submissionTxHash?: string | null;
    };
    resolutionAgent?: {
      agentId?: string | null;
      objective?: string | null;
      statement?: string;
      caseVersionHash?: string | null;
      evidenceVersionHash?: string | null;
    };
    qualityCheck?: {
      toolId?: string;
      priceHuman?: string | null;
      network?: string | null;
      facilitatorUrl?: string | null;
      executionRequestHash?: string | null;
      readiness?: string | null;
      reviewerQuestions?: string[];
      ambiguities?: string[];
      recommendedImprovements?: string[];
      settlementTxHash?: string | null;
      paymentReference?: string | null;
      resultReference?: string | null;
      inconsistencies?: string[];
    };
    humanDecision?: {
      decision?: string | null;
      authority?: string | null;
      txHash?: string | null;
      sender?: string | null;
      blockNumber?: string | null;
      blockTime?: string | null;
      status?: string | null;
      finalRecipient?: string | null;
      outcome?: string | null;
      clientAmount?: string | null;
      workerAmount?: string | null;
      clientAmountHuman?: string | null;
      workerAmountHuman?: string | null;
    };
    audit?: {
      explorerLinks?: {
        escrowContract?: string;
        client?: string;
        worker?: string;
        releaseTransaction?: string | null;
        evidenceSubmissionTransaction?: string | null;
        x402SettlementTransaction?: string | null;
        disputeTransaction?: string | null;
        resolutionTransaction?: string | null;
        cancellationTransaction?: string | null;
      };
      timestamps?: {
        evidenceSubmittedAt?: string | null;
        releaseAt?: string | null;
        qcSettlementAt?: string | null;
        disputedAt?: string | null;
        resolvedAt?: string | null;
        cancelledAt?: string | null;
      };
    };
  };
}
