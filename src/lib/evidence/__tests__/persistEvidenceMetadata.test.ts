// ---------------------------------------------------------------------------
// persistVerifiedEvidenceMetadata — chain verification + persistence tests
//
//   1. The canonical full escrow ABI extracts evidenceReference correctly
//      from the full Payment struct (the old partial-ABI decode returned
//      paymentId as the reference — demonstrated).
//   2. Matching hash persists a new version and preserves prior versions.
//   3. Mismatched hash rejects without any write.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  encodeFunctionResult,
  decodeFunctionResult,
  keccak256,
  stringToHex,
  pad,
} from "viem";
import { protectedPaymentEscrowABI } from "@/lib/contracts/ProtectedPaymentEscrow.abi";
import {
  persistVerifiedEvidenceMetadata,
  type EvidenceMetadataChainReader,
} from "../persistEvidenceMetadata";
import { buildEvidenceManifest, type EvidenceFormData } from "../manifest";
import type { SupabaseClient } from "@supabase/supabase-js";

const ESCROW = "0x1A1CA38D6ac538d491A5c0db2Ed7FDDC3AeC709F" as const;
const CHAIN_ID = "11142220";
const EXPECTED_REF =
  "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99" as const;

const FORM: EvidenceFormData = {
  title: "Final Figma delivery",
  description: "Design handoff with tokens and layers",
  type: "delivery-file",
  relatedClaim: "Landing page Figma file",
  date: "2026-08-08",
  externalRef: "",
  pastedText: "Design system v2 attached",
  fileHash: "",
};

const FULL_PAYMENT = {
  paymentId: 1n,
  client: "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486" as `0x${string}`,
  worker: "0x85522bdE267d05bf8CE8813F97c75417b7894A33" as `0x${string}`,
  token: "0x01C5C0122039549AD1493B8220cABEdD739BC44E" as `0x${string}`,
  amount: 10000n,
  agreementLabel: pad("0x01", { size: 32 }),
  deliverableSummary: pad("0x02", { size: 32 }),
  deliveryFormat: pad("0x03", { size: 32 }),
  releaseRule: pad("0x04", { size: 32 }),
  evidenceExpectation: pad("0x05", { size: 32 }),
  termsHash: pad("0x06", { size: 32 }),
  evidenceReference: EXPECTED_REF,
  disputeReference: pad("0x08", { size: 32 }),
  deliveryDeadline: 1785000000n,
  autoReleaseSeconds: 0n,
  disputeWindowSeconds: 259200n,
  state: 3,
  createdAt: 1784748185n,
  fundedAt: 1784748589n,
  acceptedAt: 1784749235n,
  deliveryAt: 1784750040n,
  releaseRequestedAt: 0n,
  releasedAt: 0n,
};

describe("canonical ABI — evidenceReference extraction from full Payment struct", () => {
  it("decodes evidenceReference correctly via the full struct ABI", () => {
    const data = encodeFunctionResult({
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      result: FULL_PAYMENT,
    });

    const decoded = decodeFunctionResult({
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      data,
    });

    expect(decoded.evidenceReference).toBe(EXPECTED_REF);
    expect(decoded.paymentId).toBe(1n);
    expect(decoded.state).toBe(3);
  });

  it("the old partial output ABI mis-decodes paymentId as the reference (regression proof)", () => {
    const data = encodeFunctionResult({
      abi: protectedPaymentEscrowABI,
      functionName: "getPayment",
      result: FULL_PAYMENT,
    });

    const partialAbi = [
      {
        inputs: [{ name: "paymentId", type: "uint256" }],
        name: "getPayment",
        outputs: [
          {
            type: "tuple",
            components: [{ name: "evidenceReference", type: "bytes32" }],
          },
        ],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    const wronglyDecoded = decodeFunctionResult({
      abi: partialAbi,
      functionName: "getPayment",
      data,
    });

    // The first struct field is paymentId — the partial ABI reads it as
    // the evidenceReference. This is why the old route always HASH_MISMATCH.
    expect(wronglyDecoded.evidenceReference).toBe(pad("0x01", { size: 32 }));
    expect(wronglyDecoded.evidenceReference).not.toBe(EXPECTED_REF);
  });
});

// ---------------------------------------------------------------------------
// Fake Supabase store — records every call
// ---------------------------------------------------------------------------

function makeFakeStore(overrides: {
  existing?: { id: string } | null;
  insertData?: { id: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const traces: string[] = [];
  const insertRows: Record<string, unknown>[] = [];
  const updatePayloads: Record<string, unknown>[] = [];
  const neqArgs: [string, string][] = [];
  let deleteCalled = false;

  const chain = {
    select() {
      traces.push("select");
      return chain;
    },
    eq(key: string, value: string) {
      traces.push(`eq:${key}=${value}`);
      return chain;
    },
    insert(row: Record<string, unknown>) {
      traces.push("insert");
      insertRows.push(row);
      return chain;
    },
    update(patch: Record<string, unknown>) {
      traces.push("update");
      updatePayloads.push(patch);
      return chain;
    },
    delete() {
      deleteCalled = true;
      return chain;
    },
    maybeSingle: async () => ({
      data: overrides.existing ?? null,
      error: null,
    }),
    single: async () => ({
      data: overrides.insertData ?? { id: "row-new" },
      error: overrides.insertError ?? null,
    }),
    neq(key: string, value: string) {
      traces.push(`neq:${key}=${value}`);
      neqArgs.push([key, value]);
      return { data: null, error: null };
    },
  };

  const store = {
    from: () => chain,
  } as unknown as SupabaseClient;

  return { store, traces, insertRows, updatePayloads, neqArgs, getDeleteCalled: () => deleteCalled };
}

function makeChainReader(onChainReference: string, fail = false): EvidenceMetadataChainReader {
  return {
    readContract: vi.fn(async () => {
      if (fail) throw new Error("PaymentNotFound");
      return { evidenceReference: onChainReference as `0x${string}` };
    }),
  } as unknown as EvidenceMetadataChainReader;
}

describe("persistVerifiedEvidenceMetadata", () => {
  it("matching hash persists a new version and preserves prior versions", async () => {
    const manifest = buildEvidenceManifest(FORM);
    const computed = keccak256(stringToHex(manifest)).toLowerCase();
    const fake = makeFakeStore();

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(computed),
      store: fake.store,
      escrowAddress: ESCROW,
      escrowChainId: CHAIN_ID,
      paymentId: "1",
      data: FORM,
    });

    expect(result.status).toBe("persisted");
    expect(result.evidenceReference).toBe(computed);
    expect(result.rowId).toBe("row-new");

    // Insert carried the verified manifest + reference
    expect(fake.insertRows).toHaveLength(1);
    expect(fake.insertRows[0].evidence_reference).toBe(computed);
    expect(fake.insertRows[0].manifest).toBe(manifest);
    expect(fake.insertRows[0].is_current).toBe(true);

    // Prior versions preserved: only flagged not-current, never deleted
    expect(fake.updatePayloads).toEqual([{ is_current: false }]);
    expect(fake.neqArgs).toEqual([["id", "row-new"]]);
    expect(fake.getDeleteCalled()).toBe(false);
  });

  it("already-persisted reference is idempotent (no duplicate insert)", async () => {
    const manifest = buildEvidenceManifest(FORM);
    const computed = keccak256(stringToHex(manifest)).toLowerCase();
    const fake = makeFakeStore({ existing: { id: "row-old" } });

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(computed),
      store: fake.store,
      escrowAddress: ESCROW,
      escrowChainId: CHAIN_ID,
      paymentId: "1",
      data: FORM,
    });

    expect(result.status).toBe("already_existed");
    expect(result.rowId).toBe("row-old");
    expect(fake.insertRows).toHaveLength(0);
    expect(fake.updatePayloads).toHaveLength(0);
  });

  it("mismatched hash rejects without any write", async () => {
    const fake = makeFakeStore();

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(EXPECTED_REF), // on-chain differs from manifest hash
      store: fake.store,
      escrowAddress: ESCROW,
      escrowChainId: CHAIN_ID,
      paymentId: "1",
      data: FORM,
    });

    expect(result.status).toBe("hash_mismatch");
    expect(result.evidenceReference).toBe(EXPECTED_REF);
    expect(fake.insertRows).toHaveLength(0);
    expect(fake.updatePayloads).toHaveLength(0);
    expect(fake.traces.join(",")).not.toContain("insert");
  });

  it("chain read failure (payment not found) rejects without any write", async () => {
    const fake = makeFakeStore();

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(EXPECTED_REF, true),
      store: fake.store,
      escrowAddress: ESCROW,
      escrowChainId: CHAIN_ID,
      paymentId: "999",
      data: FORM,
    });

    expect(result.status).toBe("chain_read_failed");
    expect(fake.insertRows).toHaveLength(0);
  });

  it("rejects a new evidence version after reviewer review has begun", async () => {
    const manifest = buildEvidenceManifest(FORM);
    const computed = keccak256(stringToHex(manifest)).toLowerCase();
    const makeQuery = (data: unknown) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data, error: null }),
      };
      return query;
    };
    const store = {
      from: (table: string) =>
        table === "evidence_review_locks"
          ? makeQuery({ locked_at: "2026-08-09T09:00:00.000Z" })
          : makeQuery(null),
    } as unknown as SupabaseClient;

    const result = await persistVerifiedEvidenceMetadata({
      chainReader: makeChainReader(computed),
      store,
      escrowAddress: ESCROW,
      escrowChainId: CHAIN_ID,
      paymentId: "1",
      data: FORM,
    });

    expect(result.status).toBe("review_locked");
    expect(result.rowId).toBeNull();
  });
});
