// ---------------------------------------------------------------------------
// P4.3b evidence chain scope — pure helper tests (no RPC, no DB).
//
//   - Absent/empty resolves to the Sepolia default (behavior unchanged).
//   - 42220 (number or string) selects Mainnet explicitly.
//   - Present-but-invalid values fail closed (throw UNSUPPORTED_CHAIN).
//   - First present candidate wins; all-absent falls back to default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  EVIDENCE_DEFAULT_CHAIN_ID,
  EvidenceChainScopeError,
  parseEvidenceChainId,
  readEvidenceChainRaw,
  resolveEvidenceChainId,
} from "../chainScope";
import { CELO_CHAIN_ID, CELO_MAINNET_CHAIN_ID } from "@/lib/web3/chains";

describe("P4.3b parseEvidenceChainId", () => {
  it("treats absent/empty as unset (Sepolia default applied by callers)", () => {
    expect(parseEvidenceChainId(null)).toBeNull();
    expect(parseEvidenceChainId(undefined)).toBeNull();
    expect(parseEvidenceChainId("")).toBeNull();
    expect(parseEvidenceChainId("   ")).toBeNull();
  });

  it("accepts Sepolia and Mainnet as numbers or strings", () => {
    expect(parseEvidenceChainId(11142220)).toBe(CELO_CHAIN_ID);
    expect(parseEvidenceChainId("11142220")).toBe(CELO_CHAIN_ID);
    expect(parseEvidenceChainId(42220)).toBe(CELO_MAINNET_CHAIN_ID);
    expect(parseEvidenceChainId("42220")).toBe(CELO_MAINNET_CHAIN_ID);
    expect(parseEvidenceChainId("  42220  ")).toBe(CELO_MAINNET_CHAIN_ID);
  });

  it("fails closed on malformed or unsupported chains (never silent fallback)", () => {
    for (const bad of ["abc", "0", "-1", "1.5", "1", 1, 99999, "eip155:42220"]) {
      expect(() => parseEvidenceChainId(bad)).toThrow(EvidenceChainScopeError);
    }
    try {
      parseEvidenceChainId(1);
      expect.unreachable();
    } catch (err) {
      expect((err as EvidenceChainScopeError).code).toBe("UNSUPPORTED_CHAIN");
    }
  });
});

describe("P4.3b resolveEvidenceChainId", () => {
  it("defaults to Sepolia when no chain is given (behavior unchanged)", () => {
    expect(EVIDENCE_DEFAULT_CHAIN_ID).toBe(CELO_CHAIN_ID);
    expect(resolveEvidenceChainId([])).toBe(CELO_CHAIN_ID);
    expect(resolveEvidenceChainId([null, undefined, ""])).toBe(CELO_CHAIN_ID);
  });

  it("resolves the first present candidate (query wins when first)", () => {
    expect(resolveEvidenceChainId(["42220", 11142220])).toBe(CELO_MAINNET_CHAIN_ID);
    expect(resolveEvidenceChainId([null, 42220])).toBe(CELO_MAINNET_CHAIN_ID);
  });

  it("throws on a present-but-invalid candidate instead of defaulting", () => {
    expect(() => resolveEvidenceChainId(["1"])).toThrow(EvidenceChainScopeError);
    expect(() => resolveEvidenceChainId([null, "abc"])).toThrow(
      EvidenceChainScopeError,
    );
  });
});

describe("P4.3b readEvidenceChainRaw", () => {
  it("reads ?chainId= first, then aliases", () => {
    expect(readEvidenceChainRaw("?chainId=42220")).toBe("42220");
    expect(readEvidenceChainRaw("?chain_id=42220")).toBe("42220");
    expect(readEvidenceChainRaw("?escrowChainId=42220")).toBe("42220");
    expect(
      readEvidenceChainRaw("?chainId=42220&escrowChainId=11142220"),
    ).toBe("42220");
  });

  it("returns null when no chain key is present", () => {
    expect(readEvidenceChainRaw("")).toBeNull();
    expect(readEvidenceChainRaw("?foo=bar")).toBeNull();
  });
});
