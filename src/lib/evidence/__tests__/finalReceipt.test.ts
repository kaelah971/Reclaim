// ---------------------------------------------------------------------------
// Final receipt builder tests (RA1R.8F)
//
// The receipt must tell the complete real story from durable sources, never
// fabricate data, stay read-only, and preserve the product model.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildFinalReceipt,
  PRODUCT_MODEL,
  AGENT_STATEMENT,
  type FinalReceiptInput,
} from "../finalReceipt";

const RELEASE_TX = "0x271d62cd50a1f9d1d2d1495f74be568050cf5a55e98690940840b2d5ec687298";
const EVIDENCE_TX = "0xaee6b1de391c39daab71015c8d3d4326ec4b40ff577deca0c7471b9f2b677958";
const X402_TX = "0x5f28527fff51fbb8961f6651b1646e3abcb829a4925dcdccf21d948d86dae351";

const CLIENT = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

const input: FinalReceiptInput = {
  protectedPayment: {
    paymentId: "1",
    amountAtomic: "10000",
    amountHuman: "0.01 USDC",
    asset: "USDC",
    client: CLIENT,
    worker: WORKER,
    escrowContractAddress: "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
    chainId: "eip155:11142220",
    network: "Celo Sepolia",
    finalState: "Released",
    releasedAt: "2026-08-09T11:49:09.000Z",
  },
  agreement: {
    deliverable: "Completed work evidence for Payment #1",
    deliveryFormat: "package",
    releaseRule: "manual",
    evidenceExpectation: "Evidence required",
    deadline: "2026-08-10T00:00:00.000Z",
    autoReleaseSeconds: "2592000",
    disputeWindowSeconds: "604800",
  },
  evidence: {
    title: "Controlled dispute test — completed work evidence",
    claim: "Completed work for the controlled dispute test",
    date: "2026-08-08",
    pastedText: "I completed the agreed controlled dispute test deliverable.",
    evidenceReference: "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    availability: "package_available",
    evidenceType: "other",
    submittedAt: "2026-08-09T02:49:25.972Z",
    submitter: "chain_verified",
    submissionTxHash: EVIDENCE_TX,
  },
  resolutionAgent: {
    agentId: "agt_f1f9a3f6-b2ab-4719-995f-90a6d7867235",
    objective: "Prepare this payment case for fair human review.",
    statement: AGENT_STATEMENT,
    caseVersionHash: "0x72ecc6a1d46a2dbb3f20c585e7805f3e7719cbfe4d454444210114446f636695",
    evidenceVersionHash: "0xa55191010c0589a9f1dba4a26f0d168df1b8b1d9e402d7877b3b7a281beddf13",
  },
  qualityCheck: {
    toolId: "evidence-quality-check",
    priceHuman: "$0.01 USDC",
    network: "Celo Mainnet",
    facilitatorUrl: "https://api.x402.celo.org",
    executionRequestHash: "0x8a26b7131c30af20a6210b78cc00f250f20341ed80feb7219e48b36303c83015",
    readiness: "needs_improvement",
    reviewerQuestions: ["Reviewer question: No pasted text content — evidence may lack substance."],
    ambiguities: ["Unverified submitter — evidence could be from an unknown third party."],
    recommendedImprovements: ["Paste relevant message logs, terms, or documentation."],
    settlementTxHash: X402_TX,
    paymentReference: X402_TX,
    resultReference: "0xadca01fdcc736941cdfb99b4b781ae51af21bae7d2fadc8f2ff334492e232ac3",
    inconsistencies: [
      "QC states there is no pasted text, but verified evidence contains pasted text.",
      "QC states no date was specified, but verified evidence has a date.",
    ],
  },
  humanDecision: {
    decision: "Approve release",
    authority: "client",
    txHash: RELEASE_TX,
    sender: CLIENT.toLowerCase(),
    blockNumber: "32992161",
    blockTime: "2026-08-09T11:49:09.000Z",
    status: "success",
    finalRecipient: WORKER,
    outcome: "Released",
  },
  audit: {
    explorerLinks: {
      escrowContract: "https://celo-sepolia.blockscout.com/address/0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F",
      client: "https://celo-sepolia.blockscout.com/address/" + CLIENT,
      worker: "https://celo-sepolia.blockscout.com/address/" + WORKER,
      releaseTransaction: "https://celo-sepolia.blockscout.com/tx/" + RELEASE_TX,
      evidenceSubmissionTransaction: "https://celo-sepolia.blockscout.com/tx/" + EVIDENCE_TX,
      x402SettlementTransaction: "https://celoscan.io/tx/" + X402_TX,
    },
    timestamps: {
      evidenceSubmittedAt: "2026-08-09T02:49:25.972Z",
      releaseAt: "2026-08-09T11:49:09.000Z",
      qcSettlementAt: "2026-08-09T07:42:20.000Z",
    },
  },
};

describe("buildFinalReceipt", () => {
  it("tells the complete real story of the protected payment", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.protectedPayment).toEqual(input.protectedPayment);
    expect(receipt.protectedPayment.finalState).toBe("Released");
    expect(receipt.protectedPayment.amountHuman).toBe("0.01 USDC");
  });

  it("carries real evidence + x402 provenance verbatim", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.evidence.evidenceReference).toBe(
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    );
    expect(receipt.evidence.submissionTxHash).toBe(EVIDENCE_TX);
    expect(receipt.qualityCheck.settlementTxHash).toBe(X402_TX);
    expect(receipt.qualityCheck.facilitatorUrl).toBe("https://api.x402.celo.org");
    expect(receipt.qualityCheck.network).toBe("Celo Mainnet");
  });

  it("never hides recorded QC-vs-verified-evidence inconsistencies", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.qualityCheck.inconsistencies).toHaveLength(2);
    expect(receipt.qualityCheck.inconsistencies[0]).toContain("pasted text");
  });

  it("attributes the human decision and the release transaction", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.humanDecision.decision).toBe("Approve release");
    expect(receipt.humanDecision.authority).toBe("client");
    expect(receipt.humanDecision.txHash).toBe(RELEASE_TX);
    expect(receipt.humanDecision.sender).toBe(CLIENT.toLowerCase());
    expect(receipt.humanDecision.finalRecipient).toBe(WORKER);
    expect(receipt.humanDecision.outcome).toBe("Released");
  });

  it("provides explorer links for Sepolia escrow txs and Mainnet x402 settlement", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.audit.explorerLinks.releaseTransaction).toContain("blockscout.com/tx/");
    expect(receipt.audit.explorerLinks.evidenceSubmissionTransaction).toContain("blockscout.com/tx/");
    expect(receipt.audit.explorerLinks.x402SettlementTransaction).toContain("celoscan.io/tx/");
  });

  it("never fabricates data: missing tx hashes stay null", () => {
    const noTx: FinalReceiptInput = {
      ...input,
      evidence: { ...input.evidence, submissionTxHash: null },
      humanDecision: {
        ...input.humanDecision,
        txHash: null,
        sender: null,
        blockNumber: null,
        blockTime: null,
        status: null,
      },
      audit: {
        ...input.audit,
        explorerLinks: {
          ...input.audit.explorerLinks,
          releaseTransaction: null,
          evidenceSubmissionTransaction: null,
        },
      },
    };
    const receipt = buildFinalReceipt(noTx);
    expect(receipt.humanDecision.txHash).toBeNull();
    expect(receipt.evidence.submissionTxHash).toBeNull();
    expect(receipt.audit.explorerLinks.releaseTransaction).toBeNull();
  });

  it("preserves the product model and the agent statement", () => {
    const receipt = buildFinalReceipt(input);
    expect(receipt.productModel).toBe(PRODUCT_MODEL);
    expect(receipt.productModel).toContain("The contract protects the payment.");
    expect(receipt.productModel).toContain("People make the final decision.");
    expect(receipt.resolutionAgent.statement).toBe(AGENT_STATEMENT);
  });
});
