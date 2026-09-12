// ---------------------------------------------------------------------------
// Chain final-proof regression tests
//
// Resolved is a terminal dispute outcome, not a synonym for refunded, and
// non-release lifecycle events must be proven from their own contract logs.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CeloSepoliaChainFinalProofReader,
  type ChainReadClient,
} from "../chainProvenance";

const CLIENT = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const WORKER = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const OWNER = "0x0000000000000000000000000000000000000003" as `0x${string}`;

function makeClient(state: number, eventName: string, eventArgs: Record<string, unknown>): ChainReadClient {
  const txHash = `0x${eventName.toLowerCase()}tx` as `0x${string}`;
  return {
    async readContract() {
      return {
        paymentId: 7n,
        client: CLIENT,
        worker: WORKER,
        token: "0x0000000000000000000000000000000000000004",
        amount: 10000n,
        agreementLabel: "0x" + "00".repeat(32),
        deliverableSummary: "0x" + "00".repeat(32),
        deliveryFormat: "0x" + "00".repeat(32),
        releaseRule: "0x" + "00".repeat(32),
        evidenceExpectation: "0x" + "00".repeat(32),
        termsHash: "0x" + "00".repeat(32),
        evidenceReference: "0x" + "00".repeat(32),
        disputeReference: "0x" + "00".repeat(32),
        deliveryDeadline: 0n,
        autoReleaseSeconds: 0n,
        disputeWindowSeconds: 0n,
        state,
        createdAt: 2_000_000n,
        fundedAt: 0n,
        acceptedAt: 0n,
        deliveryAt: 0n,
        releaseRequestedAt: 0n,
        releasedAt: state === 8 ? 2_000_100n : 0n,
      };
    },
    async getBlock(args: unknown) {
      const value = args as { blockTag?: string };
      if (value.blockTag === "latest") return { number: 1000n, timestamp: 1_000_000n };
      return { number: 900n, timestamp: 2_000_100n };
    },
    async getLogs(args: unknown) {
      const value = args as { event?: { name?: string } };
      if (value.event?.name !== eventName) return [];
      return [{
        transactionHash: txHash,
        blockNumber: 900n,
        args: eventArgs,
      }];
    },
    async getTransactionReceipt() {
      return { status: "success", blockNumber: 900n };
    },
    async getTransaction() {
      return { from: eventName === "PaymentResolved" ? OWNER : CLIENT };
    },
  };
}

describe("CeloSepoliaChainFinalProofReader lifecycle provenance", () => {
  it("proves Resolved separately and preserves its allocation amounts", async () => {
    const reader = new CeloSepoliaChainFinalProofReader(
      undefined,
      makeClient(8, "PaymentResolved", {
        clientAmount: 10000n,
        workerAmount: 0n,
      }),
    );

    const proof = await reader.readFinalProof(7n);

    expect(proof?.state.stateLabel).toBe("resolved");
    expect(proof?.release.txHash).toBeNull();
    expect(proof?.resolution.txHash).toContain("paymentresolved");
    expect(proof?.resolution.sender).toBe(OWNER);
    expect(proof?.resolution.clientAmount).toBe("10000");
    expect(proof?.resolution.workerAmount).toBe("0");
  });

  it("proves cancellation without pretending it was a refund or release", async () => {
    const reader = new CeloSepoliaChainFinalProofReader(
      undefined,
      makeClient(7, "PaymentCancelled", {}),
    );

    const proof = await reader.readFinalProof(7n);

    expect(proof?.state.stateLabel).toBe("cancelled");
    expect(proof?.cancellation.txHash).toContain("paymentcancelled");
    expect(proof?.release.txHash).toBeNull();
    expect(proof?.resolution.txHash).toBeNull();
  });

  it("proves an active dispute and leaves resolution absent", async () => {
    const reader = new CeloSepoliaChainFinalProofReader(
      undefined,
      makeClient(6, "PaymentDisputed", {
        disputeReference: "0x" + "11".repeat(32),
      }),
    );

    const proof = await reader.readFinalProof(7n);

    expect(proof?.state.stateLabel).toBe("disputed");
    expect(proof?.dispute.txHash).toContain("paymentdisputed");
    expect(proof?.dispute.disputeReference).toBe("0x" + "11".repeat(32));
    expect(proof?.resolution.txHash).toBeNull();
  });
});
