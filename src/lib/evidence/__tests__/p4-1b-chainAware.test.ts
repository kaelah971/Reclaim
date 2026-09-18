// ---------------------------------------------------------------------------
// P4.1b chain-aware evidence + provenance (no real RPC).
//
// - Mainnet reader verifies against the canonical Mainnet escrow (42220).
// - Sepolia behavior is unchanged (Sepolia default preserved).
// - Unsupported chains are rejected fail-closed.
// - Evidence metadata verifies against Mainnet escrow when chainId=42220.
// - SupabaseEvidenceReader scopes by chain when provided, legacy otherwise.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  CeloChainFinalProofReader,
  CeloSepoliaChainFinalProofReader,
  parseProvenanceChainId,
  resolveChainProvenanceConfig,
  type ChainReadClient,
} from "../chainProvenance";
import {
  persistVerifiedEvidenceMetadata,
  type EvidenceMetadataChainReader,
} from "../persistEvidenceMetadata";
import { buildEvidenceManifest, type EvidenceFormData } from "../manifest";
import { CELO_MAINNET_CHAIN_ID, CELO_SEPOLIA_CHAIN_ID } from "@/lib/web3/chains";
import type { SupabaseClient } from "@supabase/supabase-js";

const SEPOLIA_ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F";
const MAINNET_ESCROW = "0xE42cF4620DE454bE0De5004255d25683e4F882c4";

const FORM: EvidenceFormData = {
  title: "Mainnet delivery evidence",
  description: "Delivered via mainnet escrow",
  type: "delivery-file",
  relatedClaim: "Mainnet claim",
  date: "2026-09-01",
  externalRef: "",
  pastedText: "Mainnet pasted text",
  fileHash: "",
};

function makeProvenanceClient(captured: { address?: unknown }): ChainReadClient {
  return {
    async readContract() {
      return {
        paymentId: 7n,
        client: "0x0000000000000000000000000000000000000001",
        worker: "0x0000000000000000000000000000000000000002",
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
        state: 5,
        createdAt: 2_000_000n,
        fundedAt: 0n,
        acceptedAt: 0n,
        deliveryAt: 2_000_050n,
        releaseRequestedAt: 0n,
        releasedAt: 2_000_100n,
      };
    },
    async getBlock(args: unknown) {
      const value = args as { blockTag?: string };
      if (value.blockTag === "latest") return { number: 1000n, timestamp: 1_000_000n };
      return { number: 900n, timestamp: 2_000_100n };
    },
    async getLogs(args: unknown) {
      captured.address = (args as { address?: unknown }).address;
      return [];
    },
    async getTransactionReceipt() {
      return { status: "success", blockNumber: 900n };
    },
    async getTransaction() {
      return { from: "0x0000000000000000000000000000000000000001" as `0x${string}` };
    },
  };
}

function makeFakeStore() {
  const insertRows: Record<string, unknown>[] = [];
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    insert(row: Record<string, unknown>) { insertRows.push(row); return chain; },
    update() { return chain; },
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { id: "row-new" }, error: null }),
    neq() { return { data: null, error: null }; },
  };
  const store = { from: () => chain } as unknown as SupabaseClient;
  return { store, insertRows };
}

function makeChainReader(onChainReference: string): EvidenceMetadataChainReader {
  return {
    readContract: vi.fn(async () => ({
      evidenceReference: onChainReference as `0x${string}`,
    })),
  } as unknown as EvidenceMetadataChainReader;
}

describe("P4.1b chain-aware provenance config", () => {
  it("resolves the canonical Mainnet escrow for chain 42220", () => {
    const config = resolveChainProvenanceConfig(CELO_MAINNET_CHAIN_ID);
    expect(config.chainId).toBe(42220);
    expect(config.contractAddress.toLowerCase()).toBe(MAINNET_ESCROW.toLowerCase());
  });

  it("resolves the canonical Sepolia escrow for chain 11142220", () => {
    const config = resolveChainProvenanceConfig(CELO_SEPOLIA_CHAIN_ID);
    expect(config.chainId).toBe(11142220);
    expect(config.contractAddress.toLowerCase()).toBe(SEPOLIA_ESCROW.toLowerCase());
  });

  it("rejects unsupported chains fail-closed", () => {
    expect(() => resolveChainProvenanceConfig(1)).toThrow(/Unsupported/);
    expect(() => resolveChainProvenanceConfig(99999)).toThrow(/Unsupported/);
    expect(() => parseProvenanceChainId("1")).toThrow(/Unsupported/);
  });

  it("defaults to Sepolia when no chain is given", () => {
    expect(parseProvenanceChainId(null)).toBe(CELO_SEPOLIA_CHAIN_ID);
    expect(parseProvenanceChainId(undefined)).toBe(CELO_SEPOLIA_CHAIN_ID);
    expect(parseProvenanceChainId("")).toBe(CELO_SEPOLIA_CHAIN_ID);
  });
});

describe("P4.1b chain-aware proof reader", () => {
  it("Sepolia reader preserves legacy behavior (chain, address, network)", async () => {
    const captured: { address?: unknown } = {};
    const reader = new CeloSepoliaChainFinalProofReader(
      undefined,
      makeProvenanceClient(captured),
    );
    expect(reader.chainId).toBe(11142220);
    expect(reader.contractAddress.toLowerCase()).toBe(SEPOLIA_ESCROW.toLowerCase());
    expect(reader.network).toBe("Celo Sepolia");

    const proof = await reader.readFinalProof(7n);
    expect(proof?.state.stateLabel).toBe("released");
    expect(captured.address).toBe(reader.contractAddress);
  });

  it("Mainnet reader verifies against the Mainnet escrow (chain 42220)", async () => {
    const captured: { address?: unknown } = {};
    const reader = new CeloChainFinalProofReader({
      chainId: 42220,
      client: makeProvenanceClient(captured),
    });
    expect(reader.chainId).toBe(42220);
    expect(reader.contractAddress.toLowerCase()).toBe(MAINNET_ESCROW.toLowerCase());
    expect(reader.network).toBe("Celo Mainnet");

    const proof = await reader.readFinalProof(7n);
    expect(proof?.state.stateLabel).toBe("released");
    // Log lookups target the Mainnet escrow — never Sepolia.
    expect(String(captured.address).toLowerCase()).toBe(MAINNET_ESCROW.toLowerCase());
  });

  it("generic reader defaults to Sepolia to preserve behavior", () => {
    const captured: { address?: unknown } = {};
    const reader = new CeloChainFinalProofReader({
      client: makeProvenanceClient(captured),
    });
    expect(reader.chainId).toBe(11142220);
    expect(reader.network).toBe("Celo Sepolia");
  });

  it("refuses to construct for unsupported chains", () => {
    expect(() => new CeloChainFinalProofReader(1)).toThrow(/Unsupported|not deployed/);
  });
});

describe("P4.1b evidence metadata verifies against Mainnet escrow", () => {
  it("persists when the manifest hash matches the Mainnet on-chain reference", async () => {
    const manifest = buildEvidenceManifest(FORM);
    const computed = keccak256(stringToHex(manifest)).toLowerCase();
    const fake = makeFakeStore();

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(computed),
      store: fake.store,
      escrowAddress: MAINNET_ESCROW as `0x${string}`,
      escrowChainId: "42220",
      paymentId: "7",
      data: FORM,
    });

    expect(result.status).toBe("persisted");
    expect(result.evidenceReference).toBe(computed);
    expect(fake.insertRows).toHaveLength(1);
    expect(fake.insertRows[0].escrow_chain_id).toBe("42220");
    expect(String(fake.insertRows[0].escrow_contract_address).toLowerCase()).toBe(
      MAINNET_ESCROW.toLowerCase(),
    );
  });

  it("Sepolia behavior is unchanged (same form verifies against Sepolia escrow)", async () => {
    const manifest = buildEvidenceManifest(FORM);
    const computed = keccak256(stringToHex(manifest)).toLowerCase();
    const fake = makeFakeStore();

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(computed),
      store: fake.store,
      escrowAddress: SEPOLIA_ESCROW as `0x${string}`,
      escrowChainId: "11142220",
      paymentId: "7",
      data: FORM,
    });

    expect(result.status).toBe("persisted");
    expect(fake.insertRows[0].escrow_chain_id).toBe("11142220");
  });
});

describe("P4.1b SupabaseEvidenceReader chain scoping", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("scopes by escrow_chain_id when a chain is provided, legacy otherwise", async () => {
    const eqCalls: Array<[string, string]> = [];
    const builder = {
      from: vi.fn(() => builder),
      select: vi.fn(() => builder),
      eq: vi.fn((key: string, value: string) => {
        eqCalls.push([key, value]);
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    vi.doMock("@/lib/supabase/client", () => ({
      getSupabaseClient: () => builder,
    }));
    const { SupabaseEvidenceReader } = await import("../reader");

    // Unscoped (legacy): payment + is_current only, no chain filter.
    eqCalls.length = 0;
    await new SupabaseEvidenceReader().getEvidenceMetadata("7");
    expect(eqCalls).toContainEqual(["escrow_payment_id", "7"]);
    expect(eqCalls).toContainEqual(["is_current", true as unknown as string]);
    expect(eqCalls.some(([k]) => k === "escrow_chain_id")).toBe(false);

    // Scoped (Mainnet): adds the chain filter so Sepolia/Mainnet never conflate.
    eqCalls.length = 0;
    await new SupabaseEvidenceReader().getEvidenceMetadata("7", "42220");
    expect(eqCalls).toContainEqual(["escrow_chain_id", "42220"]);

    // Numeric chain input is normalized to string.
    eqCalls.length = 0;
    await new SupabaseEvidenceReader().getEvidenceMetadata("7", 11142220);
    expect(eqCalls).toContainEqual(["escrow_chain_id", "11142220"]);

    vi.doUnmock("@/lib/supabase/client");
  });
});
